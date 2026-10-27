"""
Code-aware Markdown helpers: transformations never touch code blocks, fenced or indented, or inline code spans.

What counts as code follows Python-Markdown, which both engines render with, not CommonMark: content is nested four
columns deep, and an indented block is code only where it is not the content of a list item, an admonition or another
container.
"""

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass

TAB_LENGTH = 4

_FENCE = re.compile(r"(?P<fence>`{3,}|~{3,})(?P<info>[^\r\n]*)")
_INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.DOTALL)
_FRONTMATTER = re.compile(r"\A---[ \t]*\n(?P<yaml>.*?\n)?---[ \t]*(?:\n|\Z)", re.DOTALL)

# Lines after which indented blocks are content rather than code. A list item opens one only where a block starts
# (Python-Markdown does not let a list interrupt a paragraph); admonitions, collapsible blocks, content tabs, footnotes
# and definitions open one anywhere in a block.
_LIST_ITEM = re.compile(r"(?:[*+-]|\d+\.)[ \t]")
_RULE = re.compile(r"(?:[-*_][ \t]*){3,}$")
_CONTAINER = re.compile(r"(?:!!!|\?\?\?\+?|===\+?)[ \t]|\[\^[^\]\n]+\]:|:[ \t]")

_INLINE_LINK = re.compile(
    r"(?P<bang>!?)\[(?P<label>[^\]\n]*)\]\((?P<url><[^>\n]*>|[^)\s]+)(?P<title>\s+\"[^\"\n]*\")?\)"
)
# `[label]: url "title"`. A label starting with ^ is a footnote, not a reference.
_REFERENCE = re.compile(r"^(?P<lead>[ \t]*\[(?!\^)[^\]\n]+\]:[ \t]*)(?P<url><[^>\n]*>|\S+)", re.MULTILINE)


@dataclass(frozen=True)
class Segment:
    """
    A run of Markdown: plain text, or a code block, fenced (with its info string) or indented. `level` is the column
    the block's container puts content at: 0 at the top level, 4 inside an admonition or a list item.
    """

    text: str
    fenced: bool = False
    info: str = ""
    indented: bool = False
    level: int = 0

    @property
    def code(self) -> bool:
        return self.fenced or self.indented


def split_frontmatter(text: str) -> tuple[str, str]:
    """(frontmatter including its `---` lines, body). Frontmatter is empty when absent."""
    match = _FRONTMATTER.match(text)
    if not match:
        return "", text
    return text[: match.end()], text[match.end() :]


def _indent(line: str) -> int:
    """Columns of leading whitespace, a tab reaching the next multiple of four, as Python-Markdown counts them."""
    column = 0
    for char in line:
        if char == " ":
            column += 1
        elif char == "\t":
            column += TAB_LENGTH - column % TAB_LENGTH
        else:
            break
    return column


def _end_of_indented_code(lines: list[str], start: int, level: int) -> int:
    """The index after an indented code block's last line: it runs on through blank lines while lines stay indented."""
    end = last = start
    while end < len(lines):
        if lines[end].strip():
            if _indent(lines[end]) < level + TAB_LENGTH:
                break
            last = end
        end += 1
    return last + 1


def _end_of_fence(lines: list[str], start: int, level: int, fence: str) -> int:
    """The index after a fenced block's closing line, or where its container ends, or the end of the text."""
    closing = re.compile(rf"{re.escape(fence[0])}{{{len(fence)},}}[ \t]*")
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if level and line.strip() and _indent(line) < level:
            return end
        end += 1
        if _indent(line) - level < TAB_LENGTH and closing.fullmatch(line.strip(" \t\r\n")):
            return end
    return end


def segments(text: str) -> Iterator[Segment]:
    """Split Markdown into text and code segments, preserving every character."""
    lines = text.splitlines(keepends=True)
    levels = [0]  # the content columns of the open containers, innermost last
    buffer: list[str] = []
    index = 0
    block_start = True  # after a blank line, a code block or the start of the text
    in_list = False  # the block holds list items, so a sibling or nested item opens a container too
    after_opener = False  # the line before opened a container, whose content may start with a list

    def flush() -> Iterator[Segment]:
        if buffer:
            yield Segment("".join(buffer))
            buffer.clear()

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            buffer.append(line)
            index += 1
            block_start = True
            continue

        indent = _indent(line)
        if block_start:
            # A block indented less than a container's content ends that container.
            while len(levels) > 1 and indent < levels[-1]:
                levels.pop()
            in_list = after_opener = False
        level = max(column for column in levels if column <= indent)
        content = line.lstrip(" \t")

        if block_start and indent >= level + TAB_LENGTH:
            yield from flush()
            end = _end_of_indented_code(lines, index, level)
            yield Segment("".join(lines[index:end]), indented=True, level=level)
            index, block_start = end, True
            continue

        fence = _FENCE.match(content) if indent - level < TAB_LENGTH else None
        if fence:
            yield from flush()
            end = _end_of_fence(lines, index, level, fence.group("fence"))
            yield Segment("".join(lines[index:end]), fenced=True, info=fence.group("info").strip(), level=level)
            index, block_start = end, True
            continue

        opener = False
        if indent - level < TAB_LENGTH:
            may_list = block_start or after_opener or in_list
            item = bool(may_list and _LIST_ITEM.match(content) and not _RULE.match(content.rstrip()))
            opener = item or bool(_CONTAINER.match(content))
            if opener:
                # This line opens a container at `level`: lines and blocks indented past it are its content.
                del levels[levels.index(level) + 1 :]
                levels.append(level + TAB_LENGTH)
            in_list = in_list or item
        after_opener = opener
        buffer.append(line)
        index += 1
        block_start = False

    yield from flush()


