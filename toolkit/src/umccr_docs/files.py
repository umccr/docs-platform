"""Which files make up a site."""

import os
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

from pathspec.gitignore import GitIgnoreSpec

from umccr_docs.errors import DocsError


def repo_root_for(path: Path) -> Path:
    """The git repository containing `path`, or `path` itself outside a repository."""
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
        return Path(result.stdout.strip()).resolve()
    except (OSError, subprocess.CalledProcessError):
        return path.resolve()


def _is_hidden(relative: Path) -> bool:
    return any(part.startswith(".") for part in relative.parts)


def source_files(repo_root: Path, docs_dir: Path) -> list[Path]:
    """
    Files under `docs_dir` that git would commit: tracked files plus new files git does not ignore. Anything git
    ignores (local scratch, `.local/`, editor state) is never built, so a local preview matches CI, which only has
    what was pushed. Dotfiles and dot-directories, such as `.obsidian/`, are skipped too.

    Returned relative to `docs_dir`, sorted.
    """
    docs_dir = docs_dir.resolve()
    try:
        relative_docs = docs_dir.relative_to(repo_root)
        result = subprocess.run(
            [
                "git",
                "-C",
                str(repo_root),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                str(relative_docs),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError, ValueError):
        result = None

    if result is not None:
        files = set()
        for entry in filter(None, result.stdout.split("\0")):
            path = repo_root / entry
            if not (path.is_file() or path.is_symlink()):
                continue  # deleted in the working tree
            relative = Path(os.path.relpath(path, docs_dir))
            if not _is_hidden(relative):
                files.add(relative)
        return sorted(files)

    # Not a git checkout: fall back to every non-hidden file.
    return sorted(
        path.relative_to(docs_dir)
        for path in docs_dir.rglob("*")
        if path.is_file() and not _is_hidden(path.relative_to(docs_dir))
    )


# Excluded before exclude_docs's own patterns, as MkDocs does (mkdocs.structure.files.set_exclusions).
_ENGINE_EXCLUDES = [".*", "/templates/"]


def _patterns(raw: dict[str, Any], key: str) -> list[str]:
    value = raw.get(key)
    if value is None:
        return []
    if not isinstance(value, str):
        raise DocsError(f"{key} must be a multi-line string of gitignore patterns, as MkDocs expects")
    return value.splitlines()


def published_pages(raw: dict[str, Any], docs_dir: Path) -> list[PurePosixPath]:
    """
    The Markdown pages under a built docs directory that the engine publishes, relative to it: not matched by
    `exclude_docs` or `draft_docs` (drafts appear only in a local preview), and not a README.md beside an index.md.
    These are MkDocs' rules, so an export holds exactly the pages readers can open.
    """
    excluded = GitIgnoreSpec.from_lines([*_ENGINE_EXCLUDES, *_patterns(raw, "exclude_docs")])
    drafts = GitIgnoreSpec.from_lines(_patterns(raw, "draft_docs"))
    pages = []
    for path in sorted(docs_dir.rglob("*.md")):
        relative = PurePosixPath(path.relative_to(docs_dir).as_posix())
        if not (excluded.match_file(relative.as_posix()) or drafts.match_file(relative.as_posix())):
            pages.append(relative)
    published = set(pages)
    # MkDocs publishes README.md as its folder's index page, unless the folder has an index.md.
    return [page for page in pages if not (page.name == "README.md" and page.with_name("index.md") in published)]


def symlinks_leaving(root: Path, base: Path, files: list[Path]) -> list[Path]:
    """Files under `base` that are symlinks resolving outside `root`."""
    escaping = []
    for relative in files:
        path = base / relative
        if path.is_symlink():
            target = path.resolve()
            if root.resolve() not in target.parents and target != root.resolve():
                escaping.append(relative)
    return escaping
