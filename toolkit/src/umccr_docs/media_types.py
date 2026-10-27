"""
The Content-Type each published file is served with, and which of those a browser opens as a document that can run
script. The publisher, the contract and `verify-site` all decide with this, so a file is checked as what it is served
as, whatever its extension.
"""

import mimetypes
from pathlib import Path

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".xml": "application/xml; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".gz": "application/gzip",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}

# Python's own table only. The module-level functions also read the host's mime.types files, so the same file could be
# served as XHTML from one machine and downloaded from another.
_TABLE = mimetypes.MimeTypes()

# Types a browser parses as a document, where markup can run script: HTML, and XML in any of its forms.
_DOCUMENT_TYPES = frozenset(
    {"text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml", "text/xsl"}
)


def is_document(content_type: str) -> bool:
    media_type = content_type.partition(";")[0].strip().lower()
    return media_type in _DOCUMENT_TYPES or media_type.endswith("+xml")


def content_type_for(relative: str) -> str:
    suffix = Path(relative).suffix.lower()
    if suffix in _CONTENT_TYPES:
        return _CONTENT_TYPES[suffix]
    guessed, encoding = _TABLE.guess_type(relative)
    if guessed is None or encoding is not None:
        # A compressed file such as x.svgz is served as bytes: without a Content-Encoding no browser can open it.
        return "application/octet-stream"
    # Documents are served as UTF-8, the encoding they are checked in, so no declaration inside one can change it.
    return f"{guessed}; charset=utf-8" if is_document(guessed) else guessed
