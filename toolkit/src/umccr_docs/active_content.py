"""
What in an HTML, SVG or XML document can run code in the reader's browser.

The contract checks rendered pages and a site's own documents with this, and `verify-site` checks the built site.
It reads markup as a browser could, not as the author meant it: entities are decoded, and what a browser might parse
as markup (comment contents, `<style>` and `<title>` inside SVG) is read as markup too, so a finding can be a false
alarm but a script should not be missed.
"""

import re
from html.parser import HTMLParser

# Files a browser opens as a document, which can carry script: pages, and SVG or XML opened directly.
DOCUMENT_SUFFIXES = frozenset({".html", ".htm", ".xhtml", ".svg", ".xml", ".xsl", ".xslt"})

SCRIPT = "a <script> element"
EMBED = "an embedded frame or object"
HANDLER = "an HTML event handler attribute"
SCRIPT_URL = "a javascript: URL"
BASE = "a <base> element"
STYLESHEET = "an XML stylesheet"
ENTITY = "an XML entity declaration"

_EMBEDDING = frozenset({"iframe", "frame", "frameset", "object", "embed", "applet"})
# Attributes a browser loads or follows as a URL, where a javascript: URL runs.
_URL_ATTRIBUTES = frozenset({"href", "src", "action", "formaction", "data", "poster", "background", "cite"})
# SVG animations can set any attribute of their parent, a link's href or an event handler included.
_ANIMATIONS = frozenset({"animate", "set"})
_ANIMATION_VALUES = frozenset({"to", "from", "by", "values"})
_SCRIPT_SCHEMES = ("javascript:", "vbscript:")
# Browsers drop tabs and newlines anywhere in a URL and trim control characters and spaces around it.
_URL_NOISE = re.compile(r"[\x00-\x20]+")
_ENTITY_DECLARATION = re.compile(r"<!ENTITY\b", re.IGNORECASE)


def _local(name: str) -> str:
    """`xlink:href` -> `href`, `svg:script` -> `script`."""
    return name.rpartition(":")[2]


class _Scanner(HTMLParser):
    # Only script content is raw text here. A browser parses the content of the others as markup inside SVG and
    # MathML (`<svg><style><img onerror=...>`), so it is read as markup.
    CDATA_CONTENT_ELEMENTS = ("script",)
    RCDATA_CONTENT_ELEMENTS = ()

    def __init__(self, *, scripts_allowed: bool) -> None:
        super().__init__(convert_charrefs=True)
        self.scripts_allowed = scripts_allowed
        self.found: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element = _local(tag)
        if element == "script" and not self.scripts_allowed:
            self.found.append(SCRIPT)
        elif element in _EMBEDDING:
            self.found.append(EMBED)
        elif element == "base":
            self.found.append(BASE)

        for name, value in attrs:
            attribute = _local(name)
            if attribute.startswith("on"):
                self.found.append(HANDLER)
            if value is None:
                continue
            url = _URL_NOISE.sub("", value).lower()
            followed = attribute in _URL_ATTRIBUTES and url.startswith(_SCRIPT_SCHEMES)
            animated = element in _ANIMATIONS and attribute in _ANIMATION_VALUES
            if followed or (animated and any(scheme in url for scheme in _SCRIPT_SCHEMES)):
                self.found.append(SCRIPT_URL)
            elif element in _ANIMATIONS and attribute == "attributename" and url.startswith("on"):
                self.found.append(HANDLER)

    def handle_comment(self, data: str) -> None:
        # A browser can end a comment earlier than this parser does, so what is inside counts as markup.
        self.found.extend(_scan(data, scripts_allowed=self.scripts_allowed))

    def unknown_decl(self, data: str) -> None:
        # <![CDATA[ ... ]]>, which is markup in HTML and character data only in XML.
        self.found.extend(_scan(data, scripts_allowed=self.scripts_allowed))

    def handle_pi(self, data: str) -> None:
        if data.lower().startswith("xml-stylesheet"):
            self.found.append(STYLESHEET)


def _scan(text: str, *, scripts_allowed: bool) -> list[str]:
    scanner = _Scanner(scripts_allowed=scripts_allowed)
    scanner.feed(text)
    scanner.close()
    if _ENTITY_DECLARATION.search(text):
        # An XML document's own entities can expand to any markup, script included.
        scanner.found.append(ENTITY)
    return scanner.found


def unsafe_html(text: str, *, scripts_allowed: bool = False) -> list[str]:
    """
    What in `text` (HTML, SVG or XML) could run code, as descriptions in order of appearance, each once. With
    `scripts_allowed`, `<script>` elements are not reported: the theme's own pages carry its scripts.
    """
    return list(dict.fromkeys(_scan(text, scripts_allowed=scripts_allowed)))
