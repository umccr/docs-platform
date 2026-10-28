"""
Obsidian Tasks queries (```` ```tasks ```` blocks) rendered as static task lists at build time.

The Tasks plugin reads every checkbox in the vault as a task, and a Tasks block is a live query over them. A static
site cannot run it, so the build evaluates each block once and writes what it finds as a list, each task linking back
to the note it is in. The supported subset covers what the pilot vault uses and its close relatives; anything else is
reported as a problem instead of producing a wrong list:

- filters, one per line, all of which a task must pass: `done`, `not done`; `description`, `path`, `folder`,
  `filename` and `heading` with `includes`, `does not include`, `regex matches` and `regex does not match`; `has` and
  `no` `created`, `start`, `scheduled`, `due`, `done` and `cancelled` `date`; and `created`, `starts`, `scheduled`,
  `due`, `done` and `cancelled` with `before`, `after`, `on`, `on or before` or `on or after` a date (`2026-10-28`,
  `today`, `yesterday`, `tomorrow`, `14 days ago`, `in 2 weeks`)
- filters in parentheses joined by `AND`, `OR` or `XOR`, or negated by `NOT`; mixing operators takes more parentheses
- `sort by` and `group by` with `reverse`, `limit`, `limit groups`, `short mode`, `full mode`, `hide` and `show`,
  `ignore global query`, and `#` comments

Results follow the plugin: sorted by the `sort by` lines and then its default order (status, urgency, due date,
priority, path), and grouped by each `group by` line in turn, with groups in alphabetical order.
"""

import datetime
import html
import operator
import posixpath
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, unquote

from umccr_docs.markdown import (
    fenced_body,
    heading_anchor,
    line_of,
    map_prose,
    rewrite_links,
    segments,
    split_frontmatter,
)
from umccr_docs.obsidian.links import WIKILINK, escape_label, wikilink_to_markdown
from umccr_docs.obsidian.vault import LinkError, Note, Vault


class UnsupportedQuery(Exception):
    pass


_DATE = r"(?P<value>\d{4}-\d{2}-\d{2})"
# The fields the plugin reads from the end of a task, in the order it shows them: the name `hide` and `show` use, the
# emoji shown, and the pattern read. A priority is its emoji.
_FIELDS = (
    ("id", "🆔", r"🆔\ufe0f? *(?P<value>[a-zA-Z0-9_-]+)"),
    ("depends on", "⛔", r"⛔\ufe0f? *(?P<value>[a-zA-Z0-9_-]+(?: *, *[a-zA-Z0-9_-]+)*)"),
    ("priority", "", r"(?P<value>[🔺⏫🔼🔽⏬])\ufe0f?"),
    ("recurrence rule", "🔁", r"🔁\ufe0f? ?(?P<value>[a-zA-Z0-9, !]+)"),
    ("on completion", "🏁", r"🏁\ufe0f? *(?P<value>[a-zA-Z]+)"),
    ("created date", "➕", rf"➕\ufe0f? *{_DATE}"),
    ("start date", "🛫", rf"🛫\ufe0f? *{_DATE}"),
    ("scheduled date", "⏳", rf"[⏳⌛]\ufe0f? *{_DATE}"),
    ("due date", "📅", rf"[📅📆🗓]\ufe0f? *{_DATE}"),
    ("cancelled date", "❌", rf"❌\ufe0f? *{_DATE}"),
    ("done date", "✅", rf"✅\ufe0f? *{_DATE}"),
)
_FIELD_PATTERNS = tuple((name, re.compile(f"{pattern}$")) for name, _, pattern in _FIELDS)
# Each priority's name, its place in `sort by priority` and its part of the urgency score. No priority sits between
# medium and low.
_PRIORITIES = {
    "🔺": ("highest", 0, 9.0),
    "⏫": ("high", 1, 6.0),
    "🔼": ("medium", 2, 3.9),
    "🔽": ("low", 4, 0.0),
    "⏬": ("lowest", 5, -1.8),
}
_NO_PRIORITY = ("none", 3, 1.95)
# Statuses in the order `sort by status.type` puts them: in progress, to do (any status it does not know), done and
# cancelled.
_STATUS_TYPES = {"/": 0, " ": 1, "x": 2, "X": 2, "-": 3}

