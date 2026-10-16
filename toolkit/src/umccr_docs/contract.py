"""
The project contract: what a participating repository's `mkdocs.yml` and Markdown may contain.

Every site on docs.umccr.org shares one browser origin, and the sign-in page keeps Amplify's tokens in that origin's
storage, as the portal apps do. So a site must not be able to run code of its own: the platform owns the theme and
every script, and Markdown may not carry script, event handlers, frames or `javascript:` URLs.

Pages are checked as the engine renders them, after preprocessing: attribute lists (`{ onerror=... }`), raw HTML,
entities and front matter values all reach the page that way. The theme prints configuration and front matter values
without escaping them, so those may not carry markup that runs code either. `verify-site` checks the built pages
again, for what a value could still do inside an attribute.
"""

import re
import tempfile
from collections.abc import Iterator
from pathlib import Path

from mkdocs.utils.meta import get_data

from umccr_docs.active_content import EMBED, HANDLER, NOT_UTF8, SCRIPT, SCRIPT_URL, decode_document, unsafe_html
from umccr_docs.build import markdown_renderer
from umccr_docs.config import Project
from umccr_docs.errors import DocsError
from umccr_docs.files import source_files, symlinks_leaving
from umccr_docs.markdown import mask_code
from umccr_docs.media_types import content_type_for, is_document
from umccr_docs.preprocess import output_paths, preprocess
from umccr_docs.slug import site_url_for, validate_slug

# Top-level keys a project may set. The platform sets the rest (theme, extensions, scripts, output).
ALLOWED_KEYS = frozenset(
    {
        "site_name",
        "site_description",
        "site_author",
        "site_url",
        "copyright",
        "repo_url",
        "repo_name",
        "edit_uri",
        "edit_uri_template",
        "docs_dir",
        "nav",
        "not_in_nav",
        "exclude_docs",
        "draft_docs",
        "validation",
        "use_directory_urls",
        "extra",
        "extra_css",
        "plugins",
    }
)

# Plugins a project may enable, beyond the platform's own. Both engines support them natively.
ALLOWED_PLUGINS = frozenset({"search", "tags"})

# `extra` keys the theme turns into scripts: polyfill script tags, an analytics snippet and the cookie consent script.
PLATFORM_EXTRA_KEYS = frozenset({"polyfills", "analytics", "consent"})

# Where the theme's scripts are served from. A file here in docs_dir would replace the platform's.
PLATFORM_ASSET_DIRS = ("assets/javascripts/", "assets/umccr/")

# Where in the source a finding of the rendered check is, so it can be reported with its line.
_UNSAFE_HTML = [
    (re.compile(r"<\s*script\b", re.IGNORECASE), SCRIPT),
    (re.compile(r"<\s*(iframe|object|embed)\b", re.IGNORECASE), EMBED),
    (re.compile(r"<[a-z][^>]*\son[a-z]+\s*=", re.IGNORECASE), HANDLER),
    (re.compile(r"\]\(\s*<?\s*javascript:|href\s*=\s*[\"']?\s*javascript:", re.IGNORECASE), SCRIPT_URL),
]


def _plugin_names(plugins: object) -> list[str]:
    if plugins is None:
        return []
    if not isinstance(plugins, list):
        return ["<invalid>"]
    names = []
    for plugin in plugins:
        if isinstance(plugin, str):
            names.append(plugin)
        elif isinstance(plugin, dict) and len(plugin) == 1:
            names.append(next(iter(plugin)))
        else:
            names.append("<invalid>")
    return names


def unsafe_markdown(text: str) -> list[tuple[int, str]]:
    """(line, description) for each unsafe construct outside code. Code samples may show HTML."""
    scanned = mask_code(text)
    findings = [
        (scanned.count("\n", 0, match.start()) + 1, description)
        for pattern, description in _UNSAFE_HTML
        for match in pattern.finditer(scanned)
    ]
    return sorted(findings)


