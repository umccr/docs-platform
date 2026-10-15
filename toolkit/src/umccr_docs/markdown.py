"""Code-aware Markdown helpers: transformations never touch fenced code blocks or inline code spans."""

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass

_FENCE_OPEN = re.compile(r"^(?P<indent>[ \t]{0,3})(?P<fence>`{3,}|~{3,})(?P<info>[^\n]*)$")
_INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.DOTALL)
_FRONTMATTER = re.compile(r"\A---[ \t]*\n(?P<yaml>.*?\n)?---[ \t]*(?:\n|\Z)", re.DOTALL)


@dataclass(frozen=True)
class Segment:
    """A run of Markdown: plain text, or a fenced code block with its info string."""

    text: str
    fenced: bool = False
    info: str = ""


def split_frontmatter(text: str) -> tuple[str, str]:
    """(frontmatter including its `---` lines, body). Frontmatter is empty when absent."""
    match = _FRONTMATTER.match(text)
    if not match:
        return "", text
    return text[: match.end()], text[match.end() :]


def segments(text: str) -> Iterator[Segment]:
    """Split Markdown into text and fenced-code segments, preserving every character."""
    lines = text.splitlines(keepends=True)
    buffer: list[str] = []
    index = 0
    while index < len(lines):
        opening = _FENCE_OPEN.match(lines[index].rstrip("\n"))
        if not opening:
            buffer.append(lines[index])
            index += 1
            continue

        if buffer:
            yield Segment("".join(buffer))
            buffer = []
        fence = opening.group("fence")
        closing = re.compile(rf"^[ \t]{{0,3}}{re.escape(fence[0])}{{{len(fence)},}}[ \t]*$")
        block = [lines[index]]
        index += 1
        while index < len(lines):
            block.append(lines[index])
            index += 1
            if closing.match(block[-1].rstrip("\n")):
                break
        yield Segment("".join(block), fenced=True, info=opening.group("info").strip())

    if buffer:
        yield Segment("".join(buffer))


def fenced_body(segment: Segment) -> str:
    """The content of a fenced block, without its opening and closing fence lines."""
    lines = segment.text.splitlines(keepends=True)
    closed = len(lines) > 1 and re.match(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$", lines[-1].rstrip("\n"))
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
    """Apply `transform` to everything that is neither fenced code nor inline code."""
    return "".join(
        segment.text if segment.fenced else map_outside_inline_code(segment.text, transform)
        for segment in segments(text)
    )


def prose_and_code(text: str) -> list[tuple[str, bool]]:
    """Split `text` into (part, is_code) pieces covering every character, in order."""
    parts: list[tuple[str, bool]] = []
    for segment in segments(text):
        if segment.fenced:
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
