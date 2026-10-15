"""
Copy a project's docs into a build directory, turning source-specific syntax into plain Markdown on the way.

Both source formats get the same treatment for links that leave `docs_dir` (for example to the repository's
README): they point at the file in the source repository instead of failing the build. Obsidian vaults also get
wikilinks, Bases tables, callouts, comments and the properties table; see `umccr_docs.obsidian`.
"""

import os
import posixpath
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote

from umccr_docs.config import Project
from umccr_docs.errors import DocsError
from umccr_docs.files import source_files
from umccr_docs.markdown import map_prose, split_frontmatter
from umccr_docs.obsidian.bases import render_bases
from umccr_docs.obsidian.callouts import convert_callouts
from umccr_docs.obsidian.links import rewrite_wikilinks
from umccr_docs.obsidian.properties import insert_properties
from umccr_docs.obsidian.vault import Note, Vault

_MARKDOWN_LINK = re.compile(
    r"(?P<bang>!?)\[(?P<label>[^\]\n]*)\]\((?P<url><[^>\n]*>|[^)\s]+)(?P<title>\s+\"[^\"\n]*\")?\)"
)
_OBSIDIAN_COMMENT = re.compile(r"%%.*?%%", re.DOTALL)
_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def _default_branch(project: Project) -> str:
    """The branch in `edit_uri` (`edit/<branch>/...` or `blob/<branch>/...`), or `main`."""
    edit_uri = project.raw.get("edit_uri")
    if isinstance(edit_uri, str):
        match = re.match(r"^(?:edit|blob)/([^/]+)/", edit_uri)
        if match:
            return match.group(1)
    return "main"


class _LinkRewriter:
    """Rewrites Markdown links in one file: home renames, and links that leave docs_dir."""

    def __init__(self, project: Project, outputs: dict[Path, Path]) -> None:
        self.project = project
        self.docs_dir = project.docs_dir
        self.outputs = outputs
        self.branch = _default_branch(project)

    def rewrite(self, body: str, source: Path, problems: list[str]) -> str:
        def replace(match: re.Match[str]) -> str:
            url = match.group("url").strip("<>")
            if not url or url.startswith(("#", "/")) or _SCHEME.match(url):
                return match.group(0)
            path_part, hash_mark, anchor = url.partition("#")
            if not path_part:
                return match.group(0)

            target = (self.docs_dir / source.parent / unquote(path_part)).resolve()
            fragment = f"#{anchor}" if hash_mark else ""
            if target == self.docs_dir or self.docs_dir in target.parents:
                new_url = self._internal(target, source)
                if new_url is None:
                    return match.group(0)
            else:
                new_url = self._external(target, match.group("bang") == "!", source, url, problems)
                if new_url is None:
                    return match.group(0)
            title = match.group("title") or ""
            return f"{match.group('bang')}[{match.group('label')}]({new_url}{fragment}{title})"

        return map_prose(body, lambda text: _MARKDOWN_LINK.sub(replace, text))

    def _internal(self, target: Path, source: Path) -> str | None:
        """Only links to a renamed page (the home note) change; the rest of the tree is copied as it is."""
        relative = target.relative_to(self.docs_dir)
        output = self.outputs.get(relative)
        if output is None or output == relative:
            return None
        start = posixpath.dirname(self.outputs[source].as_posix()) or "."
        return posixpath.relpath(output.as_posix(), start)

    def _external(self, target: Path, is_image: bool, source: Path, url: str, problems: list[str]) -> str | None:
        repo_root = self.project.repo_root
        if is_image:
            problems.append(f"{source}: image {url} is outside docs_dir; move it inside so it is published")
            return None
        if repo_root not in target.parents:
            problems.append(f"{source}: link {url} leaves the repository")
            return None
        repo_url = self.project.repo_url
        if not repo_url:
            problems.append(f"{source}: link {url} leaves docs_dir; set repo_url so it can point at the repository")
            return None
        return f"{repo_url}/blob/{self.branch}/{quote(target.relative_to(repo_root).as_posix())}"


def output_paths(project: Project, files: list[Path], problems: list[str]) -> dict[Path, Path]:
    """Where each source file goes in the preprocessed docs: where it is, except the home note, which is index.md."""
    outputs = {relative: relative for relative in files}
    home = project.platform.home
    if home:
        home_path = Path(home)
        if home_path not in outputs:
            problems.append(f"extra.platform.home: {home} is not in docs_dir")
        elif home_path != Path("index.md"):
            if Path("index.md") in outputs:
                problems.append(f"docs_dir has both index.md and the home note {home}; keep one")
            outputs[home_path] = Path("index.md")
    return outputs


def preprocess(project: Project, out_dir: Path, *, strict: bool = True) -> list[str]:
    """
    Write the site's docs into `out_dir`. Returns the problems found; raises DocsError instead when `strict`.
    """
    problems: list[str] = []
    files = source_files(project.repo_root, project.docs_dir)
    outputs = output_paths(project, files, problems)
    markdown_files = [relative for relative in files if relative.suffix.lower() == ".md"]

    obsidian = project.platform.source_format == "obsidian"
    vault: Vault | None = None
    if obsidian:
        vault, frontmatter_problems = Vault.load(
            project.docs_dir, markdown_files, outputs, project.platform.obsidian.prefer_folders
        )
        problems.extend(frontmatter_problems)
    notes = {PurePosixPath(note.source): note for note in vault.notes} if vault else {}

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    rewriter = _LinkRewriter(project, outputs)

    for relative in files:
        source_path = project.docs_dir / relative
        target_path = out_dir / outputs[relative]
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if relative.suffix.lower() != ".md":
            shutil.copy2(source_path, target_path)
            continue

        text = source_path.read_text(encoding="utf-8", errors="replace")
        frontmatter, body = split_frontmatter(text)
        if obsidian and vault is not None:
            note = notes[PurePosixPath(relative.as_posix())]
            body = _obsidian_body(body, note, vault, project, problems, text)
        body = rewriter.rewrite(body, relative, problems)
        target_path.write_text(frontmatter + body, encoding="utf-8")

    if problems and strict:
        raise DocsError(f"{len(problems)} problem(s) in {_display(project)}:", problems)
    return problems


def _obsidian_body(body: str, note: Note, vault: Vault, project: Project, problems: list[str], text: str) -> str:
    settings = project.platform
    body = map_prose(body, lambda part: _OBSIDIAN_COMMENT.sub("", part))
    body = render_bases(body, note, vault, settings.obsidian.sort_orders, problems, text)
    body = convert_callouts(body)
    body = rewrite_wikilinks(body, note, vault, problems, text)
    return insert_properties(body, note, settings.properties, vault, problems)


def _display(project: Project) -> str:
    try:
        return os.path.relpath(project.docs_dir, Path.cwd())
    except ValueError:
        return str(project.docs_dir)