# A list item with a checkbox, in a quote or a callout too: `- [ ] text`, `1. [x] text`, `> - [/] text`.
_TASK = re.compile(r"^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[(?P<status>.)\](?:[ \t]+(?P<text>.*))?$")
_HEADING = re.compile(r"^ {0,3}#{1,6}[ \t]+(?P<text>.*?)(?:[ \t]+#+)?[ \t]*$")
# A paragraph's first line, which the line under it can underline into a heading (`Title` over `-----`): not a list
# item, a quote, a heading, a table row or a rule.
_PARAGRAPH = re.compile(r"^ {0,3}(?![-*+][ \t]|\d+[.)][ \t]|[>#|]|(?:[-*_=][ \t]*)+$)\S")
_UNDERLINE = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")
_COMMENT = re.compile(r"%%.*?%%", re.DOTALL)
_BLOCK_ID = re.compile(r" \^[a-zA-Z0-9-]+$")
# A tag at the end of a task: the plugin reads the fields before it, and keeps it in the description.
_TRAILING_TAG = re.compile(r"(?:^|\s)#[^ !@#$%^&*(),.?\":{}|<>]+$")
_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


@dataclass(frozen=True)
class Task:
    note: Note
    status: str  # the character in the checkbox
    description: str
    heading: str | None  # the heading the task is under
    fields: dict[str, str] = field(default_factory=dict, hash=False, compare=False)

    @property
    def done(self) -> bool:
        """The plugin's `done`: done or cancelled. Any other status, one it does not know too, is still to do."""
        return self.status in "xX-"

    @property
    def folder(self) -> str:
        """The plugin's `folder`: `Projects/`, or `/` at the vault's root."""
        return f"{self.note.folder}/" if self.note.folder else "/"

    def date(self, name: str) -> datetime.date | None:
        """A date field, such as `due date`; None when the task has none, or it is not a real date."""
        try:
            return datetime.date.fromisoformat(self.fields[name])
        except (KeyError, ValueError):
            return None


# What `includes` and `regex matches` read. A path is from the vault's root and, like a filename, ends in `.md`.
_TEXT: dict[str, Callable[[Task], str]] = {
    "description": lambda task: task.description,
    "path": lambda task: task.note.path,
    "folder": lambda task: task.folder,
    "filename": lambda task: task.note.source.name,
    "heading": lambda task: task.heading or "",
}


def _task(note: Note, status: str, text: str, heading: str | None) -> Task:
    """A task from the text after its checkbox. The plugin reads fields, and tags between them, from the end."""
    text = _BLOCK_ID.sub("", text.strip()).strip()
    fields: dict[str, str] = {}
    tags: list[str] = []
    matched = True
    while matched:
        matched = False
        for name, pattern in _FIELD_PATTERNS:
            if match := pattern.search(text):
                fields[name] = match.group("value")
                text, matched = text[: match.start()].rstrip(), True
        if match := _TRAILING_TAG.search(text):
            tags.insert(0, match.group(0).strip())
            text, matched = text[: match.start()].rstrip(), True
    return Task(note, status, " ".join([text, *tags]).strip(), heading, fields)


def note_tasks(note: Note) -> list[Task]:
    """The tasks in a note, in order, each with the heading it is under. Checkboxes in code or comments are not."""
    _, body = split_frontmatter(note.text)
    # Blanked rather than removed, so the lines around a comment stay apart.
    body = map_prose(body, lambda part: _COMMENT.sub(lambda match: re.sub(r"[^\n]", " ", match.group(0)), part))
    tasks: list[Task] = []
    heading: str | None = None
    candidate: str | None = None  # the line before, when an underline would make it a heading
    block_start = True
    for segment in segments(body):
        if segment.code:
            candidate, block_start = None, True
            continue
        for line in segment.text.splitlines():
            if match := _HEADING.match(line):
                heading, candidate, block_start = match.group("text"), None, True
                continue
            if candidate is not None and _UNDERLINE.match(line):
                heading, candidate, block_start = candidate, None, True
                continue
            if match := _TASK.match(line):
                tasks.append(_task(note, match.group("status"), match.group("text") or "", heading))
            candidate = line.strip() if block_start and _PARAGRAPH.match(line) else None
            block_start = not line.strip()
    return tasks


