"""Google AI Overview evidence from a DataForSEO organic SERP result: answer text and cited URLs.

Part of the Google AI Overviews client (``google_ai_overview``), next to the other search clients.

The AI Overview of one Google organic results page: its markdown, the plain prose brand extraction
reads (citation pills removed), and the cited reference URLs. The overview is the FIRST ``items[]``
element with ``type == 'ai_overview'``; citations are its top-level ``references`` then every
sub-item's ``references``, in that order. ``links`` are not citations. An overview whose text is
empty after ``markdown_to_text`` is no answer.

``citations_from`` normalizes with our ``shared.utils.normalize_url`` (drops the fragment, so
``#:~:text=`` highlights go, and strips tracking parameters such as ``utm_*``, ``gclid``, ``fbclid`` and
``msclkid``), so AIO citations match the URLs of every other engine; it returns URLs only
(titles/positions are not stored on our rows). The knowledge-graph overview is ignored.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlparse

from shared.utils import normalize_url

#: Bounds on what one result is read for: ``items`` ≤ 500, ``references`` ≤ 2000, ``url`` ≤ 16384 chars.
MAX_ITEMS = 500
MAX_CITATIONS = 2000
MAX_URL_LENGTH = 16_384
#: Nested links (a link inside a link label) need one pass per level; Google product cards use one level.
MAX_LINK_PASSES = 4

_IMAGE = re.compile(r'!\[[^\]]*\]\([^)\s]*\)')
_LINK = re.compile(r'\[((?:[^\[\]]|\[[^\]]*\])*)\]\((https?://[^)\s]+)\)')
_EMPHASIS = re.compile(r'\*\*|__|`')
_HEADING = re.compile(r'^#{1,6}\s+', re.MULTILINE)
_BULLET = re.compile(r'^(\s*)[*+-]\s+', re.MULTILINE)
_PILL_BRACKETS = re.compile(r'^\[|\]$')
_DIGITS = re.compile(r'^\d+$')


def _citation_pill(label: str, url: str) -> bool:
    """``[1]``, ``[[1]]`` or a label equal to the link's host (``www.`` ignored)."""
    text = _PILL_BRACKETS.sub('', label).strip().lower()
    if _DIGITS.match(text):
        return True
    try:
        host = (urlparse(url).hostname or '').lower()
    except ValueError:
        return False
    return text.removeprefix('www.') == host.removeprefix('www.')


def _link_text(match: re.Match[str]) -> str:
    label, url = match.group(1), match.group(2)
    return '' if _citation_pill(label, url) else label


def markdown_to_text(markdown: str) -> str:
    """Plain answer prose: images and citation pills removed, other links reduced to their label.

    Links are reduced until none is left (at most ``MAX_LINK_PASSES`` passes). Google product
    cards arrive as a link inside another link's label, ``[[Product](url) ](url)``; a single pass would
    leave the inner link, URL included, in the prose brand extraction reads (measured live, 2026-10).
    """
    text = _IMAGE.sub('', markdown)
    for _ in range(MAX_LINK_PASSES):
        reduced = _LINK.sub(_link_text, text)
        if reduced == text:
            break
        text = reduced
    text = _EMPHASIS.sub('', text)
    text = _HEADING.sub('', text)
    return _BULLET.sub(r'\1', text)


def _safe_http_url(value: object) -> str | None:
    """An absolute http(s) URL with a host (at most ``MAX_URL_LENGTH`` chars), else ``None``."""
    if not isinstance(value, str) or len(value) > MAX_URL_LENGTH:
        return None
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return None
    if parsed.scheme.lower() not in ('http', 'https') or not parsed.netloc:
        return None
    return value.strip()


def citations_from(sources: Sequence[object]) -> list[str]:
    """Safe, normalized, de-duplicated cited URLs in order of first appearance (≤ 2000)."""
    citations: dict[str, None] = {}
    for source in sources:
        url = _safe_http_url(source.get('url')) if isinstance(source, Mapping) else None
        if url is None:
            continue
        citations.setdefault(normalize_url(url), None)
        if len(citations) >= MAX_CITATIONS:
            break
    return list(citations)


def _list_or_empty(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def find_ai_overview(result: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    """The first ``items[]`` element of type ``ai_overview`` (within the first 500 items)."""
    if result is None:
        return None
    for item in _list_or_empty(result.get('items'))[:MAX_ITEMS]:
        if isinstance(item, Mapping) and item.get('type') == 'ai_overview':
            return item
    return None


def _references(overview: Mapping[str, Any]) -> list[Any]:
    references = list(_list_or_empty(overview.get('references')))
    for sub_item in _list_or_empty(overview.get('items'))[:MAX_ITEMS]:
        if isinstance(sub_item, Mapping):
            references.extend(_list_or_empty(sub_item.get('references')))
    return references


def parse_ai_overview(result: dict[str, Any] | None) -> tuple[str | None, str, list[str]]:
    """``(answer_markdown, answer_text, cited_urls)`` of one organic SERP result."""
    overview = find_ai_overview(result)
    if overview is None:
        return None, '', []
    markdown = overview.get('markdown')
    if not isinstance(markdown, str):
        markdown = None
    citations = citations_from(_references(overview))
    text = markdown_to_text(markdown) if markdown else ''
    if not text.strip():
        return None, '', citations
    return markdown, text, citations
