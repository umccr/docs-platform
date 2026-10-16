"""
Obsidian Bases views (```` ```base ```` blocks) rendered as static Markdown tables at build time.

A Bases block is a live query over the vault's frontmatter. A static site cannot run it, so the build evaluates it
once and writes the result as a table. The supported subset covers what the pilot vault uses; anything else is
reported as a problem instead of producing a wrong table:

- filters: nested `and`, `or`, `not`; `prop == value`, `prop != value`; `prop.contains(value)`;
  `prop.contains(link("note"))`; `file.inFolder("Folder")`; values may be strings, numbers or booleans
- properties: frontmatter names (optionally prefixed `note.`), `file.name`, `file.folder`, `file.path`
- views: `type: table` with `name`, `order`, `sort` and `limit`; `properties.<name>.displayName` for headers
"""

import datetime
import re
from dataclasses import dataclass
from typing import Any

import yaml

from umccr_docs.markdown import Segment, fenced_body, line_of, segments
from umccr_docs.obsidian.links import format_value, link_target_name
from umccr_docs.obsidian.vault import Note, Vault


class UnsupportedBase(Exception):
    pass


_LITERAL = r'(?:"[^"]*"|\'[^\']*\'|-?\d+(?:\.\d+)?|true|false|link\(\s*(?:"[^"]*"|\'[^\']*\')\s*\))'
_PROPERTY = r"[A-Za-z_][\w.-]*"
_COMPARISON = re.compile(rf"^(?P<prop>{_PROPERTY})\s*(?P<op>==|!=)\s*(?P<value>{_LITERAL})$")
_CONTAINS = re.compile(rf"^(?P<prop>{_PROPERTY})\.contains\(\s*(?P<value>{_LITERAL})\s*\)$")
_IN_FOLDER = re.compile(r'^file\.inFolder\(\s*(?P<value>"[^"]*"|\'[^\']*\')\s*\)$')


@dataclass(frozen=True)
class Literal:
    value: Any
    is_link: bool = False


def _literal(raw: str) -> Literal:
    raw = raw.strip()
    link = re.fullmatch(r"link\(\s*(?:\"([^\"]*)\"|'([^']*)')\s*\)", raw)
    if link:
        return Literal((link.group(1) if link.group(1) is not None else link.group(2)).lower(), is_link=True)
    if raw[0] in "\"'":
        return Literal(raw[1:-1])
    if raw in ("true", "false"):
        return Literal(raw == "true")
    return Literal(float(raw) if "." in raw else int(raw))


def property_value(note: Note, name: str) -> Any:
    if name == "file.name":
        return note.name
    if name == "file.folder":
        return note.folder
    if name == "file.path":
        return note.path
    if name.startswith("file."):
        raise UnsupportedBase(f"property '{name}' is not supported")
    return note.frontmatter.get(name.removeprefix("note."))


def _equals(actual: Any, expected: Literal) -> bool:
    if actual is None:
        return False
    if expected.is_link:
        return link_target_name(actual) == expected.value
    if isinstance(expected.value, bool) or isinstance(actual, bool):
        return actual is expected.value
    if isinstance(expected.value, (int, float)) and isinstance(actual, (int, float)):
        return actual == expected.value
    return str(actual) == str(expected.value)


def _contains(actual: Any, expected: Literal) -> bool:
    if actual is None:
        return False
    if isinstance(actual, list):
        return any(_equals(item, expected) for item in actual)
    if expected.is_link:
        return link_target_name(actual) == expected.value
    return str(expected.value) in str(actual)


def evaluate(node: Any, note: Note) -> bool:
    """Whether `note` matches a Bases filter node."""
    if isinstance(node, dict):
        if len(node) != 1:
            raise UnsupportedBase(f"filter {node!r} must have exactly one of and/or/not")
        ((operator, children),) = node.items()
        if not isinstance(children, list):
            raise UnsupportedBase(f"'{operator}' must hold a list of filters")
        if operator == "and":
            return all(evaluate(child, note) for child in children)
        if operator == "or":
            return any(evaluate(child, note) for child in children)
        if operator == "not":
            return not any(evaluate(child, note) for child in children)
        raise UnsupportedBase(f"filter operator '{operator}' is not supported")

    if not isinstance(node, str):
        raise UnsupportedBase(f"filter {node!r} is not supported")
    expression = node.strip()
    if "this." in expression or expression.startswith("this"):
        raise UnsupportedBase(f"'{expression}': 'this' is not supported; use a literal value")

    if match := _COMPARISON.match(expression):
        result = _equals(property_value(note, match.group("prop")), _literal(match.group("value")))
        return result if match.group("op") == "==" else not result
    if match := _CONTAINS.match(expression):
        return _contains(property_value(note, match.group("prop")), _literal(match.group("value")))
    if match := _IN_FOLDER.match(expression):
        folder = match.group("value")[1:-1].strip("/")
        return note.folder == folder or note.folder.startswith(folder + "/")
    raise UnsupportedBase(f"filter expression '{expression}' is not supported")


