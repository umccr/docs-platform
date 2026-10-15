"""Wikilinks to Markdown links, and frontmatter values to Markdown."""

import datetime
import re
from typing import Any

from umccr_docs.markdown import heading_anchor, line_of, map_prose
from umccr_docs.obsidian.vault import LinkError, Note, Vault

WIKILINK = re.compile(r"(?P<embed>!?)\[\[(?P<inner>[^\[\]\n]+?)\]\]")


def _parse(inner: str) -> tuple[str, str | None, str | None]:
    """(target, heading, label) from the inside of `[[target#heading|label]]`."""
    target, _, label = inner.partition("|")
    target, _, heading = target.partition("#")
    return target.strip(), (heading.strip() or None), (label.strip() or None)


def _escape_label(label: str) -> str:
    return label.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def wikilink_to_markdown(inner: str, from_note: Note, vault: Vault) -> str:
    """`[[target#heading|label]]` as a Markdown link. Raises LinkError or ValueError."""
    target, heading, label = _parse(inner)
    if heading is not None and heading.startswith("^"):
        raise ValueError(f"[[{inner}]]: block references are not supported")

    if target:
        note = vault.resolve(target, from_note)
        url = Vault.relative_url(from_note, note)
    else:
        url = ""  # [[#Heading]] links within the same note
    if heading:
        url = f"{url}#{heading_anchor(heading)}"

    shown = label or (f"{target} > {heading}" if target and heading else target or heading or "")
    return f"[{_escape_label(shown)}]({url})"


def rewrite_wikilinks(body: str, note: Note, vault: Vault, problems: list[str], source_text: str) -> str:
    """Replace every wikilink outside code with a Markdown link, recording problems for the ones that fail."""

    def replace(match: re.Match[str]) -> str:
        if match.group("embed"):
            problems.append(
                f"{note.path}:{line_of(source_text, match.group(0)) or '?'}: embeds ({match.group(0)}) "
                "are not supported"
            )
            return match.group(0)
        try:
            return wikilink_to_markdown(match.group("inner"), note, vault)
        except (LinkError, ValueError) as error:
            problems.append(f"{note.path}:{line_of(source_text, match.group(0)) or '?'}: {error}")
            return match.group(0)

    return map_prose(body, lambda text: WIKILINK.sub(replace, text))


def link_target_name(value: Any) -> str | None:
    """The note name a frontmatter link value points at: `"[[portal-ui]]"` -> `portal-ui`."""
    if not isinstance(value, str):
        return None
    match = WIKILINK.fullmatch(value.strip())
    raw = _parse(match.group("inner"))[0] if match else value
    return raw.strip().removesuffix(".md").split("/")[-1].lower() or None


def format_value(value: Any, from_note: Note, vault: Vault, problems: list[str]) -> str:
    """A frontmatter value as table-cell Markdown: links resolved, lists joined, pipes escaped."""
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(part for part in (format_value(item, from_note, vault, problems) for item in value) if part)
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    text = str(value)

    def replace(match: re.Match[str]) -> str:
        try:
            return wikilink_to_markdown(match.group("inner"), from_note, vault)
        except (LinkError, ValueError) as error:
            problems.append(f"{from_note.path}: frontmatter {error}")
            return match.group("inner")

    return WIKILINK.sub(replace, text).replace("|", "\\|").replace("\n", " ")