def find_tasks(vault: Vault) -> list[Task]:
    """Every task in the vault, note by note: what each query starts from."""
    return [task for note in vault.notes for task in note_tasks(note)]


@dataclass
class Query:
    filters: list[Callable[[Task], bool]] = field(default_factory=list)
    sorts: list[tuple[str, bool]] = field(default_factory=list)  # (property, reverse)
    groups: list[tuple[str, bool]] = field(default_factory=list)  # (property, reverse)
    limit: int | None = None
    group_limit: int | None = None
    short: bool = False
    hidden: set[str] = field(default_factory=set)


_SORTS = (
    "status",
    "status.type",
    "priority",
    "urgency",
    "created",
    "start",
    "scheduled",
    "due",
    "done",
    "cancelled",
    "description",
    "path",
    "filename",
    "heading",
)
# The plugin's own order, after a query's `sort by` lines.
_DEFAULT_SORTS = [("status.type", False), ("urgency", False), ("due", False), ("priority", False), ("path", False)]
_GROUPS = ("folder", "filename", "path", "heading")
# What `hide` and `show` name, beyond the fields: the link to each task's note, and the count under the list.
_COMPONENTS = {*(name for name, _, _ in _FIELDS), "backlink", "task count"}
# Obsidian's buttons, which a static page does not have.
_BUTTONS = {"edit button", "postpone button"}

_SORT = re.compile(r"sort by (?P<property>[a-z.]+)(?P<reverse> reverse)?", re.IGNORECASE)
_GROUP = re.compile(r"group by (?P<property>[a-z]+)(?P<reverse> reverse)?", re.IGNORECASE)
_LIMIT = re.compile(r"limit (?P<groups>groups )?(?:to )?(?P<count>\d+)(?: tasks?)?", re.IGNORECASE)
_MODE = re.compile(r"(?P<mode>short|full)(?: mode)?", re.IGNORECASE)
_LAYOUT = re.compile(r"(?P<action>hide|show) (?P<component>[a-z ]+)", re.IGNORECASE)

_STATUS_FILTER = re.compile(r"(?P<not>not )?done", re.IGNORECASE)
_TEXT_FILTER = re.compile(
    r"(?P<property>description|path|folder|filename|heading) (?P<test>includes|does not include) (?P<value>.*)",
    re.IGNORECASE,
)
_REGEX_FILTER = re.compile(
    r"(?P<property>description|path|folder|filename|heading) regex (?P<test>matches|does not match) "
    r"/(?P<pattern>.*)/(?P<flags>[a-z]*)",
    re.IGNORECASE,
)
_HAS_DATE_FILTER = re.compile(
    r"(?P<has>has|no) (?P<field>created|start|scheduled|due|done|cancelled) date", re.IGNORECASE
)
_DATE_FILTER = re.compile(
    r"(?P<field>created|starts|scheduled|due|done|cancelled)"
    r"(?: (?P<comparison>on or before|on or after|before|after|on))? (?P<date>.+)",
    re.IGNORECASE,
)
_COMPARISONS = {
    "on": operator.eq,
    "before": operator.lt,
    "after": operator.gt,
    "on or before": operator.le,
    "on or after": operator.ge,
}
_RELATIVE_DATE = re.compile(r"(?P<in>in )?(?P<count>\d+) (?P<unit>day|week)s?(?P<ago> ago)?")
_REGEX_FLAGS = {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL, "u": 0}
_JOIN = re.compile(r"[ \t]+(AND|OR|XOR)[ \t]+")
_NOT = re.compile(r"NOT[ \t]*(?=\()")


