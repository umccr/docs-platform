"""
The project contract: what a participating repository's `mkdocs.yml` and Markdown may contain.

Every site on docs.umccr.org shares one browser origin, and the sign-in page keeps Amplify's tokens in that origin's
storage, as the portal apps do. So a site must not be able to run code of its own: the platform owns the theme and
every script, and Markdown may not carry script, event handlers, frames or `javascript:` URLs.
"""

import re
from pathlib import Path

from umccr_docs.config import Project
from umccr_docs.errors import DocsError
from umccr_docs.files import source_files, symlinks_leaving
from umccr_docs.markdown import prose_and_code
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

_UNSAFE_HTML = [
    (re.compile(r"<\s*script\b", re.IGNORECASE), "a <script> element"),
    (re.compile(r"<\s*(iframe|object|embed)\b", re.IGNORECASE), "an embedded frame or object"),
    (re.compile(r"<[a-z][^>]*\son[a-z]+\s*=", re.IGNORECASE), "an HTML event handler attribute"),
    (
        re.compile(r"\]\(\s*<?\s*javascript:|href\s*=\s*[\"']?\s*javascript:", re.IGNORECASE),
        "a javascript: URL",
    ),
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
    # Blank out code, keeping newlines so line numbers stay right.
    scanned = "".join(re.sub(r"[^\n]", " ", part) if is_code else part for part, is_code in prose_and_code(text))
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

    docs_dir = project.docs_dir
    if project.repo_root not in docs_dir.parents and docs_dir != project.repo_root:
        problems.append(f"docs_dir {docs_dir} is outside the repository")
        return problems
    if not docs_dir.is_dir():
        problems.append(f"docs_dir {docs_dir} does not exist")
        return problems

    files = source_files(project.repo_root, docs_dir)
    for escaping in symlinks_leaving(project.repo_root, docs_dir, files):
        problems.append(f"{escaping} is a symlink leading outside the repository")

    for relative in files:
        if relative.suffix.lower() != ".md":
            continue
        text = (docs_dir / relative).read_text(encoding="utf-8", errors="replace")
        for line, description in unsafe_markdown(text):
            problems.append(f"{_display(docs_dir, relative)}:{line}: {description} is not allowed")

    return problems


def _display(docs_dir: Path, relative: Path) -> str:
    return str(Path(docs_dir.name) / relative)


def require_contract(project: Project, slug: str) -> None:
    problems = check_project(project, slug)
    if problems:
        raise DocsError(f"{project.config_path.name} does not meet the docs.umccr.org contract:", problems)
