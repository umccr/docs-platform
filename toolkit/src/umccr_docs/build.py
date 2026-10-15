"""The platform's MkDocs configuration, merged with a project's, and the engine run that builds the site."""

import datetime
import os
import shutil
import subprocess
import sys
import threading
import time
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

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

# Heading anchors follow GitHub's rule (`Pages & views` -> `#pages--views`), so tables of contents written in a
# repository or by an editor keep working on the site. YAML needs a Python tag for this, which safe_dump cannot
# write, so the config carries this placeholder and write_config() swaps the tag in.
_GITHUB_SLUGIFY = "__umccr_github_slugify__"
_GITHUB_SLUGIFY_TAG = "!!python/object/apply:pymdownx.slugs.slugify {kwds: {case: lower}}"

# One set of Markdown extensions for every site, so pages render the same everywhere and the Obsidian adapter can
# rely on them (admonitions for callouts, md_in_html for the properties table, mark and tasklist for vault syntax).
# pymdownx.snippets is deliberately absent: it can include arbitrary repository files into a page.
MARKDOWN_EXTENSIONS: list[Any] = [
    "abbr",
    "admonition",
    "attr_list",
    "def_list",
    "footnotes",
    "md_in_html",
    "tables",
    {"toc": {"permalink": True, "slugify": _GITHUB_SLUGIFY}},
    "pymdownx.details",
    "pymdownx.highlight",
    "pymdownx.inlinehilite",
    "pymdownx.keys",
    "pymdownx.mark",
    "pymdownx.superfences",
    {"pymdownx.tabbed": {"alternate_style": True}},
    {"pymdownx.tasklist": {"custom_checkbox": True}},
]

THEME_FEATURES = [
    "content.code.copy",
    "navigation.indexes",
    "navigation.instant",
    "navigation.top",
    "navigation.tracking",
    "search.highlight",
    "search.suggest",
    "toc.follow",
]


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
    return {
        "source": os.environ.get("UMCCR_DOCS_SOURCE_REPO", project.raw.get("repo_name", "") or ""),
        "source_url": project.repo_url or "",
        "commit": commit[:12],
        "built": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC"),
    }


def effective_config(project: Project, slug: str) -> dict[str, Any]:
    """
    The configuration the engine builds with, written into the work directory next to `docs/` (the preprocessed
    docs) and `theme/` (a copy of the platform theme). Paths are relative to it: MkDocs resolves them against the
    config file, and Zensical requires them inside the project root.
    """
    raw = project.raw
    config: dict[str, Any] = {key: raw[key] for key in _PASSED_THROUGH if key in raw}
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
                "logo": "assets/umccr/logo.svg",
                "favicon": "assets/umccr/logo.svg",
                "features": THEME_FEATURES,
                "palette": [
                    {
                        "media": "(prefers-color-scheme: light)",
                        "scheme": "default",
                        "primary": "custom",
                        "accent": "custom",
                        "toggle": {"icon": "material/brightness-7", "name": "Switch to dark mode"},
                    },
                    {
                        "media": "(prefers-color-scheme: dark)",
                        "scheme": "slate",
                        "primary": "custom",
                        "accent": "custom",
                        "toggle": {"icon": "material/brightness-4", "name": "Switch to light mode"},
                    },
                ],
            },
            "extra_css": ["assets/umccr/umccr.css", *(raw.get("extra_css") or [])],
            "extra_javascript": ["assets/umccr/umccr.js"],
            "markdown_extensions": MARKDOWN_EXTENSIONS,
            "plugins": plugins,
            "extra": {
                **extra,
                # The logo goes to the catalogue, not this site's home.
                "homepage": "/platform/",
                "generator": False,
                "umccr": {"slug": slug, **_provenance(project)},
            },
        }
    )
    return config


def write_config(config: dict[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(config, sort_keys=False, allow_unicode=True)
    path.write_text(text.replace(_GITHUB_SLUGIFY, _GITHUB_SLUGIFY_TAG), encoding="utf-8")
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
    preprocess(project, work_dir / "docs", strict=strict)
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