def parse_query(source: str, today: datetime.date) -> Query:
    """A Tasks block's instructions. Raises UnsupportedQuery for anything outside the supported subset."""
    query = Query()
    for line in (line.strip() for line in source.splitlines()):
        if not line or line.startswith("#"):
            continue
        if "{{" in line:
            raise UnsupportedQuery(f"'{line}': placeholders are not supported; write the value instead")
        if match := _SORT.fullmatch(line):
            if match.group("property").lower() not in _SORTS:
                raise UnsupportedQuery(f"'{line}' is not supported; sort by {', '.join(_SORTS)}")
            query.sorts.append((match.group("property").lower(), bool(match.group("reverse"))))
        elif match := _GROUP.fullmatch(line):
            if match.group("property").lower() not in _GROUPS:
                raise UnsupportedQuery(f"'{line}' is not supported; group by {', '.join(_GROUPS)}")
            query.groups.append((match.group("property").lower(), bool(match.group("reverse"))))
        elif match := _LIMIT.fullmatch(line):
            if match.group("groups"):
                query.group_limit = int(match.group("count"))
            else:
                query.limit = int(match.group("count"))
        elif match := _MODE.fullmatch(line):
            query.short = match.group("mode").lower() == "short"
        elif match := _LAYOUT.fullmatch(line):
            hide, component = match.group("action").lower() == "hide", match.group("component").strip().lower()
            if component in _COMPONENTS:
                if hide:
                    query.hidden.add(component)
                else:
                    query.hidden.discard(component)
            # Nested tasks are listed one by one, as `hide tree`, the plugin's default, lists them.
            elif component not in _BUTTONS and not (component == "tree" and hide):
                raise UnsupportedQuery(f"'{line}' is not supported")
        elif line.lower() != "ignore global query":  # a global query is a plugin setting, which the build never reads
            query.filters.append(_filter(line, today))
    return query


def _filter(line: str, today: datetime.date) -> Callable[[Task], bool]:
    """A filter: one on its own, or filters in parentheses joined by AND, OR or XOR, or negated by NOT."""
    if not line.startswith("(") and not _NOT.match(line):
        return _simple_filter(line, today)
    filters: list[Callable[[Task], bool]] = []
    joins: set[str] = set()
    position = 0
    while True:
        filter_, position = _operand(line, position, today)
        filters.append(filter_)
        match = _JOIN.match(line, position)
        if not match:
            break
        joins.add(match.group(1))
        position = match.end()
    if line[position:].strip():
        raise UnsupportedQuery(f"'{line}': expected AND, OR or XOR before '{line[position:].strip()}'")
    if len(joins) > 1:
        raise UnsupportedQuery(f"'{line}' mixes {' and '.join(sorted(joins))}; group them in more parentheses")
    join = joins.pop() if joins else "AND"
    if join == "AND":
        return lambda task: all(filter_(task) for filter_ in filters)
    if join == "OR":
        return lambda task: any(filter_(task) for filter_ in filters)
    return lambda task: sum(filter_(task) for filter_ in filters) % 2 == 1


def _operand(line: str, position: int, today: datetime.date) -> tuple[Callable[[Task], bool], int]:
    """The `(filter)` or `NOT (filter)` at `position` in `line`, and the position after it."""
    while position < len(line) and line[position] in " \t":
        position += 1
    if match := _NOT.match(line, position):
        negated, end = _operand(line, match.end(), today)
        return (lambda task: not negated(task)), end
    if not line.startswith("(", position):
        raise UnsupportedQuery(f"'{line}': put each filter in parentheses")
    depth = 0
    for end in range(position, len(line)):
        depth += {"(": 1, ")": -1}.get(line[end], 0)
        if depth == 0:
            return _filter(line[position + 1 : end].strip(), today), end + 1
    raise UnsupportedQuery(f"'{line}': a parenthesis is not closed")