def fenced_body(segment: Segment) -> str:
    """The content of a fenced block, without its opening and closing fence lines."""
    lines = segment.text.splitlines(keepends=True)
    closed = len(lines) > 1 and re.fullmatch(r"(`{3,}|~{3,})[ \t]*", lines[-1].strip(" \t\r\n"))
    return "".join(lines[1:-1] if closed else lines[1:])


def map_outside_inline_code(text: str, transform: Callable[[str], str]) -> str:
    """Apply `transform` to the parts of `text` outside inline code spans."""
    parts: list[str] = []
    position = 0
    for match in _INLINE_CODE.finditer(text):
        parts.append(transform(text[position : match.start()]))
        parts.append(match.group(0))
        position = match.end()
    parts.append(transform(text[position:]))
    return "".join(parts)


def map_prose(text: str, transform: Callable[[str], str]) -> str:
    """Apply `transform` to everything that is neither a code block nor inline code."""
    return "".join(
        segment.text if segment.code else map_outside_inline_code(segment.text, transform) for segment in segments(text)
    )


def rewrite_links(text: str, destination: Callable[[str, str], str | None]) -> str:
    """
    Rewrite the destination of every inline link and image, and of every reference definition (`[guide]: guide.md`),
    outside code. `destination(url, kind)` gets the URL without angle brackets and `kind` (`link`, `image` or
    `reference`, which either can use), and returns the new destination or None to leave it as it is.
    """

    def written(url: str) -> str:
        # A destination with a space in it is one destination only between angle brackets.
        return f"<{url}>" if re.search(r"\s", url) else url

    def inline(match: re.Match[str]) -> str:
        kind = "image" if match.group("bang") else "link"
        new = destination(match.group("url").strip("<>"), kind)
        if new is None:
            return match.group(0)
        return f"{match.group('bang')}[{match.group('label')}]({written(new)}{match.group('title') or ''})"

    def prose(part: str) -> str:
        code_spans = [match.span() for match in _INLINE_CODE.finditer(part)]

        def reference(match: re.Match[str]) -> str:
            if any(start <= match.start() < end for start, end in code_spans):
                return match.group(0)
            new = destination(match.group("url").strip("<>"), "reference")
            return match.group(0) if new is None else match.group("lead") + written(new)

        part = _REFERENCE.sub(reference, part)
        return map_outside_inline_code(part, lambda text: _INLINE_LINK.sub(inline, text))

    return "".join(segment.text if segment.code else prose(segment.text) for segment in segments(text))


def mask_code(text: str) -> str:
    """`text` with every character of code blanked out but its newlines, so offsets and line numbers still match."""
    return "".join(re.sub(r"[^\n]", " ", part) if is_code else part for part, is_code in prose_and_code(text))


def prose_and_code(text: str) -> list[tuple[str, bool]]:
    """Split `text` into (part, is_code) pieces covering every character, in order."""
    parts: list[tuple[str, bool]] = []
    for segment in segments(text):
        if segment.code:
            parts.append((segment.text, True))
            continue
        position = 0
        for match in _INLINE_CODE.finditer(segment.text):
            parts.append((segment.text[position : match.start()], False))
            parts.append((match.group(0), True))
            position = match.end()
        parts.append((segment.text[position:], False))
    return parts


def line_of(text: str, needle: str) -> int | None:
    """1-based line of the first occurrence of `needle`, for error messages."""
    position = text.find(needle)
    return None if position < 0 else text.count("\n", 0, position) + 1


def heading_anchor(heading: str) -> str:
    """
    A heading's anchor, the way GitHub and VS Code make them: `Pages & views` -> `pages--views`. The platform
    configures the toc extension with the same rule (pymdownx.slugs.slugify(case="lower"), see build.py), so
    anchors written for GitHub keep working on the site.
    """
    import unicodedata

    value = re.sub(r"</?[^>]*>", "", unicodedata.normalize("NFC", heading)).strip().lower()
    return re.sub(r"[^\w\- ]", "", value).replace(" ", "-")
