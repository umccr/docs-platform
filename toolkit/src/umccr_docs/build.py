"""The platform's MkDocs configuration, merged with a project's, and the engine run that builds the site."""

import datetime
import os
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from importlib import resources
from pathlib import Path
from typing import Any
from urllib.parse import quote

import markdown
import yaml
from pymdownx.slugs import slugify
from pymdownx.superfences import fence_code_format

from umccr_docs.config import ENGINES, Project
from umccr_docs.errors import DocsError
from umccr_docs.files import source_files
from umccr_docs.preprocess import preprocess

# Project keys passed through to the engine unchanged. The contract (contract.py) rejects every other key.
_PASSED_THROUGH = (
    "site_name",
    "site_description",
    "site_author",
    "copyright",
    "repo_url",
    "repo_name",
    "edit_uri",
    "edit_uri_template",
    "nav",
    "not_in_nav",
    "exclude_docs",
    "draft_docs",
    "validation",
    "extra_css",
)

# Python objects in the engine's configuration. YAML needs a Python tag for each, which safe_dump cannot write, so the
# config carries a placeholder, write_config() swaps the tag in, and markdown_renderer() uses the object itself.
# Heading anchors follow GitHub's rule (`Pages & views` -> `#pages--views`), so tables of contents written in a
# repository or by an editor keep working on the site.
_GITHUB_SLUGIFY = "__umccr_github_slugify__"
# A ```mermaid block keeps its text, in <pre class="mermaid">, for the theme to draw as a diagram in the browser.
_FENCE_CODE_FORMAT = "__umccr_fence_code_format__"
_PYTHON_OBJECTS: dict[str, tuple[str, Any]] = {
    _GITHUB_SLUGIFY: (
        "!!python/object/apply:pymdownx.slugs.slugify {kwds: {case: lower}}",
        slugify(case="lower"),
    ),
    _FENCE_CODE_FORMAT: ("!!python/name:pymdownx.superfences.fence_code_format", fence_code_format),
}

# A code block's header names its language the way a reader types it, and a shell block reads as a terminal. Plain
# text gets no header. Keys are Pygments lexer names as pymdownx.highlight title-cases them; others show as named.
_LOWER_CASE_LANGUAGES = "CSS Diff HTML INI JSON JavaScript Makefile Markdown Python SQL TOML TypeScript YAML"
CODE_TITLES = {
    "Text Only": "",
    "Bash": "terminal",
    "Bash Session": "terminal",
    **{name: name.lower() for name in _LOWER_CASE_LANGUAGES.split()},
}

# One set of Markdown extensions for every site, so pages render the same everywhere and the Obsidian adapter can
# rely on them (admonitions for callouts, md_in_html for the properties list, mark and tasklist for vault syntax).
# magiclink links bare URLs (`https://...`, `www....`) and email addresses, as GitHub and Obsidian do.
# superfences leaves a ```mermaid block as its text, which the theme draws as a diagram (umccr.js).
# pymdownx.snippets is deliberately absent: it can include arbitrary repository files into a page.
MARKDOWN_EXTENSIONS: list[Any] = [
    "abbr",
    "admonition",
    "attr_list",
    "def_list",
    "footnotes",
    "md_in_html",
    "tables",
    {"toc": {"permalink": True, "slugify": _GITHUB_SLUGIFY, "title": "On this page"}},
    "pymdownx.details",
    {"pymdownx.highlight": {"auto_title": True, "auto_title_map": CODE_TITLES}},
    "pymdownx.inlinehilite",
    "pymdownx.keys",
    "pymdownx.magiclink",
    "pymdownx.mark",
    {
        "pymdownx.superfences": {
            "custom_fences": [{"name": "mermaid", "class": "mermaid", "format": _FENCE_CODE_FORMAT}],
        }
    },
    {"pymdownx.tabbed": {"alternate_style": True}},
    {"pymdownx.tasklist": {"custom_checkbox": True}},
]

THEME_FEATURES = [
    "content.code.copy",
    "navigation.indexes",
    "navigation.instant",
    # Breadcrumbs: all documentation, the site, then the page's sections (theme/partials/path.html).
    "navigation.path",
    "navigation.top",
    "navigation.tracking",
    "search.highlight",
    "search.suggest",
    "toc.follow",
]


