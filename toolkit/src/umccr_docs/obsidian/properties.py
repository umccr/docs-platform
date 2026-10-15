"""A table of selected frontmatter properties at the top of each page, like Obsidian's properties view."""

import re

from umccr_docs.obsidian.links import format_value
from umccr_docs.obsidian.vault import Note, Vault

_FIRST_HEADING = re.compile(r"^# .+$", re.MULTILINE)


def _label(name: str) -> str:
    words = name.replace("_", " ").replace("-", " ")
    return words[:1].upper() + words[1:]


def properties_block(note: Note, fields: tuple[str, ...], vault: Vault, problems: list[str]) -> str:
    rows = []
    for name in fields:
        value = format_value(note.frontmatter.get(name), note, vault, problems)
        if value:
            rows.append(f"| {_label(name)} | {value} |")
    if not rows:
        return ""
    table = "\n".join(["| Property | Value |", "| --- | --- |", *rows])
    return f'<div class="umccr-properties" markdown>\n\n{table}\n\n</div>\n\n'


def insert_properties(body: str, note: Note, fields: tuple[str, ...], vault: Vault, problems: list[str]) -> str:
    """Insert the table after the page's first `# ` heading, or at the top when there is none."""
    block = properties_block(note, fields, vault, problems)
    if not block:
        return body
    heading = _FIRST_HEADING.search(body)
    if not heading:
        return block + body
    end = heading.end()
    return body[:end] + "\n\n" + block + body[end:].lstrip("\n")
