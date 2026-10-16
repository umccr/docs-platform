"""
Publish a built site to `s3://<bucket>/sites/<slug>/`, and its exported documents to OrcaSonar's ingest bucket under
`docs/<slug>/`.

The site pipeline's publish steps assume `docs-publisher` narrowed to one site (see `umccr_docs.aws`), so this code
cannot reach another site even if it tried; the guards here make mistakes loud before IAM has to stop them.

Releases of one site can run in parallel and finish in any order. Each publish carries the site's release number and
compares it with the live marker first: an older release is skipped rather than published over a newer one.

Order matters: every file is uploaded before anything is deleted, so a reader never finds a page missing mid-publish,
and the provenance marker `_publish.json` is written last. There is no `aws s3 sync --delete`: the CLI never deletes
files excluded by a filter, which would leave pages removed from the source online.
"""

import datetime
import json
import os
import re
from pathlib import Path
from typing import Any

from umccr_docs.errors import DocsError
from umccr_docs.media_types import content_type_for
from umccr_docs.slug import validate_slug

MARKER_NAME = "_publish.json"

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"

# Theme assets carry a content hash in their name (bundle.<hash>.min.js, main.<hash>.min.css), so they can be cached
# for a year. Everything else is revalidated on every request, which is why a publish needs no cache invalidation.
_FINGERPRINTED = re.compile(r"\.[0-9a-f]{8,}\.min\.(?:js|css)$")

# Refuse to delete more than this share of what is published, unless told to.
MASS_DELETE_RATIO = 0.5


def cache_control_for(relative: str) -> str:
    return IMMUTABLE if _FINGERPRINTED.search(relative) else REVALIDATE


def _local_files(site_dir: Path) -> dict[str, Path]:
    files = {}
    for path in sorted(site_dir.rglob("*")):
        if path.is_file() and not path.is_symlink():
            relative = path.relative_to(site_dir).as_posix()
            if relative == MARKER_NAME:
                raise DocsError(f"The site must not contain {MARKER_NAME}; the publisher writes it")
            files[relative] = path
    return files


def _remote_keys(s3: Any, bucket: str, prefix: str) -> set[str]:
    keys: set[str] = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys.update(item["Key"] for item in page.get("Contents", []))
    return keys


def provenance_from_environment() -> dict[str, str]:
    """
    What the marker records: the site pipeline's run (its variables and the CodeBuild build), or, for a publish run
    by hand from a GitHub Actions job or a laptop, whatever that environment says.
    """
    if os.environ.get("CODEBUILD_BUILD_ID"):
        return {
            "repository": os.environ.get("REPO", ""),
            "commit": os.environ.get("COMMIT", ""),
            "run_id": os.environ.get("CODEBUILD_BUILD_ID", ""),
            "stage": os.environ.get("STAGE", ""),
        }
    return {
        "repository": os.environ.get("GITHUB_REPOSITORY", ""),
        "commit": os.environ.get("GITHUB_SHA", ""),
        "ref": os.environ.get("GITHUB_REF", ""),
        "run_id": os.environ.get("GITHUB_RUN_ID", ""),
        "actor": os.environ.get("GITHUB_ACTOR", ""),
    }


def live_release(s3: Any, bucket: str, slug: str) -> int | None:
    """The release number in the live marker, or None for a site never published by the site pipeline."""
    try:
        response = s3.get_object(Bucket=bucket, Key=f"sites/{slug}/{MARKER_NAME}")
    except Exception as error:  # botocore's ClientError, without importing botocore at module level
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if code in ("NoSuchKey", "404"):
            return None
        raise
    try:
        release = json.loads(response["Body"].read()).get("release")
    except ValueError:
        return None
    return release if isinstance(release, int) else None


