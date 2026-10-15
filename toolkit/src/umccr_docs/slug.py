"""Slug rules. They mirror the site registry in this repository (`infrastructure/sites.ts`)."""

import re

from umccr_docs.errors import DocsError

DOCS_ORIGIN = "https://docs.umccr.org"

# The same limit as MAX_SLUG_LENGTH in infrastructure/sites.ts.
MAX_SLUG_LENGTH = 49

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")

# `sites` is the internal S3 prefix the edge rewrites into.
RESERVED_SLUGS = frozenset({"sites"})


def validate_slug(slug: str) -> None:
    if not SLUG_PATTERN.match(slug) or len(slug) > MAX_SLUG_LENGTH:
        raise DocsError(
            f"Slug '{slug}' must be lowercase letters, digits and inner hyphens, at most {MAX_SLUG_LENGTH} characters"
        )
    if slug in RESERVED_SLUGS:
        raise DocsError(f"Slug '{slug}' is reserved")


def site_url_for(slug: str) -> str:
    return f"{DOCS_ORIGIN}/{slug}/"


def slug_from_site_url(site_url: str | None) -> str | None:
    if not site_url:
        return None
    match = re.fullmatch(re.escape(DOCS_ORIGIN) + r"/([^/]+)/", site_url)
    return match.group(1) if match else None
