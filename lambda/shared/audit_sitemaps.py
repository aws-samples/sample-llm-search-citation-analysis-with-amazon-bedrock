"""
XML sitemaps of the audited site: recognising a sitemap and reading its ``<loc>`` entries.

A document counts as a sitemap when its content type mentions ``xml`` or its body starts (after an optional
BOM and whitespace) with ``<?xml``, ``<urlset`` or ``<sitemapindex``. Only ``<loc>`` values are read
(``lastmod`` / ``priority`` play no part in the audit); a ``<sitemapindex>`` lists further sitemaps, anything
else lists pages. ``<loc>`` is read with a pattern rather than an XML parser: no entity or DTD of the
document is ever expanded, and namespace prefixes (``<sm:loc>``) and CDATA sections are accepted.

Limits (enforced by the discovery step): index recursion ``MAX_SITEMAP_DEPTH`` (3), at most
``MAX_SITEMAP_DOCS`` (300) documents, documents over 10 MiB are skipped whole, and gzipped sitemaps are not
read.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Literal

MAX_SITEMAP_DEPTH = 3
MAX_SITEMAP_DOCS = 300
SITEMAP_TIMEOUT_S = 15.0

_XML_START = re.compile(r'^\s*<(\?xml|urlset|sitemapindex|[A-Za-z_][\w.-]*:(urlset|sitemapindex))\b', re.IGNORECASE)
_INDEX_ROOT = re.compile(r'<([A-Za-z_][\w.-]*:)?sitemapindex\b', re.IGNORECASE)
_LOC = re.compile(
    r'<(?:[A-Za-z_][\w.-]*:)?loc\s*>\s*(?:<!\[CDATA\[([^\]<]*)\]\]>|([^<]*))\s*</(?:[A-Za-z_][\w.-]*:)?loc\s*>',
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Sitemap:
    kind: Literal['index', 'urlset']
    locations: tuple[str, ...]


def looks_like_sitemap(content_type: str, body: str) -> bool:
    """Whether a response is an XML sitemap (by content type or by its first element)."""
    return 'xml' in content_type.lower() or bool(_XML_START.match(body.lstrip('\ufeff')))


def parse_sitemap(body: str) -> Sitemap:
    """The kind of sitemap and its ``<loc>`` values (entity-decoded, blank ones dropped)."""
    kind: Literal['index', 'urlset'] = 'index' if _INDEX_ROOT.search(body[:4_096]) else 'urlset'
    locations = (html.unescape(match.group(1) or match.group(2) or '').strip() for match in _LOC.finditer(body))
    return Sitemap(kind=kind, locations=tuple(location for location in locations if location))
