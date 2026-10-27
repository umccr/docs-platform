"""Checks on a built site before it is published."""

import re
from pathlib import Path

from umccr_docs.active_content import NOT_UTF8, decode_document, unsafe_html
from umccr_docs.build import THEME_FILES
from umccr_docs.media_types import content_type_for, is_document

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_SITE_BYTES = 500 * 1024 * 1024

# Never published: source maps expose source, the rest are credentials or state.
FORBIDDEN_SUFFIXES = frozenset({".map", ".pem", ".key", ".p12", ".pfx", ".tfstate", ".sqlite", ".db"})
FORBIDDEN_NAMES = frozenset({"id_rsa", "id_ed25519", "credentials", "terraform.tfvars"})

TEXT_SUFFIXES = frozenset({".html", ".htm", ".js", ".css", ".json", ".xml", ".txt", ".md", ".csv", ".yml", ".yaml"})

SECRET_PATTERNS = [
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key ID"),
    (re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"), "a private key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "a GitHub token"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"), "a Slack token"),
    (re.compile(r"aws_secret_access_key\s*[=:]\s*\S{20,}", re.IGNORECASE), "an AWS secret access key"),
]


def verify_site(site_dir: Path) -> list[str]:
    """Every problem with the built site, as human-readable lines."""
    problems: list[str] = []
    if not site_dir.is_dir():
        return [f"{site_dir} does not exist"]

    for required in ("index.html", "404.html"):
        if not (site_dir / required).is_file():
            problems.append(f"{required} is missing from the site root")
    # Every page links these, so a site without one loses the catalogue, the account menu or the chat panel. The usual
    # cause is a toolkit installed without part of its theme:
    # docs/issues/2026-10-21-theme-script-missing-from-wheel.md.
    for required in THEME_FILES:
        if not (site_dir / required).is_file():
            problems.append(f"{required} is missing: the toolkit was installed without part of its theme")

    total = 0
    for path in sorted(site_dir.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(site_dir)
        size = path.stat().st_size
        total += size

        if any(part.startswith(".") for part in relative.parts):
            problems.append(f"{relative}: hidden files are not published")
        if path.suffix.lower() in FORBIDDEN_SUFFIXES or path.name.lower() in FORBIDDEN_NAMES:
            problems.append(f"{relative}: this kind of file must not be published")
        if path.is_symlink():
            problems.append(f"{relative}: symlinks are not published")
        if size > MAX_FILE_BYTES:
            problems.append(
                f"{relative}: {size // (1024 * 1024)} MB is over the {MAX_FILE_BYTES // (1024 * 1024)} MB limit"
            )

        suffix = path.suffix.lower()
        document = is_document(content_type_for(relative.as_posix()))
        if (suffix in TEXT_SUFFIXES or document) and size <= MAX_FILE_BYTES:
            data = path.read_bytes()
            text = data.decode("utf-8", errors="replace")
            for pattern, description in SECRET_PATTERNS:
                if pattern.search(text):
                    problems.append(f"{relative}: looks like it contains {description}")
            if document:
                problems.extend(_document_problems(relative, data))

    if total > MAX_SITE_BYTES:
        problems.append(f"the site is {total // (1024 * 1024)} MB, over the {MAX_SITE_BYTES // (1024 * 1024)} MB limit")
    return problems


def _document_problems(relative: Path, data: bytes) -> list[str]:
    """
    What could run code in a file the site serves as a document. The theme prints configuration and front matter
    values unescaped, so this catches what one could still do inside an attribute. The theme's pages carry its own
    scripts; nothing else may.
    """
    text = decode_document(data)
    if text is None:
        return [f"{relative}: {NOT_UTF8}"]
    found = unsafe_html(text, scripts_allowed=relative.suffix.lower() == ".html")
    return [f"{relative}: {description} is not allowed" for description in found]
