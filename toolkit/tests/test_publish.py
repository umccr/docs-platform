import json
from pathlib import Path

import pytest

from umccr_docs.errors import DocsError
from umccr_docs.publish import (
    IMMUTABLE,
    MARKER_NAME,
    REVALIDATE,
    cache_control_for,
    content_type_for,
    publish,
)


class FakeS3:
    """Enough of the S3 client for publish(), recording every call in order."""

    def __init__(self, existing: list[str]) -> None:
        self.objects = {key: b"old" for key in existing}
        self.calls: list[tuple[str, str]] = []
        self.metadata: dict[str, dict] = {}

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        s3 = self

        class Paginator:
            def paginate(self, Bucket, Prefix):  # noqa: N803 (boto3 casing)
                yield {"Contents": [{"Key": key} for key in sorted(s3.objects) if key.startswith(Prefix)]}

        return Paginator()

    def upload_file(self, filename, bucket, key, ExtraArgs):  # noqa: N803
        self.calls.append(("upload", key))
        self.objects[key] = Path(filename).read_bytes()
        self.metadata[key] = ExtraArgs

    def delete_objects(self, Bucket, Delete):  # noqa: N803
        for item in Delete["Objects"]:
            self.calls.append(("delete", item["Key"]))
            self.objects.pop(item["Key"], None)
        return {}

    def put_object(self, Bucket, Key, Body, ContentType, CacheControl):  # noqa: N803
        self.calls.append(("put", Key))
        self.objects[Key] = Body
        self.metadata[Key] = {"ContentType": ContentType, "CacheControl": CacheControl}


@pytest.fixture
def site(tmp_path):
    files = {
        "index.html": "<h1>Home</h1>",
        "404.html": "<h1>Not found</h1>",
        "guide/index.html": "<h1>Guide</h1>",
        "assets/javascripts/bundle.0123abcd4567.min.js": "js",
        "search/search_index.json": "{}",
    }
    for relative, content in files.items():
        path = tmp_path / "site" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return tmp_path / "site"


def test_uploads_then_prunes_then_writes_the_marker(site):
    s3 = FakeS3(["sites/demo/old-page/index.html", "sites/demo/index.html", "sites/other/index.html"])
    counts = publish(site, "bucket", "demo", s3=s3, provenance={"commit": "abc"}, log=lambda _: None)

    assert counts == {"uploaded": 5, "deleted": 1}
    kinds = [kind for kind, _ in s3.calls]
    assert kinds == ["upload"] * 5 + ["delete", "put"], "every upload precedes any delete; the marker is last"
    assert ("delete", "sites/demo/old-page/index.html") in s3.calls
    assert "sites/other/index.html" in s3.objects, "another site's objects are never touched"

    marker = json.loads(s3.objects[f"sites/demo/{MARKER_NAME}"])
    assert marker["slug"] == "demo" and marker["files"] == 5 and marker["deleted"] == 1 and marker["commit"] == "abc"


def test_sets_cache_control_and_content_type(site):
    s3 = FakeS3([])
    publish(site, "bucket", "demo", s3=s3, log=lambda _: None)
    assert s3.metadata["sites/demo/index.html"] == {
        "ContentType": "text/html; charset=utf-8",
        "CacheControl": REVALIDATE,
    }
    assert s3.metadata["sites/demo/assets/javascripts/bundle.0123abcd4567.min.js"]["CacheControl"] == IMMUTABLE
    assert s3.metadata["sites/demo/search/search_index.json"]["ContentType"] == "application/json"


def test_refuses_to_delete_most_of_a_site(site):
    existing = [f"sites/demo/page-{index}/index.html" for index in range(20)]
    with pytest.raises(DocsError, match="--allow-mass-delete"):
        publish(site, "bucket", "demo", s3=FakeS3(existing), log=lambda _: None)
    counts = publish(site, "bucket", "demo", s3=FakeS3(existing), allow_mass_delete=True, log=lambda _: None)
    assert counts["deleted"] == 20


def test_refuses_an_empty_site(tmp_path):
    (tmp_path / "site").mkdir()
    with pytest.raises(DocsError, match="no index.html"):
        publish(tmp_path / "site", "bucket", "demo", s3=FakeS3([]), log=lambda _: None)


@pytest.mark.parametrize("slug", ["../other", "demo/../other", "Demo", "sites"])
def test_refuses_a_bad_slug(site, slug):
    with pytest.raises(DocsError):
        publish(site, "bucket", slug, s3=FakeS3([]), log=lambda _: None)


def test_dry_run_changes_nothing(site):
    s3 = FakeS3(["sites/demo/index.html", "sites/demo/stale.html"])
    assert publish(site, "bucket", "demo", s3=s3, dry_run=True, log=lambda _: None) == {
        "uploaded": 0,
        "deleted": 0,
    }
    assert s3.calls == []


