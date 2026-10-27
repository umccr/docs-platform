"""A participating repository's `mkdocs.yml`, and the platform settings under `extra.platform`."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from umccr_docs.errors import DocsError
from umccr_docs.files import repo_root_for

SOURCE_FORMATS = ("markdown", "obsidian")
ENGINES = ("mkdocs", "zensical")


@dataclass(frozen=True)
class ObsidianSettings:
    # Folders to prefer, in order, when a wikilink name matches notes in more than one folder.
    prefer_folders: tuple[str, ...] = ()
    # Explicit sort order for text properties in Bases views, lowest first, e.g. priority: [Low, Medium, High].
    sort_orders: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class PlatformSettings:
    source_format: str = "markdown"
    # A note to publish as the site's index page, e.g. Home.md.
    home: str | None = None
    # Frontmatter properties shown in a table at the top of each page (Obsidian sites).
    properties: tuple[str, ...] = ()
    engine: str = "mkdocs"
    obsidian: ObsidianSettings = field(default_factory=ObsidianSettings)


@dataclass(frozen=True)
class Project:
    config_path: Path
    repo_root: Path
    raw: dict[str, Any]
    docs_dir: Path
    platform: PlatformSettings

    @property
    def root(self) -> Path:
        """The directory holding `mkdocs.yml`; MkDocs resolves relative paths against it."""
        return self.config_path.parent

    @property
    def repo_url(self) -> str | None:
        value = self.raw.get("repo_url")
        return value.rstrip("/") if isinstance(value, str) else None


def _string_list(value: Any, name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise DocsError(f"extra.platform.{name} must be a list of strings")
    return tuple(value)


def _platform_settings(raw: dict[str, Any]) -> PlatformSettings:
    extra = raw.get("extra") or {}
    settings = extra.get("platform") or {}
    if not isinstance(settings, dict):
        raise DocsError("extra.platform must be a mapping")

    source_format = settings.get("source_format", "markdown")
    if source_format not in SOURCE_FORMATS:
        raise DocsError(f"extra.platform.source_format must be one of {', '.join(SOURCE_FORMATS)}")

    engine = settings.get("engine", "mkdocs")
    if engine not in ENGINES:
        raise DocsError(f"extra.platform.engine must be one of {', '.join(ENGINES)}")

    home = settings.get("home")
    if home is not None and not isinstance(home, str):
        raise DocsError("extra.platform.home must be a path relative to docs_dir")

    obsidian = settings.get("obsidian") or {}
    if not isinstance(obsidian, dict):
        raise DocsError("extra.platform.obsidian must be a mapping")
    sort_orders_raw = obsidian.get("sort_orders") or {}
    if not isinstance(sort_orders_raw, dict):
        raise DocsError("extra.platform.obsidian.sort_orders must map a property to a list of values")

    return PlatformSettings(
        source_format=source_format,
        home=home,
        properties=_string_list(settings.get("properties"), "properties"),
        engine=engine,
        obsidian=ObsidianSettings(
            prefer_folders=_string_list(obsidian.get("prefer_folders"), "obsidian.prefer_folders"),
            sort_orders={
                str(name): _string_list(values, f"obsidian.sort_orders.{name}")
                for name, values in sort_orders_raw.items()
            },
        ),
    )


def load_project(config_path: Path) -> Project:
    config_path = config_path.resolve()
    if not config_path.is_file():
        raise DocsError(f"{config_path} does not exist")

    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as error:
        raise DocsError(
            f"{config_path.name} is not plain YAML: {error}. "
            "Custom tags such as !ENV and !!python/name are not supported."
        ) from error
    if not isinstance(raw, dict):
        raise DocsError(f"{config_path.name} must be a mapping")

    docs_dir_value = raw.get("docs_dir", "docs")
    if not isinstance(docs_dir_value, str):
        raise DocsError("docs_dir must be a path")

    return Project(
        config_path=config_path,
        repo_root=repo_root_for(config_path.parent),
        raw=raw,
        docs_dir=(config_path.parent / docs_dir_value).resolve(),
        platform=_platform_settings(raw),
    )