def _simple_filter(line: str, today: datetime.date) -> Callable[[Task], bool]:
    if match := _STATUS_FILTER.fullmatch(line):
        done = not match.group("not")
        return lambda task: task.done == done
    if match := _TEXT_FILTER.fullmatch(line):
        text, value = _TEXT[match.group("property").lower()], match.group("value").strip().casefold()
        includes = match.group("test").lower() == "includes"
        # Unlike a regular expression, `includes` ignores case.
        return lambda task: (value in text(task).casefold()) == includes
    if match := _REGEX_FILTER.fullmatch(line):
        text, pattern = _TEXT[match.group("property").lower()], _regex(match.group("pattern"), match.group("flags"))
        matches = match.group("test").lower() == "matches"
        return lambda task: bool(pattern.search(text(task))) == matches
    if match := _HAS_DATE_FILTER.fullmatch(line):
        name, has = f"{match.group('field').lower()} date", match.group("has").lower() == "has"
        return lambda task: (task.date(name) is not None) == has
    if match := _DATE_FILTER.fullmatch(line):
        name = f"{match.group('field').lower().removesuffix('s')} date"
        compare = _COMPARISONS[(match.group("comparison") or "on").lower()]
        date = _date(match.group("date"), today)

        def dated(task: Task) -> bool:
            value = task.date(name)
            # A task with no start date can start any time, so the plugin lets it through every `starts` filter.
            return compare(value, date) if value else name == "start date"

        return dated
    raise UnsupportedQuery(f"'{line}' is not supported")


def _regex(pattern: str, flags: str) -> re.Pattern[str]:
    """
    A JavaScript regular expression, `/pattern/flags`, compiled by Python. The syntax queries use is common to both;
    what Python does not know, such as `(?<name>...)`, fails to compile and is reported.
    """
    compiled_flags = 0
    for flag in flags:
        if flag not in _REGEX_FLAGS:
            raise UnsupportedQuery(f"/{pattern}/{flags}: the {flag} flag is not supported")
        compiled_flags |= _REGEX_FLAGS[flag]
    try:
        return re.compile(pattern, compiled_flags)
    except re.error as error:
        raise UnsupportedQuery(f"/{pattern}/{flags}: {error}") from error


def _date(text: str, today: datetime.date) -> datetime.date:
    """A date in a filter: `2026-10-28`, `today`, `yesterday`, `tomorrow`, `14 days ago` or `in 2 weeks`."""
    text = text.strip().lower()
    named = {"yesterday": -1, "today": 0, "tomorrow": 1}
    if text in named:
        return today + datetime.timedelta(days=named[text])
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            return datetime.date.fromisoformat(text)
        except ValueError:
            pass
    match = _RELATIVE_DATE.fullmatch(text)
    if match and bool(match.group("in")) != bool(match.group("ago")):
        days = int(match.group("count")) * (7 if match.group("unit") == "week" else 1)
        return today + datetime.timedelta(days=days if match.group("in") else -days)
    raise UnsupportedQuery(
        f"date '{text}' is not supported; use YYYY-MM-DD, today, yesterday, tomorrow, '14 days ago' or 'in 2 weeks'"
    )


def _priority(task: Task) -> tuple[str, int, float]:
    return _PRIORITIES.get(task.fields.get("priority", ""), _NO_PRIORITY)


def _urgency(task: Task, today: datetime.date) -> float:
    """The plugin's urgency score, from a task's due, scheduled and start dates and its priority."""
    score = _priority(task)[2]
    if due := task.date("due date"):
        overdue = (today - due).days
        # Full weight from a week overdue; from a week overdue to two weeks ahead, falling linearly to a fifth.
        if overdue >= 7:
            score += 12.0
        elif overdue >= -14:
            score += 12.0 * ((overdue + 14) * 0.8 / 21 + 0.2)
        else:
            score += 12.0 * 0.2
    if (scheduled := task.date("scheduled date")) and scheduled <= today:
        score += 5.0
    if (start := task.date("start date")) and start > today:
        score -= 3.0
    return score


