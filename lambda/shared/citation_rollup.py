"""
The citation rollup: ``GET /api/citations`` precomputed per scope, stored in S3.

Aggregating a scope's Citations rows on every request is O(rows): the whole
table took 24 s for 71k rows and every page, sort click and export page paid
it again. The rollup does that aggregation once per workflow run
(``shared.citation_rollup_build``, run by the GenerateSummary Lambda) and the
API serves pages from it (``shared.citation_rollup_serve``).

Layout under the ``ROLLUP_PREFIX`` of ``CITATION_ROLLUP_BUCKET``::

    citation-rollups/current.json                         the live build (written LAST)
    citation-rollups/<build_id>/<scope_dir>/manifest.json.gz
    citation-rollups/<build_id>/<scope_dir>/chunks/<content_type>/<n>.json.gz
    citation-rollups/<build_id>/<scope_dir>/entries.json.gz
    citation-rollups/rebuild-requested.json               debounce marker of API-triggered rebuilds

- ``current.json``: ``build_id``, ``built_at``, ``brand_config_updated_at``
  and, per scope key, the scope's directory and keyword-set fingerprint. A
  reader compares the fingerprint (and the brand config's ``updated_at``)
  with what it resolves now; a mismatch means the build is stale.
- ``manifest``: the scope-wide totals every page carries
  (``CitationAggregate.totals``) and the URL count per content type.
- ``chunks``: the base order (most cited first) of each content type
  (``all``, ``video``, ``page``) in ``CHUNK_SIZE`` full entries: a default
  order page is one or two chunk reads.
- ``entries``: every URL of the scope as a compact row (``CompactEntry``),
  keyword texts as indices into the file's ``keywords`` list: what other
  orders and filters sort in memory.

Scope keys: ``table`` (no scope: every Citations row), ``all`` (active
keywords), ``market:<id>`` (incl. ``global``), ``group:<id>`` and
``group:<id>|market:<id>``. One keyword and ``keyword_ids`` scopes are not
precomputed; they are small and read live.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from shared.citation_pages import EntryView, TopUrl, url_domain
from shared.scope_params import ReportScope
from shared.snapshot_store import (
    ALL_SCOPE,
    decode_json,
    encode_json,
    group_scope,
    is_missing_object,
    keyword_fingerprint,
    market_scope,
    named_scope_key,
    scope_dir,
)

BUILD_ACTION = 'build_citation_rollup'
"""The GenerateSummary event ``action`` that builds the rollup."""

ROLLUP_PREFIX = 'citation-rollups/'
CURRENT_KEY = f'{ROLLUP_PREFIX}current.json'
REBUILD_MARKER_KEY = f'{ROLLUP_PREFIX}rebuild-requested.json'
FORMAT_VERSION = 1

CHUNK_SIZE = 1000
CHUNK_CONTENT_TYPES = ('all', 'video', 'page')

TABLE_SCOPE = 'table'

CompactEntry = list[Any]
"""One ``entries`` row: ``[url, citation_count, keyword_count, content_type, domain, by_provider, keyword_indices]``."""

COMPACT_VIEW: EntryView[CompactEntry] = EntryView(
    url=lambda row: row[0],
    citation_count=lambda row: row[1],
    keyword_count=lambda row: row[2],
    content_type=lambda row: row[3],
    domain=lambda row: row[4],
)


def scope_key(report_scope: ReportScope | None) -> str | None:
    """The rollup scope serving ``report_scope``, or ``None`` when it is not precomputed (one keyword, ids)."""
    return TABLE_SCOPE if report_scope is None else named_scope_key(report_scope)


def build_prefix(build_id: str) -> str:
    return f'{ROLLUP_PREFIX}{build_id}/'


def manifest_key(scope_path: str) -> str:
    return f'{scope_path}/manifest.json.gz'


def chunk_key(scope_path: str, content_type: str, index: int) -> str:
    return f'{scope_path}/chunks/{content_type}/{index}.json.gz'


def entries_key(scope_path: str) -> str:
    return f'{scope_path}/entries.json.gz'


def chunk_count(url_count: int) -> int:
    return -(-url_count // CHUNK_SIZE)


def compact_entries(top_urls: list[TopUrl], domain_of: Callable[[str], str] = url_domain) -> dict[str, Any]:
    """The ``entries`` file of a scope: compact rows in base order plus the keyword texts they index.

    ``domain_of`` is ``url_domain``; a builder writing many scopes passes a memoized one.
    """
    keywords = sorted({keyword for entry in top_urls for keyword in entry['keywords']})
    index = {keyword: position for position, keyword in enumerate(keywords)}
    rows = [
        [
            entry['url'], entry['citation_count'], entry['keyword_count'], entry['content_type'],
            domain_of(entry['url']), entry['by_provider'], [index[keyword] for keyword in entry['keywords']],
        ]
        for entry in top_urls
    ]
    return {'keywords': keywords, 'entries': rows}


def expand_entry(row: CompactEntry, keywords: list[str], include_keywords: bool) -> TopUrl:
    """A compact row as the API lists it (``shared.citation_pages.list_entry``)."""
    entry: TopUrl = {
        'url': row[0], 'citation_count': row[1], 'by_provider': row[5], 'keyword_count': row[2], 'content_type': row[3],
    }
    if include_keywords:
        entry['keywords'] = [keywords[position] for position in row[6]]
    return entry


__all__ = [
    'ALL_SCOPE',
    'BUILD_ACTION',
    'CHUNK_CONTENT_TYPES',
    'CHUNK_SIZE',
    'COMPACT_VIEW',
    'CURRENT_KEY',
    'FORMAT_VERSION',
    'REBUILD_MARKER_KEY',
    'ROLLUP_PREFIX',
    'TABLE_SCOPE',
    'CompactEntry',
    'build_prefix',
    'chunk_count',
    'chunk_key',
    'compact_entries',
    'decode_json',
    'encode_json',
    'entries_key',
    'expand_entry',
    'group_scope',
    'is_missing_object',
    'keyword_fingerprint',
    'manifest_key',
    'market_scope',
    'scope_dir',
    'scope_key',
]
