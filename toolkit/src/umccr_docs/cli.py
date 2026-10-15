"""`umccr-docs`: check, build, preview, export and publish a documentation site."""

import argparse
import sys
from pathlib import Path

from umccr_docs import __version__
from umccr_docs.aws import (
    DOCS_CONTENT_BUCKET_PARAMETER,
    ORCASONAR_INGEST_BUCKET_PARAMETER,
    parameter,
    publisher_session,
)
from umccr_docs.build import build, serve, work_dir_for
from umccr_docs.config import ENGINES, load_project
from umccr_docs.contract import require_contract
from umccr_docs.errors import DocsError
from umccr_docs.export_kb import export_kb
from umccr_docs.preprocess import preprocess
from umccr_docs.publish import live_release, provenance_from_environment, publish, publish_documents
from umccr_docs.slug import slug_from_site_url
from umccr_docs.verify import verify_site


def _slug(args: argparse.Namespace, site_url: object) -> str:
    slug = args.slug or slug_from_site_url(site_url if isinstance(site_url, str) else None)
    if not slug:
        raise DocsError("Pass --slug, or set site_url to https://docs.umccr.org/<slug>/")
    return slug


def _check(args: argparse.Namespace) -> None:
    project = load_project(Path(args.config))
    slug = _slug(args, project.raw.get("site_url"))
    require_contract(project, slug)
    print(f"{project.config_path.name} meets the contract for docs.umccr.org/{slug}/")


def _preprocess(args: argparse.Namespace) -> None:
    project = load_project(Path(args.config))
    out_dir = Path(args.out) if args.out else work_dir_for(project) / "docs"
    problems = preprocess(project, out_dir, strict=not args.no_strict)
    for problem in problems:
        print(f"warning: {problem}", file=sys.stderr)
    print(f"Wrote {out_dir}")


def _build(args: argparse.Namespace) -> None:
    project = load_project(Path(args.config))
    slug = _slug(args, project.raw.get("site_url"))
    require_contract(project, slug)
    site_dir = build(project, slug, Path(args.site_dir), strict=not args.no_strict, engine=args.engine)
    print(f"Built {site_dir}")


def _serve(args: argparse.Namespace) -> None:
    project = load_project(Path(args.config))
    slug = _slug(args, project.raw.get("site_url"))
    require_contract(project, slug)
    serve(project, slug, engine=args.engine)


def _verify(args: argparse.Namespace) -> None:
    problems = verify_site(Path(args.site_dir))
    if problems:
        raise DocsError(f"{args.site_dir} is not safe to publish:", problems)
    print(f"{args.site_dir} passed the pre-publish checks")


def _export_kb(args: argparse.Namespace) -> None:
    project = load_project(Path(args.config))
    slug = _slug(args, project.raw.get("site_url"))
    require_contract(project, slug)
    export_kb(project, slug, Path(args.out), commit=args.commit)


