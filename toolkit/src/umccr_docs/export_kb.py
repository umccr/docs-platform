"""
Export a site's pages as documents for OrcaSonar's knowledge base.

The export starts from the same preprocessed docs the site is built from, so documents always match the published
pages: wikilinks resolved, Bases rendered as tables, callouts converted, the home note as `index.md`. On top of that:

- front matter is removed: the metadata file carries what retrieval needs;
- links between pages become absolute docs.umccr.org URLs, so a passage quoted out of context still points somewhere;
- each page gets `<path>.md.metadata.json` beside it, in the typed metadata format Bedrock knowledge bases read,
  managed ones included (`{"metadataAttributes": {"site": {"value": {"type": "STRING", "stringValue": ...}}}}`).

`doc_id` is `<slug>:<path without .md>`. It does not change when a page is edited, so OrcaSonar's citations and its
`/documents/{id}` links stay valid across releases. Non-Markdown files (images, attachments) are not exported.
"""

import datetime
import json
import posixpath
import re
import shutil
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote

from umccr_docs.config import Project
from umccr_docs.markdown import map_prose, split_frontmatter
from umccr_docs.preprocess import preprocess
from umccr_docs.slug import site_url_for, validate_slug

METADATA_SUFFIX = ".metadata.json"

_MARKDOWN_LINK = re.compile(
    r"(?P<bang>!?)\[(?P<label>[^\]\n]*)\]\((?P<url><[^>\n]*>|[^)\s]+)(?P<title>\s+\"[^\"\n]*\")?\)"
)
_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_HEADING = re.compile(r"^#[ \t]+(?P<title>.+?)[ \t#]*$", re.MULTILINE)
_TITLE = re.compile(r"^title:[ \t]*(?P<title>.+?)[ \t]*$", re.MULTILINE)


def page_path(relative: PurePosixPath, *, directory_urls: bool = True) -> str:
    """
    The page's path below the site root, as MkDocs publishes it: `a/b.md` is `a/b/`, `a/index.md` and `a/README.md`
    are `a/`, and with `use_directory_urls: false`, `a/b.md` is `a/b.html`.
    """
    stem = relative.with_suffix("")
    if stem.name.lower() in ("index", "readme"):
        directory = stem.parent.as_posix()
        return "" if directory == "." else f"{directory}/"
    if directory_urls:
        return f"{stem.as_posix()}/"
    return f"{stem.as_posix()}.html"


def page_url(site_url: str, relative: PurePosixPath, *, directory_urls: bool = True) -> str:
    return site_url + quote(page_path(relative, directory_urls=directory_urls))


def doc_id(slug: str, relative: PurePosixPath) -> str:
    return f"{slug}:{relative.with_suffix('').as_posix()}"


def metadata_file(attributes: dict[str, str]) -> dict:
    """The `.metadata.json` content for string attributes. Retrieval can filter on any of them, `site` above all."""
    return {
        "metadataAttributes": {
            name: {"value": {"type": "STRING", "stringValue": value}} for name, value in attributes.items()
        }
    }


def page_title(frontmatter: str, body: str, relative: PurePosixPath) -> str:
    """The page's title, as a reader would see it: front matter `title`, else its first heading, else its name."""
    match = _TITLE.search(frontmatter)
    if match:
        return match.group("title").strip("'\"")
    match = _HEADING.search(body)
    if match:
        return match.group("title").strip()
    stem = relative.with_suffix("").name
    return relative.parent.name or "Home" if stem.lower() in ("index", "readme") else stem


def absolute_links(body: str, relative: PurePosixPath, site_url: str, *, directory_urls: bool = True) -> str:
    """Rewrite relative links between pages, and to images, as absolute URLs on the docs site."""

    def replace(match: re.Match[str]) -> str:
        url = match.group("url").strip("<>")
        if not url or url.startswith("#") or _SCHEME.match(url):
            return match.group(0)
        path_part, hash_mark, anchor = url.partition("#")
        if url.startswith("/") or not path_part:
            return match.group(0)
        target = PurePosixPath(posixpath.normpath(posixpath.join(relative.parent.as_posix(), unquote(path_part))))
        if target.as_posix().startswith(".."):
            return match.group(0)
        if target.suffix.lower() == ".md":
            new_url = page_url(site_url, target, directory_urls=directory_urls)
        else:
            new_url = site_url + quote(target.as_posix())
        fragment = f"#{anchor}" if hash_mark else ""
        return f"{match.group('bang')}[{match.group('label')}]({new_url}{fragment}{match.group('title') or ''})"

    return map_prose(body, lambda text: _MARKDOWN_LINK.sub(replace, text))


def export_kb(
    project: Project,
    slug: str,
    out_dir: Path,
    *,
    commit: str = "",
    today: datetime.date | None = None,
    log=print,
) -> int:
    """
    Write `<path>.md` and `<path>.md.metadata.json` for every page into `out_dir`, replacing what is there.
    Returns the number of documents written.
    """
    validate_slug(slug)
    site_url = site_url_for(slug)
    directory_urls = project.raw.get("use_directory_urls", True) is not False
    updated = (today or datetime.datetime.now(datetime.UTC).date()).isoformat()

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    written = 0
    with tempfile.TemporaryDirectory(prefix="umccr-docs-kb-") as scratch:
        docs = Path(scratch) / "docs"
        preprocess(project, docs, strict=True)
        for path in sorted(docs.rglob("*.md")):
            relative = PurePosixPath(path.relative_to(docs).as_posix())
            frontmatter, body = split_frontmatter(path.read_text(encoding="utf-8"))
            if not body.strip():
                continue
            body = absolute_links(body, relative, site_url, directory_urls=directory_urls).strip() + "\n"

            target = out_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding="utf-8")
            metadata = metadata_file(
                {
                    "doc_id": doc_id(slug, relative),
                    "site": slug,
                    "title": page_title(frontmatter, body, relative),
                    "url": page_url(site_url, relative, directory_urls=directory_urls),
                    "commit": commit,
                    "updated": updated,
                }
            )
            target.with_name(target.name + METADATA_SUFFIX).write_text(
                json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            written += 1

    log(f"Exported {written} documents to {out_dir}")
    return written
