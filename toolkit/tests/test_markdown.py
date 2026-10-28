import pytest

from umccr_docs.build import markdown_renderer
from umccr_docs.markdown import mask_code, prose_and_code, rewrite_links, segments

MARK = "<b>MARK</b>"

# What Python-Markdown, with the platform's extensions, renders as code. Indented blocks are content, not code, after
# the containers the platform's extensions add.
ENGINE_CASES = {
    "an indented block on its own": (f"    {MARK}\n", True),
    "an indented line continuing a paragraph": (f"Para\n    {MARK}\n", False),
    "an indented block after a paragraph": (f"Para\n\n    {MARK}\n", True),
    "an indented block after a heading": (f"# Heading\n\n    {MARK}\n", True),
    "a tab-indented block": (f"Para\n\n\t{MARK}\n", True),
    "a code block's later lines": (f"Para\n\n    one\n\n    {MARK}\n", True),
    "the line after a code block": (f"Para\n\n    one\n{MARK}\n", False),
    "a list item's content": (f"- item\n\n    {MARK}\n", False),
    "an ordered list item's content": (f"1. item\n\n    {MARK}\n", False),
    "a list item's lazy content": (f"- item\nlazy\n\n    {MARK}\n", False),
    "a nested list item's content": (f"- a\n- b\n    - nested\n\n        {MARK}\n", False),
    "code in a list item": (f"- item\n\n        {MARK}\n", True),
    "a paragraph after a list": (f"- item\n\npara\n\n    {MARK}\n", True),
    "a dash line in a paragraph": (f"Para\n- not a list\n\n    {MARK}\n", True),
    "a rule": (f"- - -\n\n    {MARK}\n", True),
    "an admonition's content": (f"!!! note\n    text\n\n    {MARK}\n", False),
    "a converted callout": (f'!!! note "Title"\n\n    line\n    {MARK}\n', False),
    "code in an admonition": (f"!!! note\n    text\n\n        {MARK}\n", True),
    "a list in an admonition": (f"!!! note\n    - item\n\n        {MARK}\n", False),
    "a fence in an admonition": (f"!!! note\n\n    ```bash\n    # comment\n    {MARK}\n    ```\n\nafter\n", True),
    "a fence in a list item": (f"1. step\n\n    ```html\n    {MARK}\n    ```\n", True),
    "a collapsible block's content": (f"??? note\n\n    {MARK}\n", False),
    "a content tab's content": (f'=== "Tab"\n\n    {MARK}\n', False),
    "a definition's content": (f"Term\n:   definition\n\n    {MARK}\n", False),
    "a footnote's content": (f"Text[^1]\n\n[^1]: note\n\n    {MARK}\n", False),
    "a fence": (f"```html\n{MARK}\n```\n", True),
    "inline code": (f"Use `{MARK}` here\n", True),
}


def toolkit_says_code(text: str) -> bool:
    position = text.index("MARK")
    offset = 0
    for part, is_code in prose_and_code(text):
        if offset <= position < offset + len(part):
            return is_code
        offset += len(part)
    raise AssertionError("the mark is in no part")


@pytest.mark.parametrize(("text", "code"), ENGINE_CASES.values(), ids=ENGINE_CASES.keys())
def test_code_is_what_the_engine_renders_as_code(text, code):
    assert (MARK not in markdown_renderer()(text)) is code, "the case itself is wrong"
    assert toolkit_says_code(text) is code


def test_bare_urls_are_links_outside_code():
    # As GitHub and Obsidian show them; a vault's `- GitHub: https://...` lines used to publish as plain text.
    html = markdown_renderer()("- GitHub: https://github.com/umccr/hub.\n- Not in code: `https://example.org`\n")
    assert '<a href="https://github.com/umccr/hub">https://github.com/umccr/hub</a>.' in html, "the full stop is text"
    assert "<code>https://example.org</code>" in html


def test_segments_keep_every_character():
    text = "- item\n\n    content\n\nPara\n\n    code\n\n!!! note\n\n    ```\n    x\n    ```\n"
    assert "".join(segment.text for segment in segments(text)) == text


def test_a_fence_ends_with_its_container():
    text = "!!! note\n\n    ```bash\n    unclosed\n\nAfter the admonition\n"
    assert [segment.code for segment in segments(text)] == [False, True, False]


def test_mask_code_keeps_offsets():
    text = "# Title\n\n```bash\n# comment\n```\n\n    # indented\n"
    masked = mask_code(text)
    assert len(masked) == len(text)
    assert masked.count("\n") == text.count("\n")
    assert "comment" not in masked and "indented" not in masked and masked.startswith("# Title")


def test_rewrites_inline_links_images_and_reference_definitions():
    text = (
        "[Guide](guide.md) ![Chart](chart.png) [Guide][guide] [^1]\n\n"
        '[guide]: guide.md "The guide"\n'
        "  [setup]: <setup notes.md>\n"
        "[^1]: footnote.md is a footnote, not a reference\n"
    )
    seen: list[tuple[str, str]] = []

    def destination(url: str, kind: str) -> str:
        seen.append((url, kind))
        return f"/new/{url}"

    rewritten = rewrite_links(text, destination)
    assert seen == [
        ("guide.md", "reference"),
        ("setup notes.md", "reference"),
        ("guide.md", "link"),
        ("chart.png", "image"),
    ]
    assert '[guide]: /new/guide.md "The guide"\n' in rewritten
    assert "  [setup]: </new/setup notes.md>\n" in rewritten, "a destination with a space keeps its brackets"
    assert "[^1]: footnote.md" in rewritten


def test_rewrite_links_leaves_code_alone():
    text = "```md\n[guide]: guide.md\n[x](x.md)\n```\n\n    [guide]: guide.md\n\n`[x](x.md)`\n"
    assert rewrite_links(text, lambda url, kind: "changed") == text
