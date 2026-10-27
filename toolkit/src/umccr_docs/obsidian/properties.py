"""Selected frontmatter properties at the top of each page, like Obsidian's properties view."""

import datetime
import html
import re

from umccr_docs.markdown import mask_code
from umccr_docs.obsidian.links import format_value
from umccr_docs.obsidian.vault import Note, Vault

_FIRST_HEADING = re.compile(r"^# .+$", re.MULTILINE)
_NOT_A_TOKEN = re.compile(r"[^a-z0-9]+")


def _label(name: str) -> str:
    words = name.replace("_", " ").replace("-", " ")
    return words[:1].upper() + words[1:]


def _token(text: str) -> str:
    """`On hold` as `on-hold`: an attribute value the theme styles by, such as a status's colour."""
    return _NOT_A_TOKEN.sub("-", text.lower()).strip("-")


def properties_block(
    note: Note, fields: tuple[str, ...], vault: Vault, problems: list[str], warnings: list[str]
) -> str:
    """
    A definition list, one `<div>` per property, which the theme lays out as a card. Values stay Markdown, so links
    resolve; a date reads as `28 Sep 2026`. `data-property` and, for text, `data-value` let the theme style one
    property or value, such as `status: active`.
    """
    rows = []
    for name in fields:
        raw = note.frontmatter.get(name)
        if isinstance(raw, datetime.date):
            value = f'<time datetime="{raw.isoformat()}">{raw.day} {raw:%b %Y}</time>'
        else:
            value = format_value(raw, note, vault, problems, warnings)
        if not value:
            continue
        attributes = f'data-property="{_token(name)}"'
        if isinstance(raw, str) and _token(raw):
            attributes += f' data-value="{_token(raw)}"'
        label = html.escape(_label(name))
        rows.append(f'<div {attributes} markdown><dt>{label}</dt><dd markdown="span">{value}</dd></div>')
    if not rows:
        return ""
    return '<dl class="umccr-properties" markdown>\n' + "\n".join(rows) + "\n</dl>\n\n"


def insert_properties(
    body: str, note: Note, fields: tuple[str, ...], vault: Vault, problems: list[str], warnings: list[str]
) -> str:
    """Insert the list after the page's first `# ` heading, or at the top when there is none."""
    block = properties_block(note, fields, vault, problems, warnings)
    if not block:
        return body
    # A `# comment` in a shell sample is not a heading: look for one outside code, at the same offsets.
    heading = _FIRST_HEADING.search(mask_code(body))
    if not heading:
        return block + body
    end = heading.end()
    return body[:end] + "\n\n" + block + body[end:].lstrip("\n")