def _sort_key(value: Any, order: tuple[str, ...] | None) -> tuple[int, Any]:
    """Comparable key. Missing values sort last in either direction (see `_sorted`)."""
    if order:
        return (0, order.index(value)) if value in order else (1, len(order))
    if isinstance(value, bool):
        return (0, int(value))
    if isinstance(value, (int, float)):
        return (0, value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return (0, value.isoformat())
    if isinstance(value, list):
        return (0, ", ".join(str(item).lower() for item in value))
    return (0, str(value).lower())


def _sorted(notes: list[Note], sorts: list[dict[str, Any]], sort_orders: dict[str, tuple[str, ...]]) -> list[Note]:
    ordered = list(notes)
    # Apply the last sort first: Python's sort is stable, so earlier sorts take precedence.
    for spec in reversed(sorts):
        name = spec.get("property")
        if not isinstance(name, str):
            raise UnsupportedBase(f"sort entry {spec!r} needs a property")
        direction = str(spec.get("direction", "ASC")).upper()
        if direction not in ("ASC", "DESC"):
            raise UnsupportedBase(f"sort direction '{direction}' is not supported")
        order = sort_orders.get(name.removeprefix("note."))
        present = [note for note in ordered if property_value(note, name) is not None]
        missing = [note for note in ordered if property_value(note, name) is None]
        present.sort(key=lambda note: _sort_key(property_value(note, name), order), reverse=direction == "DESC")
        ordered = present + missing
    return ordered


def _header(name: str, properties: dict[str, Any]) -> str:
    configured = properties.get(name) or properties.get(f"note.{name}") or {}
    display = configured.get("displayName") if isinstance(configured, dict) else None
    if display:
        return str(display)
    return "Name" if name == "file.name" else name.removeprefix("note.").removeprefix("file.")


def _cell(note: Note, name: str, from_note: Note, vault: Vault, problems: list[str]) -> str:
    if name == "file.name":
        return f"[{note.name}]({Vault.relative_url(from_note, note)})"
    return format_value(property_value(note, name), from_note, vault, problems)


def render_query(
    query: dict[str, Any],
    from_note: Note,
    vault: Vault,
    sort_orders: dict[str, tuple[str, ...]],
    problems: list[str],
) -> str:
    unsupported = set(query) - {"filters", "views", "properties"}
    if unsupported:
        raise UnsupportedBase(f"{', '.join(sorted(unsupported))} not supported")

    filters = query.get("filters")
    matching = [note for note in vault.notes if filters is None or evaluate(filters, note)]
    properties = query.get("properties") or {}

    views = query.get("views") or [{"type": "table", "order": ["file.name"]}]
    rendered = []
    for view in views:
        if view.get("type") != "table":
            raise UnsupportedBase(f"view type '{view.get('type')}' is not supported; use table")
        unknown = set(view) - {"type", "name", "order", "sort", "limit"}
        if unknown:
            raise UnsupportedBase(f"view option(s) {', '.join(sorted(unknown))} not supported")
        view_filters = view.get("filters")
        notes = [note for note in matching if view_filters is None or evaluate(view_filters, note)]
        notes = _sorted(notes, view.get("sort") or [], sort_orders)
        if isinstance(view.get("limit"), int):
            notes = notes[: view["limit"]]

        columns = view.get("order") or ["file.name"]
        lines = []
        if len(views) > 1 and view.get("name"):
            lines.append(f"**{view['name']}**\n")
        if notes:
            lines.append("| " + " | ".join(_header(column, properties) for column in columns) + " |")
            lines.append("| " + " | ".join("---" for _ in columns) + " |")
            for note in notes:
                cells = [_cell(note, column, from_note, vault, problems) for column in columns]
                lines.append("| " + " | ".join(cells) + " |")
        else:
            lines.append("*No matching notes.*")
        rendered.append("\n".join(lines))

    footer = '<p class="umccr-base-note">Generated from note properties when the site was built.</p>'
    return "\n\n".join(rendered) + "\n\n" + footer + "\n"


def render_bases(
    body: str,
    note: Note,
    vault: Vault,
    sort_orders: dict[str, tuple[str, ...]],
    problems: list[str],
    source_text: str,
) -> str:
    """Replace each top-level ```` ```base ```` block in `body` with its rendered table."""
    parts = []
    for segment in segments(body):
        # A block nested in a list or a callout stays a code sample: a table there would end its container.
        if not (segment.fenced and segment.info == "base" and segment.level == 0):
            parts.append(segment.text)
            continue
        parts.append(_render_block(segment, note, vault, sort_orders, problems, source_text))
    return "".join(parts)


def _render_block(
    segment: Segment,
    note: Note,
    vault: Vault,
    sort_orders: dict[str, tuple[str, ...]],
    problems: list[str],
    source_text: str,
) -> str:
    location = f"{note.path}:{line_of(source_text, segment.text) or '?'}"
    try:
        query = yaml.safe_load(fenced_body(segment)) or {}
        if not isinstance(query, dict):
            raise UnsupportedBase("the block must be a YAML mapping")
        return render_query(query, note, vault, sort_orders, problems)
    except (UnsupportedBase, yaml.YAMLError) as error:
        problems.append(f"{location}: Bases block: {error}")
        return segment.text
