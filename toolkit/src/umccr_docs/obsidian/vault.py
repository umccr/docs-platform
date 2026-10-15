"""The notes in a vault, and how Obsidian resolves a wikilink name to one of them."""

import posixpath
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from umccr_docs.markdown import split_frontmatter


@dataclass(frozen=True)
class Note:
    source: PurePosixPath  # relative to docs_dir, as in the vault
    output: PurePosixPath  # relative to the built docs_dir (the home note becomes index.md)
    frontmatter: dict[str, Any] = field(default_factory=dict, hash=False, compare=False)

    @property
    def name(self) -> str:
        """Obsidian's `file.name`: the filename without `.md`, which is also the note's link ID."""
        return self.source.stem

    @property
    def folder(self) -> str:
        """Obsidian's `file.folder`: the folder path within the vault, `""` at the root."""
        parent = str(self.source.parent)
        return "" if parent == "." else parent

    @property
    def path(self) -> str:
        return str(self.source)


class LinkError(Exception):
    def __init__(self, target: str, candidates: list[Note]) -> None:
        self.target = target
        self.candidates = candidates
        if candidates:
            listed = ", ".join(note.path for note in candidates)
            message = f"[[{target}]] is ambiguous: it matches {listed}"
        else:
            message = f"[[{target}]] does not match any note"
        super().__init__(message)


def load_frontmatter(text: str) -> dict[str, Any]:
    frontmatter, _ = split_frontmatter(text)
    if not frontmatter:
        return {}
    body = frontmatter.split("\n", 1)[1].rsplit("---", 1)[0]
    data = yaml.safe_load(body) or {}
    return data if isinstance(data, dict) else {}


class Vault:
    def __init__(self, notes: list[Note], prefer_folders: tuple[str, ...] = ()) -> None:
        self.notes = notes
        self.prefer_folders = prefer_folders
        self._by_name: dict[str, list[Note]] = {}
        for note in notes:
            self._by_name.setdefault(note.name.lower(), []).append(note)

    @classmethod
    def load(
        cls,
        docs_dir: Path,
        markdown_files: list[Path],
        outputs: dict[Path, Path],
        prefer_folders: tuple[str, ...] = (),
    ) -> tuple["Vault", list[str]]:
        """Read every note's frontmatter. Returns the vault and any frontmatter problems."""
        notes, problems = [], []
        for relative in markdown_files:
            text = (docs_dir / relative).read_text(encoding="utf-8", errors="replace")
            try:
                frontmatter = load_frontmatter(text)
            except yaml.YAMLError as error:
                problems.append(f"{relative}: frontmatter is not valid YAML ({error})")
                frontmatter = {}
            notes.append(
                Note(
                    source=PurePosixPath(relative.as_posix()),
                    output=PurePosixPath(outputs[relative].as_posix()),
                    frontmatter=frontmatter,
                )
            )
        return cls(notes, prefer_folders), problems

    def resolve(self, target: str, from_note: Note | None = None) -> Note:
        """
        The note a wikilink target names, as Obsidian resolves it: by filename, or by a path suffix when the target
        has a folder. When a name matches notes in several folders, the configured `prefer_folders` decide, then a
        match in the linking note's own folder. Raises LinkError otherwise.
        """
        cleaned = target.strip().removesuffix(".md").strip("/")
        if "/" in cleaned:
            suffix = cleaned.lower()
            candidates = [
                note
                for note in self.notes
                if (stem := str(note.source.with_suffix("")).lower()) == suffix or stem.endswith("/" + suffix)
            ]
        else:
            candidates = list(self._by_name.get(cleaned.lower(), []))

        if len(candidates) == 1:
            return candidates[0]
        if not candidates:
            raise LinkError(target, [])

        for folder in self.prefer_folders:
            preferred = [note for note in candidates if note.folder == folder]
            if len(preferred) == 1:
                return preferred[0]

        if from_note is not None:
            local = [note for note in candidates if note.folder == from_note.folder]
            if len(local) == 1:
                return local[0]

        raise LinkError(target, candidates)

    @staticmethod
    def relative_url(from_note: Note, to_note: Note) -> str:
        """The link from one built page to another, as MkDocs expects: a relative path to the `.md` file."""
        start = posixpath.dirname(str(from_note.output)) or "."
        return posixpath.relpath(str(to_note.output), start)
