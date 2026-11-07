"""Which pages of a site audit a Lighthouse batch measures: the homepage plus one page per URL template.

Only pages that loaded cleanly count (a 2xx HTML answer the audit classed ``ok``): a bot challenge can answer
200, and a paid Lighthouse run of it would measure the challenge. The homepage is the audit's start page,
matched on a canonical key (https, no ``www.``, sorted query) so ``/path`` and ``/path/`` stay distinct, then
tolerating a trailing-slash difference when the exact start URL was not crawled. The other pages are the
first page of each URL template, where a path segment that looks like a value is replaced by a placeholder:
digits ``:id``, a UUID ``:uuid``, a ``YYYY-MM-DD`` date ``:date``, and a segment of more than two hyphen-joined
words ``:slug`` (``/blog/my-first-post`` -> ``/blog/:slug``; a short ``my-account`` stays a fixed route).
At most ``MAX_SAMPLE_PAGES`` pages, each measured on mobile and on desktop.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from shared.dynamo_decimal import to_int

MAX_SAMPLE_PAGES = 10
_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def canonical_url_key(url: str, *, strip_trailing_slash: bool = False) -> str:
    """``url`` on https, without ``www.``, fragment or query order; optionally without a trailing slash."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url.lower()
    host = (parts.hostname or '').lower().removeprefix('www.')
    netloc = f'{host}:{parts.port}' if parts.port and parts.port not in {80, 443} else host
    path = parts.path or '/'
    if strip_trailing_slash and path != '/':
        path = path.rstrip('/') or '/'
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)), doseq=True)
    return urlunsplit(('https', netloc, path, query, ''))


def _segment_template(segment: str) -> str:
    if segment.isdigit():
        return ':id'
    if _UUID.match(segment):
        return ':uuid'
    if _DATE.match(segment):
        return ':date'
    if len(segment.split('-')) > 2:
        return ':slug'
    return segment


def url_template(path: str) -> str:
    """``path`` with the segments that look like values replaced by placeholders."""
    return '/' + '/'.join(_segment_template(segment) for segment in path.split('/') if segment)


def _path(url: str) -> str:
    try:
        return urlsplit(url).path or '/'
    except ValueError:
        return '/'


def is_measurable(page: Mapping[str, Any]) -> bool:
    """A page the audit fetched cleanly as HTML."""
    return (
        isinstance(page.get('url'), str)
        and 200 <= to_int(page.get('status')) < 300
        and page.get('fetch_class') == 'ok'
        and page.get('is_html') is not False
    )


def _start_page(urls: list[str], start_url: str) -> str | None:
    exact = canonical_url_key(start_url)
    found = next((url for url in urls if canonical_url_key(url) == exact), None)
    if found is not None:
        return found
    loose = canonical_url_key(start_url, strip_trailing_slash=True)
    return next((url for url in urls if canonical_url_key(url, strip_trailing_slash=True) == loose), None)


def select_sample(pages: Iterable[Mapping[str, Any]], start_url: str, limit: int = MAX_SAMPLE_PAGES) -> list[str]:
    """The URLs to measure: the start page first, then the first page of each other URL template, in crawl order."""
    urls = list(dict.fromkeys(str(page['url']) for page in pages if is_measurable(page)))
    start = _start_page(urls, start_url)
    selected: list[str] = [start] if start is not None else []
    templates = {url_template(_path(start))} if start is not None else set()
    for url in urls:
        if len(selected) >= limit:
            break
        template = url_template(_path(url))
        if template not in templates:
            templates.add(template)
            selected.append(url)
    return selected[:limit]