def markdown_renderer() -> Callable[[str], str]:
    """
    Renders a page's body to HTML in this process, with the extensions the engine builds with (both engines use
    Python-Markdown). The contract checks the result, which is what a reader's browser gets.
    """
    names: list[str] = []
    configs: dict[str, dict[str, Any]] = {}
    for extension in MARKDOWN_EXTENSIONS:
        if isinstance(extension, str):
            names.append(extension)
            continue
        ((name, config),) = extension.items()
        names.append(name)
        configs[name] = _with_python_objects(config)
    renderer = markdown.Markdown(extensions=names, extension_configs=configs)
    return lambda text: renderer.reset().convert(text)


def _with_python_objects(value: Any) -> Any:
    """`value` with each placeholder in it replaced by the Python object it stands for."""
    if isinstance(value, dict):
        return {key: _with_python_objects(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_with_python_objects(item) for item in value]
    if isinstance(value, str) and value in _PYTHON_OBJECTS:
        return _PYTHON_OBJECTS[value][1]
    return value


# The theme's own files: every page links the first three, and the theme's script loads the Mermaid runtime on a page
# with a diagram. `verify-site` refuses a site without one of them.
THEME_LOGO = "assets/umccr/logo.svg"
THEME_STYLESHEET = "assets/umccr/umccr.css"
THEME_SCRIPT = "assets/umccr/umccr.js"
THEME_MERMAID = "assets/umccr/mermaid/mermaid.min.js"
THEME_FILES = (THEME_LOGO, THEME_STYLESHEET, THEME_SCRIPT, THEME_MERMAID)

# Octicons, which Material bundles: outline icons that match the theme's own.
THEME_ICONS = {
    "repo": "octicons/mark-github-16",
    "search": "octicons/search-16",
    "top": "octicons/arrow-up-16",
    "admonition": {
        "note": "octicons/info-16",
        "abstract": "octicons/checklist-16",
        "info": "octicons/info-16",
        "tip": "octicons/light-bulb-16",
        "success": "octicons/check-circle-16",
        "question": "octicons/question-16",
        "warning": "octicons/alert-16",
        "failure": "octicons/x-circle-16",
        "danger": "octicons/zap-16",
        "bug": "octicons/bug-16",
        "example": "octicons/beaker-16",
        "quote": "octicons/quote-16",
    },
}


def theme_dir() -> Path:
    return Path(str(resources.files("umccr_docs") / "theme"))


def _provenance(project: Project) -> dict[str, str]:
    """Shown in every page footer: where the site came from and when it was built."""
    commit = os.environ.get("UMCCR_DOCS_COMMIT", "")
    if not commit:
        try:
            commit = subprocess.run(
                ["git", "-C", str(project.repo_root), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            commit = ""
    now = datetime.datetime.now(datetime.UTC)
    return {
        "source": os.environ.get("UMCCR_DOCS_SOURCE_REPO", project.raw.get("repo_name", "") or ""),
        "source_url": project.repo_url or "",
        "commit": commit[:12],
        "built": f"{now.day} {now:%b %Y %H:%M} UTC",
    }


def _home_source(project: Project) -> str:
    """The home note's path in docs_dir, as a URL path, when one is published as index.md; otherwise empty."""
    home = project.platform.home
    if not home or Path(home) == Path("index.md"):
        return ""
    return quote(Path(home).as_posix())


def effective_config(project: Project, slug: str) -> dict[str, Any]:
    """
    The configuration the engine builds with, written into the work directory next to `docs/` (the preprocessed
    docs) and `theme/` (a copy of the platform theme). Paths are relative to it: MkDocs resolves them against the
    config file, and Zensical requires them inside the project root.
    """
    raw = project.raw
    config: dict[str, Any] = {key: raw[key] for key in _PASSED_THROUGH if key in raw}
    # The theme links each page to its file on GitHub, not to GitHub's editor: `edit/<branch>/...` reads as
    # `blob/<branch>/...`, so sites keep the `edit_uri` the templates give them.
    for key in ("edit_uri", "edit_uri_template"):
        value = config.get(key)
        if isinstance(value, str) and value.startswith("edit/"):
            config[key] = "blob/" + value.removeprefix("edit/")
    extra = {key: value for key, value in (raw.get("extra") or {}).items() if key != "platform"}

    plugins = ["search"]
    for plugin in raw.get("plugins") or []:
        name = plugin if isinstance(plugin, str) else next(iter(plugin))
        if name != "search":
            plugins.append(plugin)

    config.update(
        {
            "site_url": raw["site_url"],
            "docs_dir": "docs",
            "site_dir": "site",
            "use_directory_urls": True,
            "theme": {
                "name": "material",
                "custom_dir": "theme",
                "language": "en",
                # System fonts: pages make no third-party requests, and the site's CSP allows none.
                "font": False,
                "logo": THEME_LOGO,
                "favicon": THEME_LOGO,
                "icon": THEME_ICONS,
                "features": THEME_FEATURES,
                "palette": [
                    {
                        "media": "(prefers-color-scheme: light)",
                        "scheme": "default",
                        "primary": "custom",
                        "accent": "custom",
                        "toggle": {"icon": "octicons/sun-16", "name": "Switch to dark mode"},
                    },
                    {
                        "media": "(prefers-color-scheme: dark)",
                        "scheme": "slate",
                        "primary": "custom",
                        "accent": "custom",
                        "toggle": {"icon": "octicons/moon-16", "name": "Switch to light mode"},
                    },
                ],
            },
            "extra_css": [THEME_STYLESHEET, *(raw.get("extra_css") or [])],
            "extra_javascript": [THEME_SCRIPT],
            "markdown_extensions": MARKDOWN_EXTENSIONS,
            "plugins": plugins,
            "extra": {
                **extra,
                # The logo goes to the catalogue, not this site's home.
                "homepage": "/platform/",
                "generator": False,
                # The home note is built as index.md: the theme points its GitHub link back at the note.
                "umccr": {"slug": slug, "home": _home_source(project), **_provenance(project)},
            },
        }
    )
    return config


def write_config(config: dict[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(config, sort_keys=False, allow_unicode=True)
    for placeholder, (tag, _) in _PYTHON_OBJECTS.items():
        text = text.replace(placeholder, tag)
    path.write_text(text, encoding="utf-8")
    return path


def _engine_command(engine: str, action: str, config_path: Path, strict: bool) -> list[str]:
    if engine not in ENGINES:
        raise DocsError(f"Unknown engine '{engine}'")
    if engine == "zensical":
        executable = Path(sys.executable).parent / "zensical"
        command = [str(executable), action, "--config-file", str(config_path)]
    else:
        command = [sys.executable, "-m", "mkdocs", action, "--config-file", str(config_path)]
        if action == "serve":
            command += ["--dev-addr", "127.0.0.1:8000"]
    if strict and action == "build":
        command.append("--strict")
    return command


def work_dir_for(project: Project) -> Path:
    return project.root / ".umccr-docs"


def _prepare(project: Project, slug: str, *, strict: bool) -> tuple[Path, Path]:
    """Fill the work directory (preprocessed docs, the theme, the configuration). Returns (work_dir, config)."""
    work_dir = work_dir_for(project)
    for warning in preprocess(project, work_dir / "docs", strict=strict):
        print(f"warning: {warning}", file=sys.stderr)
    shutil.rmtree(work_dir / "theme", ignore_errors=True)
    shutil.copytree(theme_dir(), work_dir / "theme")
    return work_dir, write_config(effective_config(project, slug), work_dir / "mkdocs.yml")


def build(
    project: Project,
    slug: str,
    site_dir: Path,
    *,
    strict: bool = True,
    engine: str | None = None,
) -> Path:
    """Preprocess, write the merged configuration and build. Returns the site directory."""
    work_dir, config_path = _prepare(project, slug, strict=strict)
    engine = engine or project.platform.engine
    result = subprocess.run(_engine_command(engine, "build", config_path, strict))
    if result.returncode != 0:
        raise DocsError(f"{engine} build failed (exit {result.returncode}); see the output above")

    # The theme ships source maps next to its bundles. Nothing needs them in production, and the publisher never
    # uploads source maps (verify.py), so drop them here.
    built_dir = work_dir / "site"
    for source_map in built_dir.rglob("*.map"):
        source_map.unlink()

    site_dir = site_dir.resolve()
    if site_dir != built_dir.resolve():
        if site_dir.exists():
            shutil.rmtree(site_dir)
        site_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(built_dir), str(site_dir))
    return site_dir


def serve(project: Project, slug: str, *, engine: str | None = None) -> None:
    """Build into a work directory and serve it, re-running the preprocessing whenever a source file changes."""
    work_dir, config_path = _prepare(project, slug, strict=False)
    docs_out = work_dir / "docs"

    def snapshot() -> dict[Path, float]:
        files = source_files(project.repo_root, project.docs_dir)
        return {path: (project.docs_dir / path).stat().st_mtime for path in files}

    def watch() -> None:
        seen = snapshot()
        while True:
            time.sleep(1)
            current = snapshot()
            if current != seen:
                seen = current
                for problem in preprocess(project, docs_out, strict=False):
                    print(f"warning: {problem}", file=sys.stderr)

    threading.Thread(target=watch, daemon=True).start()
    engine = engine or project.platform.engine
    subprocess.run(_engine_command(engine, "serve", config_path, strict=False))