@pytest.mark.parametrize(
    ("path", "cache"),
    [
        ("index.html", REVALIDATE),
        ("assets/images/diagram.png", REVALIDATE),
        ("assets/stylesheets/main.8608ea7d.min.css", IMMUTABLE),
        ("assets/stylesheets/palette.06af60db.min.css", IMMUTABLE),
        ("assets/umccr/umccr.css", REVALIDATE),
    ],
)
def test_cache_classes(path, cache):
    assert cache_control_for(path) == cache


def test_content_types():
    assert content_type_for("sitemap.xml.gz") == "application/gzip"
    assert content_type_for("unknown.bin") == "application/octet-stream"


# --- releases, documents and the publisher session ---------------------------------------------------------------


class NoSuchKeyError(Exception):
    def __init__(self) -> None:
        super().__init__("NoSuchKey")
        self.response = {"Error": {"Code": "NoSuchKey"}}


class ReleaseS3(FakeS3):
    """FakeS3 that can also read objects back, for the live marker."""

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.objects:
            raise NoSuchKeyError()
        body = self.objects[Key]

        class Body:
            def read(self):
                return body

        return {"Body": Body()}


def _marker(release: int) -> bytes:
    return json.dumps({"slug": "demo", "release": release}).encode()


def test_records_the_release_in_the_marker(site):
    s3 = ReleaseS3([])
    publish(site, "bucket", "demo", s3=s3, release=7, log=lambda _: None)
    assert json.loads(s3.objects[f"sites/demo/{MARKER_NAME}"])["release"] == 7


def test_skips_a_release_older_than_the_live_one(site):
    s3 = ReleaseS3([])
    s3.objects[f"sites/demo/{MARKER_NAME}"] = _marker(9)
    counts = publish(site, "bucket", "demo", s3=s3, release=8, log=lambda _: None)
    assert counts == {"uploaded": 0, "deleted": 0, "skipped": 1}
    assert s3.calls == [], "nothing is written"


@pytest.mark.parametrize("live", [None, 8, 9])
def test_publishes_the_same_or_a_newer_release(site, live):
    s3 = ReleaseS3([])
    if live is not None:
        s3.objects[f"sites/demo/{MARKER_NAME}"] = _marker(live)
    counts = publish(site, "bucket", "demo", s3=s3, release=9, log=lambda _: None)
    assert counts["uploaded"] == 5


@pytest.fixture
def kb(tmp_path):
    for relative, content in {
        "index.md": "# Home",
        "index.md.metadata.json": "{}",
        "Projects/Alpha.md": "# Alpha",
        "Projects/Alpha.md.metadata.json": "{}",
    }.items():
        path = tmp_path / "kb" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return tmp_path / "kb"


def test_mirrors_documents_into_the_site_prefix(kb):
    from umccr_docs.publish import publish_documents

    s3 = FakeS3(
        ["docs/demo/Old.md", "docs/demo/Old.md.metadata.json", "docs/other/index.md"]
        + [f"docs/demo/{name}" for name in ("index.md", "index.md.metadata.json")]
    )
    counts = publish_documents(kb, "ingest", "demo", s3=s3, allow_mass_delete=True, log=lambda _: None)

    assert counts == {"uploaded": 4, "deleted": 2}
    assert "docs/demo/Old.md" not in s3.objects, "a page removed from the site leaves the index"
    assert "docs/other/index.md" in s3.objects, "another site's documents are never touched"
    assert s3.metadata["docs/demo/Projects/Alpha.md"]["ContentType"].startswith("text/markdown")
    assert s3.metadata["docs/demo/index.md.metadata.json"]["ContentType"] == "application/json"


def test_refuses_to_delete_most_documents_without_permission(kb):
    from umccr_docs.publish import publish_documents

    s3 = FakeS3([f"docs/demo/old-{n}.md" for n in range(10)])
    with pytest.raises(DocsError, match="--allow-mass-delete"):
        publish_documents(kb, "ingest", "demo", s3=s3, log=lambda _: None)


def test_refuses_an_empty_export(tmp_path):
    from umccr_docs.publish import publish_documents

    (tmp_path / "kb").mkdir()
    with pytest.raises(DocsError, match="no documents"):
        publish_documents(tmp_path / "kb", "ingest", "demo", s3=FakeS3([]), log=lambda _: None)


def test_the_session_policy_reaches_one_site_only():
    from umccr_docs.aws import session_policy

    policy = json.dumps(session_policy("demo"))
    assert "sites/demo/*" in policy and "docs/demo/*" in policy
    assert "sites/*" not in policy.replace("sites/demo/*", "")
    assert '"s3:*"' not in policy and "cloudfront" not in policy


def test_a_missing_parameter_is_none_and_other_errors_raise():
    from umccr_docs.aws import parameter

    class Missing(Exception):
        response = {"Error": {"Code": "ParameterNotFound"}}

    class Denied(Exception):
        response = {"Error": {"Code": "AccessDeniedException"}}

    class SSM:
        def __init__(self, error):
            self.error = error

        def get_parameter(self, Name):  # noqa: N803
            raise self.error

    assert parameter(SSM(Missing()), "/orcasonar/ingest-bucket-name") is None
    with pytest.raises(Denied):
        parameter(SSM(Denied()), "/orcasonar/ingest-bucket-name")