def _natural(text: str) -> tuple[Any, ...]:
    """Text as the plugin orders it: ignoring case, with numbers in number order (`2` before `10`)."""
    return tuple(int(part) if index % 2 else part.casefold() for index, part in enumerate(re.split(r"(\d+)", text)))


def _sort_key(name: str, today: datetime.date) -> Callable[[Task], Any]:
    """What `sort by <name>` sorts on, ascending."""
    if name == "status":
        return lambda task: task.done
    if name == "status.type":
        return lambda task: _STATUS_TYPES.get(task.status, 1)
    if name == "priority":
        return lambda task: _priority(task)[1]
    if name == "urgency":
        return lambda task: -_urgency(task, today)
    if name in _TEXT:
        text = _TEXT[name]
        return lambda task: _natural(text(task))
    date_name = f"{name} date"

    def dated(task: Task) -> tuple[int, datetime.date]:
        date = task.date(date_name)
        # Tasks without the date go after the rest, as in the plugin.
        return (0, date) if date else (1, datetime.date.min)

    return dated


def _sorted(tasks: list[Task], sorts: list[tuple[str, bool]], today: datetime.date) -> list[Task]:
    ordered = list(tasks)
    # Apply the last sort first: Python's sort is stable, so earlier sorts take precedence.
    for name, reverse in reversed([*sorts, *_DEFAULT_SORTS]):
        ordered.sort(key=_sort_key(name, today), reverse=reverse)
    return ordered


def _group_key(name: str, task: Task) -> str | Note:
    """The group `group by <name>` puts a task in."""
    if name == "folder":
        return task.folder
    if name == "filename":
        # By note, not by name, so that notes with one name in two folders each get a group linking to them.
        return task.note
    if name == "path":
        return task.note.path.removesuffix(".md")
    return task.heading or "(No heading)"


def _group_order(key: str | Note) -> tuple[Any, ...]:
    return (_natural(key.name), _natural(key.path)) if isinstance(key, Note) else _natural(key)


def _group_label(key: str | Note, depth: int, page: Note) -> str:
    """
    A group's label, a heading as the plugin shows it (h4, then h5 and h6 for groups within groups). It is a heading
    for assistive technology only, so that a page's table of contents does not list every group.
    """
    attributes = f'class="umccr-tasks-group" role="heading" aria-level="{min(4 + depth, 6)}"'
    if isinstance(key, Note):
        return f'<div {attributes} markdown="span">[{escape_label(key.name)}]({Vault.relative_url(page, key)})</div>'
    return f"<div {attributes}>{html.escape(key)}</div>"


def _rebase(url: str, note: Note, page: Note) -> str | None:
    """A relative link written in `note`, rewritten to reach the same place from `page`."""
    if not url or url.startswith("/") or _SCHEME.match(url):
        return None
    path, hash_mark, anchor = url.partition("#")
    target = posixpath.normpath(posixpath.join(str(note.source.parent), unquote(path))) if path else str(note.source)
    return quote(posixpath.relpath(target, str(page.source.parent))) + (f"#{anchor}" if hash_mark else "")


def _description(task: Task, page: Note, vault: Vault) -> str:
    """A task's description as Markdown for `page`, with its links reaching what they reach in the task's note."""
    text = task.description
    if page != task.note:
        text = rewrite_links(text, lambda url, _kind: _rebase(url, task.note, page))

    def wikilink(match: re.Match[str]) -> str:
        if not match.group("embed"):
            try:
                return wikilink_to_markdown(match.group("inner"), task.note, vault, page)
            except (LinkError, ValueError):
                pass
        # The task's own note reports the link. Here it is text, escaped so that the page's own wikilinks pass skips it.
        return escape_label(match.group(0))

    return map_prose(text, lambda part: WIKILINK.sub(wikilink, part))


