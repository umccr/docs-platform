"""Obsidian callouts (`> [!note] Title`) to admonitions (`!!! note "Title"`), which both engines render."""

import re

from umccr_docs.markdown import segments

_CALLOUT_START = re.compile(r"^(?P<indent>[ \t]*)>[ \t]*\[!(?P<type>[\w-]+)\](?P<fold>[+-]?)[ \t]*(?P<title>.*)$")

# Obsidian's callout types and aliases, mapped to the admonition types the theme styles.
_TYPES = {
    "note": "note",
    "abstract": "abstract",
    "summary": "abstract",
    "tldr": "abstract",
    "info": "info",
    "todo": "info",
    "tip": "tip",
    "hint": "tip",
    "important": "tip",
    "success": "success",
    "check": "success",
    "done": "success",
    "question": "question",
    "help": "question",
    "faq": "question",
    "warning": "warning",
    "caution": "warning",
    "attention": "warning",
    "failure": "failure",
    "fail": "failure",
    "missing": "failure",
    "danger": "danger",
    "error": "danger",
    "bug": "bug",
    "example": "example",
    "quote": "quote",
    "cite": "quote",
}


def _convert(text: str) -> str:
    lines = text.splitlines(keepends=True)
    output: list[str] = []
    index = 0
    while index < len(lines):
        start = _CALLOUT_START.match(lines[index].rstrip("\n"))
        if not start:
            output.append(lines[index])
            index += 1
            continue

        indent = start.group("indent")
        kind = _TYPES.get(start.group("type").lower(), "note")
        marker = {"-": "???", "+": "???+"}.get(start.group("fold"), "!!!")
        title = start.group("title").strip().replace('"', '\\"')
        output.append(f"{indent}{marker} {kind}" + (f' "{title}"' if title else "") + "\n")
        index += 1

        quoted = re.compile(rf"^{re.escape(indent)}>[ ]?(?P<content>.*)$")
        body = []
        while index < len(lines):
            line = quoted.match(lines[index].rstrip("\n"))
            if not line:
                break
            body.append(line.group("content"))
            index += 1
        if not any(content.strip() for content in body):
            body = [""]
        output.append("\n")
        output.extend(f"{indent}    {content}\n" if content.strip() else "\n" for content in body)
        output.append("\n")
    return "".join(output)


def convert_callouts(body: str) -> str:
    return "".join(segment.text if segment.code else _convert(segment.text) for segment in segments(body))