def _publish(args: argparse.Namespace) -> None:
    if not args.bucket and not args.role_arn:
        raise DocsError("Pass --bucket, or --role-arn to publish as the stage's docs-publisher role")

    ssm = None
    if args.role_arn:
        session = publisher_session(args.role_arn, args.slug)
        s3, ssm = session.client("s3"), session.client("ssm")
    else:
        import boto3

        s3 = boto3.client("s3")
    bucket = args.bucket or parameter(ssm, DOCS_CONTENT_BUCKET_PARAMETER)
    if not bucket:
        raise DocsError(f"{DOCS_CONTENT_BUCKET_PARAMETER} is missing here; deploy the hosting stack first")

    # Newer release wins, for documents too: check before writing anything.
    if args.release is not None:
        live = live_release(s3, bucket, args.slug)
        if live is not None and live > args.release:
            print(f"Skipping release {args.release} of {args.slug}: release {live} is already live")
            return

    if args.documents:
        documents_bucket = args.documents_bucket or (parameter(ssm, ORCASONAR_INGEST_BUCKET_PARAMETER) if ssm else None)
        if documents_bucket:
            counts = publish_documents(
                Path(args.documents),
                documents_bucket,
                args.slug,
                s3=s3,
                allow_mass_delete=args.allow_mass_delete,
                dry_run=args.dry_run,
            )
            print(f"Exported {counts['uploaded']} files to OrcaSonar, deleted {counts['deleted']} stale ones")
        else:
            print(
                f"warning: {ORCASONAR_INGEST_BUCKET_PARAMETER} does not exist in this account, so OrcaSonar is not "
                "deployed here yet; the documents were not exported",
                file=sys.stderr,
            )

    counts = publish(
        Path(args.site_dir),
        bucket,
        args.slug,
        s3=s3,
        allow_mass_delete=args.allow_mass_delete,
        dry_run=args.dry_run,
        provenance=provenance_from_environment(),
        release=args.release,
    )
    print(f"Uploaded {counts['uploaded']} files, deleted {counts['deleted']} stale objects")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="umccr-docs", description=__doc__)
    root.add_argument("--version", action="version", version=f"umccr-docs {__version__}")
    commands = root.add_subparsers(dest="command", required=True)

    def project_command(name: str, help_text: str) -> argparse.ArgumentParser:
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--config", default="mkdocs.yml", help="project configuration (default: mkdocs.yml)")
        command.add_argument("--slug", help="the site's slug; defaults to the one in site_url")
        return command

    check = project_command("check", "check mkdocs.yml and the Markdown against the platform contract")
    check.set_defaults(handler=_check)

    pre = commands.add_parser("preprocess", help="write the preprocessed docs directory")
    pre.add_argument("--config", default="mkdocs.yml")
    pre.add_argument("--out", help="output directory (default: .umccr-docs/docs)")
    pre.add_argument("--no-strict", action="store_true", help="report problems as warnings")
    pre.set_defaults(handler=_preprocess)

    build_command = project_command("build", "check, preprocess and build the site")
    build_command.add_argument("--site-dir", default="site", help="output directory (default: site)")
    build_command.add_argument("--engine", choices=ENGINES, help="override extra.platform.engine")
    build_command.add_argument("--no-strict", action="store_true", help="do not fail on warnings")
    build_command.set_defaults(handler=_build)

    serve_command = project_command("serve", "preview the site on http://127.0.0.1:8000 with live reload")
    serve_command.add_argument("--engine", choices=ENGINES)
    serve_command.set_defaults(handler=_serve)

    verify = commands.add_parser("verify-site", help="check a built site before publishing")
    verify.add_argument("site_dir")
    verify.set_defaults(handler=_verify)

    export = project_command("export-kb", "export the pages as documents for OrcaSonar's knowledge base")
    export.add_argument("--out", default="kb", help="output directory (default: kb)")
    export.add_argument("--commit", default="", help="the commit the site was built from, recorded per document")
    export.set_defaults(handler=_export_kb)

    publish_command = commands.add_parser("publish", help="upload a built site to its S3 prefix")
    publish_command.add_argument("site_dir")
    publish_command.add_argument("--slug", required=True)
    publish_command.add_argument("--bucket", help="the docs bucket; read from SSM when --role-arn is given")
    publish_command.add_argument(
        "--role-arn", help="assume this docs-publisher role, narrowed to the site (the site pipeline does)"
    )
    publish_command.add_argument("--release", type=int, help="skip unless this release is newer than the live one")
    publish_command.add_argument("--documents", help="an export-kb directory to publish to OrcaSonar first")
    publish_command.add_argument("--documents-bucket", help="OrcaSonar's ingest bucket; read from SSM by default")
    publish_command.add_argument("--allow-mass-delete", action="store_true")
    publish_command.add_argument("--dry-run", action="store_true")
    publish_command.set_defaults(handler=_publish)

    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        args.handler(args)
    except DocsError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