def _field(name: str, emoji: str, value: str, short: bool) -> str:
    """A field as the plugin shows it: `➕ 2026-09-25`, or in short mode `➕` alone, with the value on hover."""
    if name == "priority":
        emoji, value = value, _PRIORITIES[value][0]
    title = html.escape(f"{name[0].upper()}{name[1:]}: {value}")
    shown = emoji if short or name == "priority" else f"{emoji} {value}"
    return f'<span class="umccr-task-field" title="{title}">{html.escape(shown)}</span>'


def _backlink(task: Task, page: Note, short: bool) -> str:
    """The link to the task's note, at its heading: the note's name and the heading, or in short mode 🔗."""
    url = Vault.relative_url(page, task.note)
    if task.heading:
        url += f"#{heading_anchor(task.heading)}"
    where = task.note.name
    if task.heading and task.heading != where:
        where += f" > {task.heading}"
    if short:
        title = where.replace('"', "'")
        return f'[🔗]({url} "{title}"){{ .umccr-task-link }}'
    return f"([{escape_label(where)}]({url}){{ .umccr-task-link }})"


def _task_item(task: Task, page: Note, vault: Vault, query: Query) -> str:
    """A task as a list item: its checkbox, description and fields, and the link to it."""
    parts = [_description(task, page, vault)]
    for name, emoji, _ in _FIELDS:
        if name in task.fields and name not in query.hidden:
            parts.append(_field(name, emoji, task.fields[name], query.short))
    if "backlink" not in query.hidden:
        parts.append(_backlink(task, page, query.short))
    # Non-breaking spaces keep the fields and the link with the description's last word, never alone on a line.
    return f"- [{'x' if task.done else ' '}] " + "\u00a0".join(part for part in parts if part)


def render_query(query: Query, page: Note, vault: Vault, tasks: list[Task], today: datetime.date) -> str:
    """The tasks a query finds, as Markdown for `page`: group labels, lists, and a note on where they came from."""
    found = _sorted([task for task in tasks if all(filter_(task) for filter_ in query.filters)], query.sorts, today)
    found = found[: query.limit]
    blocks: list[str] = []
    listed = 0

    def add(group: list[Task], depth: int) -> None:
        nonlocal listed
        if depth == len(query.groups):
            shown = group[: query.group_limit]
            listed += len(shown)
            blocks.append("\n".join(_task_item(task, page, vault, query) for task in shown))
            return
        name, reverse = query.groups[depth]
        groups: dict[str | Note, list[Task]] = {}
        for task in group:
            groups.setdefault(_group_key(name, task), []).append(task)
        for key in sorted(groups, key=_group_order, reverse=reverse):
            blocks.append(_group_label(key, depth, page))
            add(groups[key], depth + 1)

    footer = "Generated from the notes' tasks when the site was built."
    if found:
        add(found, 0)
        if "task count" not in query.hidden:
            footer = f"{listed} task{'' if listed == 1 else 's'}. {footer}"
    else:
        blocks.append("*No matching tasks.*")
    blocks.append(f'<p class="umccr-base-note">{footer}</p>')
    return "\n\n".join(blocks)


def render_tasks(
    body: str,
    note: Note,
    vault: Vault,
    tasks: list[Task],
    problems: list[str],
    source_text: str,
    today: datetime.date | None = None,
) -> str:
    """Replace each top-level ```` ```tasks ```` block in `body` with what it finds in `tasks`, the vault's."""
    today = today or datetime.date.today()
    parts = []
    for segment in segments(body):
        # A block nested in a list or a callout stays a code sample, as a Bases block does.
        if not (segment.fenced and segment.info == "tasks" and segment.level == 0):
            parts.append(segment.text)
            continue
        try:
            query = parse_query(fenced_body(segment), today)
        except UnsupportedQuery as error:
            problems.append(f"{note.path}:{line_of(source_text, segment.text) or '?'}: Tasks block: {error}")
            parts.append(segment.text)
            continue
        # Blank lines around it: a list cannot interrupt a paragraph.
        parts.append(f"\n{render_query(query, note, vault, tasks, today)}\n\n")
    return "".join(parts)