def check_project(project: Project, slug: str) -> list[str]:
    """Every contract problem, as human-readable lines. An empty list means the project passes."""
    problems: list[str] = []

    try:
        validate_slug(slug)
    except DocsError as error:
        problems.append(str(error))

    raw = project.raw
    expected_url = site_url_for(slug)
    if raw.get("site_url") != expected_url:
        problems.append(f"site_url must be {expected_url} (found {raw.get('site_url')!r})")

    for key in sorted(set(raw) - ALLOWED_KEYS):
        problems.append(f"'{key}' is set by the platform and may not appear in {project.config_path.name}")

    if raw.get("use_directory_urls", True) is not True:
        problems.append("use_directory_urls must stay true: the edge serves <page>/index.html")

    for name in _plugin_names(raw.get("plugins")):
        if name not in ALLOWED_PLUGINS:
            problems.append(f"plugin '{name}' is not supported; allowed: {', '.join(sorted(ALLOWED_PLUGINS))}")

    for stylesheet in raw.get("extra_css") or []:
        if not isinstance(stylesheet, str) or re.match(r"^[a-z]+:|^//", stylesheet, re.IGNORECASE):
            problems.append(f"extra_css entry {stylesheet!r} must be a stylesheet inside docs_dir")

    extra = raw.get("extra")
    for key in sorted(PLATFORM_EXTRA_KEYS & set(extra if isinstance(extra, dict) else ())):
        problems.append(f"'extra.{key}' is set by the platform and may not appear in {project.config_path.name}")

    # The theme prints these values as they are, inside the page's markup.
    for where, value in _strings(raw):
        for description in unsafe_html(value):
            problems.append(f"{project.config_path.name}: {where}: {description} is not allowed")

    docs_dir = project.docs_dir
    if project.repo_root not in docs_dir.parents and docs_dir != project.repo_root:
        problems.append(f"docs_dir {docs_dir} is outside the repository")
        return problems
    if not docs_dir.is_dir():
        problems.append(f"docs_dir {docs_dir} does not exist")
        return problems

    files = source_files(project.repo_root, docs_dir)
    escaping = symlinks_leaving(project.repo_root, docs_dir, files)
    for path in escaping:
        problems.append(f"{path} is a symlink leading outside the repository")
    # Nothing below reads through a link that leaves the repository.
    files = [relative for relative in files if relative not in escaping]

    for relative in files:
        shown = _display(docs_dir, relative)
        if relative.as_posix().startswith(PLATFORM_ASSET_DIRS):
            problems.append(f"{shown}: {' and '.join(PLATFORM_ASSET_DIRS)} hold the platform theme's scripts")
        if is_document(content_type_for(relative.as_posix())):
            # Copied to the site as it is, and run as a document when opened.
            text = decode_document((docs_dir / relative).read_bytes())
            if text is None:
                problems.append(f"{shown}: {NOT_UTF8}")
                continue
            for description in unsafe_html(text):
                problems.append(f"{shown}: {description} is not allowed")

    rendered = None if escaping else _rendered_pages(project, files)
    for relative in files:
        if relative.suffix.lower() != ".md":
            continue
        shown = _display(docs_dir, relative)
        text = (docs_dir / relative).read_text(encoding="utf-8", errors="replace")
        # The rendered page decides; the source scan only says where. A finding the page does not have was in code
        # the scan took for prose, and is dropped rather than rejecting a valid sample.
        page = None if rendered is None else rendered.get(relative, [])
        found = [
            (line, description) for line, description in unsafe_markdown(text) if page is None or description in page
        ]
        for line, description in found:
            problems.append(f"{shown}:{line}: {description} is not allowed")
        reported = {description for _, description in found}
        for description in page or []:
            if description not in reported:
                problems.append(f"{shown}: the rendered page has {description}, which is not allowed")

    return problems


def _strings(value: object, where: str = "") -> Iterator[tuple[str, str]]:
    """Every string in a YAML value, mapping keys included (nav titles are keys), with where it is."""
    if isinstance(value, str):
        yield where, value
    elif isinstance(value, dict):
        for key, item in value.items():
            inside = f"{where}.{key}" if where else str(key)
            if isinstance(key, str):
                yield inside, key
            yield from _strings(item, inside)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _strings(item, f"{where}[{index}]")


def _rendered_pages(project: Project, files: list[Path]) -> dict[Path, list[str]]:
    """What could run code in each Markdown page as the engine renders it, front matter values included."""
    outputs = output_paths(project, files, [])
    render = markdown_renderer()
    found: dict[Path, list[str]] = {}
    with tempfile.TemporaryDirectory(prefix="umccr-docs-check-") as scratch:
        docs = Path(scratch) / "docs"
        # Broken links are the build's to report. Preprocessing is what turns properties, Bases and wikilinks into
        # page content, so the pages are checked after it.
        preprocess(project, docs, strict=False)
        for relative in files:
            if relative.suffix.lower() != ".md":
                continue
            # Split as MkDocs splits it: front matter that is not valid YAML stays part of the page.
            body, meta = get_data((docs / outputs[relative]).read_text(encoding="utf-8"))
            descriptions = unsafe_html(render(body))
            for _, value in _strings(meta):
                descriptions += unsafe_html(value)
            found[relative] = list(dict.fromkeys(descriptions))
    return found


def _display(docs_dir: Path, relative: Path) -> str:
    return str(Path(docs_dir.name) / relative)


def require_contract(project: Project, slug: str) -> None:
    problems = check_project(project, slug)
    if problems:
        raise DocsError(f"{project.config_path.name} does not meet the docs.umccr.org contract:", problems)