def publish(
    site_dir: Path,
    bucket: str,
    slug: str,
    *,
    s3: Any = None,
    allow_mass_delete: bool = False,
    dry_run: bool = False,
    provenance: dict[str, str] | None = None,
    release: int | None = None,
    log: Any = print,
) -> dict[str, int]:
    validate_slug(slug)
    if not bucket or "/" in bucket:
        raise DocsError(f"'{bucket}' is not a bucket name")
    if not (site_dir / "index.html").is_file():
        raise DocsError(f"{site_dir} has no index.html; refusing to publish an empty or partial site")

    prefix = f"sites/{slug}/"
    local = _local_files(site_dir)
    if s3 is None:
        import boto3

        s3 = boto3.client("s3")

    if release is not None:
        live = live_release(s3, bucket, slug)
        if live is not None and live > release:
            log(f"Skipping release {release} of {slug}: release {live} is already live")
            return {"uploaded": 0, "deleted": 0, "skipped": 1}

    remote = _remote_keys(s3, bucket, prefix)
    wanted = {prefix + relative for relative in local} | {prefix + MARKER_NAME}
    stale = sorted(key for key in remote if key.startswith(prefix) and key not in wanted)

    published = len(remote - {prefix + MARKER_NAME})
    if published and len(stale) > published * MASS_DELETE_RATIO and not allow_mass_delete:
        raise DocsError(
            f"Publishing would delete {len(stale)} of the {published} objects under {prefix}. "
            "If that is intended (for example a restructure), rerun with --allow-mass-delete."
        )

    log(f"{'Would publish' if dry_run else 'Publishing'} {len(local)} files to s3://{bucket}/{prefix}")
    if dry_run:
        for key in stale:
            log(f"would delete {key}")
        return {"uploaded": 0, "deleted": 0}

    for relative, path in local.items():
        s3.upload_file(
            str(path),
            bucket,
            prefix + relative,
            ExtraArgs={
                "ContentType": content_type_for(relative),
                "CacheControl": cache_control_for(relative),
            },
        )

    for start in range(0, len(stale), 1000):
        batch = stale[start : start + 1000]
        response = s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True})
        if response.get("Errors"):
            raise DocsError("Some stale objects could not be deleted", [str(error) for error in response["Errors"]])
    for key in stale:
        log(f"deleted {key}")

    marker = {
        "slug": slug,
        "published": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "files": len(local),
        "deleted": len(stale),
        **({"release": release} if release is not None else {}),
        **(provenance or {}),
    }
    s3.put_object(
        Bucket=bucket,
        Key=prefix + MARKER_NAME,
        Body=json.dumps(marker, indent=2).encode("utf-8"),
        ContentType="application/json",
        CacheControl=REVALIDATE,
    )
    return {"uploaded": len(local), "deleted": len(stale)}


def publish_documents(
    kb_dir: Path,
    bucket: str,
    slug: str,
    *,
    s3: Any = None,
    allow_mass_delete: bool = False,
    dry_run: bool = False,
    log: Any = print,
) -> dict[str, int]:
    """
    Mirror an `export-kb` directory into `s3://<bucket>/docs/<slug>/`: upload every document and metadata file, then
    delete what the export no longer has, so a page removed from the site leaves OrcaSonar's index too.
    """
    validate_slug(slug)
    if not bucket or "/" in bucket:
        raise DocsError(f"'{bucket}' is not a bucket name")
    if not kb_dir.is_dir():
        raise DocsError(f"{kb_dir} is not a directory; run umccr-docs export-kb first")

    prefix = f"docs/{slug}/"
    local = {
        path.relative_to(kb_dir).as_posix(): path
        for path in sorted(kb_dir.rglob("*"))
        if path.is_file() and not path.is_symlink()
    }
    if not any(name.endswith(".md") for name in local):
        raise DocsError(f"{kb_dir} has no documents; refusing to empty {prefix}")
    if s3 is None:
        import boto3

        s3 = boto3.client("s3")

    remote = _remote_keys(s3, bucket, prefix)
    stale = sorted(key for key in remote if key[len(prefix) :] not in local)
    if remote and len(stale) > len(remote) * MASS_DELETE_RATIO and not allow_mass_delete:
        raise DocsError(
            f"Publishing would delete {len(stale)} of the {len(remote)} documents under {prefix}. "
            "If that is intended, rerun with --allow-mass-delete."
        )

    log(f"{'Would export' if dry_run else 'Exporting'} {len(local)} files to s3://{bucket}/{prefix}")
    if dry_run:
        return {"uploaded": 0, "deleted": 0}

    for relative, path in local.items():
        content_type = "application/json" if relative.endswith(".json") else "text/markdown; charset=utf-8"
        s3.upload_file(str(path), bucket, prefix + relative, ExtraArgs={"ContentType": content_type})
    for start in range(0, len(stale), 1000):
        batch = stale[start : start + 1000]
        response = s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True})
        if response.get("Errors"):
            raise DocsError("Some stale documents could not be deleted", [str(error) for error in response["Errors"]])
    return {"uploaded": len(local), "deleted": len(stale)}
