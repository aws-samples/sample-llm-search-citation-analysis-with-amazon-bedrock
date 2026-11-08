"""
Citation Gap Analysis API — GET /api/citation-gaps

Citation sources where competitors are mentioned but your brand isn't: the
URLs an AI answer cites next to a competitor and never next to a first-party
brand (``shared.citation_gap_rules``), from each keyword's latest run.

- ``keyword``: that keyword's gaps (the first 50), covered sources (20) and
  domain summary (20) of its whole latest run, enriched with crawl metadata;
  always read live. Each list carries ``<list>_total`` and
  ``<list>_next_token``; ``view=gaps|covered|domains`` with that token pages
  the rest (``KEYWORD_PAGE`` a page; a token of another run is
  ``cursor_expired``).
- any other scope (``group_id`` | ``keyword_ids`` | ``scope=all``; without
  one, every active keyword): every keyword's summary, sorted by its
  high-priority gaps, ``limit`` a page (``keyword_summaries_next_token`` /
  ``next_token`` for the next, ``keyword_summaries_total``), the first 30 of
  every gap of the scope ranked (``top_gaps``, crawl-enriched; ``gaps_total``,
  ``gaps_next_token``; ``view=gaps`` pages every gap) and the totals over
  every keyword; computed live or served from the ``gaps`` artifacts, per
  ``shared.action_scope_serve``. ``gaps_truncated`` says a keyword's stored
  findings predate the full gap list (a KeywordLatest rebuild completes it).
"""

import os
import sys
from typing import Any

import boto3
from botocore.config import Config

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.action_scope_serve import action_list_endpoint, action_request, limit_param, serve_action_list
from shared.api_response import success_response, validation_error
from shared.citation_gap_rules import (
    KEYWORD_COVERED_LIMIT,
    KEYWORD_DOMAINS_LIMIT,
    KEYWORD_GAPS_LIMIT,
    first_party_brand_error,
    is_first_party_domain,
    keyword_gap_result,
)
from shared.decorators import api_handler
from shared.dynamodb_batch import query_latest_per_key
from shared.scope_params import ReportScope
from shared.search_results import query_latest_run, search_results_table_name
from shared.snapshot_artifacts import encode_snapshot_cursor, snapshot_page_start
from shared.utils import get_brand_config

# Crawl enrichment runs in a pool capped at ten; the keyword fan-out uses the
# shared scope pool (``map_scope_keywords``), so the resource pools 50.
CRAWLED_CONTENT_MAX_WORKERS = 10
dynamodb = boto3.resource('dynamodb', config=Config(max_pool_connections=50))

SEARCH_RESULTS_TABLE = search_results_table_name()
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']

#: Keyword summaries per page by default, and at most (``limit``).
DEFAULT_LIMIT = 10
MAX_LIMIT = 100

#: The views: the whole answer, or one page of a list (``gaps`` for any scope; ``covered``, ``domains`` for one keyword).
VIEWS = ('summary', 'gaps', 'covered', 'domains')
#: Each one-keyword list: its view, its key and how many the answer lists first.
KEYWORD_LISTS = {'gaps': ('gaps', KEYWORD_GAPS_LIMIT), 'covered': ('covered_sources', KEYWORD_COVERED_LIMIT), 'domains': ('domain_summary', KEYWORD_DOMAINS_LIMIT)}
#: Items a one-keyword ``view`` page holds.
KEYWORD_PAGE = 50

__all__ = ['handler', 'is_first_party_domain']


def _batch_crawled_info(urls: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch only consumed fields from the latest crawl row of each URL.

    URL queries are deduplicated by ``query_latest_per_key`` and bounded to ten
    workers. Missing rows and per-URL failures produce no metadata entry, so a
    partial crawl-table failure never discards an otherwise valid gap.
    """
    if not urls:
        return {}
    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    raw = query_latest_per_key(
        table=table,
        partition_key_name='normalized_url',
        partition_values=urls,
        max_workers=CRAWLED_CONTENT_MAX_WORKERS,
        projection_expression='#title, #seo, #authority, #crawled',
        expression_attribute_names={
            '#title': 'title',
            '#seo': 'seo_analysis',
            '#authority': 'domain_authority',
            '#crawled': 'crawled_at',
        },
    )
    shaped: dict[str, dict[str, Any]] = {}
    for url, item in raw.items():
        if not item:
            continue
        shaped[url] = {
            'title': item.get('title', ''),
            'seo_analysis': item.get('seo_analysis', {}),
            'domain_authority': item.get('domain_authority'),
            'last_crawled': item.get('crawled_at'),
        }
    return shaped


def _enrich_sources(sources: list[dict[str, Any]]) -> None:
    """Attach crawl metadata after final response selection.

    Repeated URLs remain repeated response records, including their keyword
    attribution, but share one crawl lookup.
    """
    urls = list(dict.fromkeys(source['url'] for source in sources))
    crawled_info = _batch_crawled_info(urls)
    for source in sources:
        source.update(crawled_info.get(source['url'], {}))


def _run_build(result: dict[str, Any]) -> str:
    """The build id of a one-keyword list token: the run it pages (a newer run expires it)."""
    return f'run-{result.get("timestamp") or "none"}'


def _first_pages(result: dict[str, Any]) -> dict[str, Any]:
    """The one-keyword answer: each list's first items with ``<list>_total`` and ``<list>_next_token``."""
    build = _run_build(result)
    body = dict(result)
    for key, first in KEYWORD_LISTS.values():
        items = result[key]
        body.update({key: items[:first], f'{key}_total': len(items), f'{key}_next_token': encode_snapshot_cursor(first, len(items), build)})
    return body


def _keyword_result(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """One keyword's gap result over every row of its latest run, every list whole (not enriched)."""
    if first_party_brand_error(config) is None:
        timestamp, rows = query_latest_run(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword)
    else:
        timestamp, rows = '', []
    return keyword_gap_result(keyword, timestamp, rows, config)


def analyze_citation_gaps(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """One keyword's answer from its whole latest run: each list's first page, its returned sources enriched."""
    result = _keyword_result(keyword, config)
    if 'error' in result:
        return result
    body = _first_pages(result)
    _enrich_sources([*body['gaps'], *body['covered_sources']])
    return body


def keyword_list_page(keyword: str, config: dict[str, Any], view: str, next_token: str | None, event: dict[str, Any]) -> dict[str, Any]:
    """One ``view`` page of a keyword's list (``KEYWORD_PAGE`` items from the token's offset), its sources enriched."""
    result = _keyword_result(keyword, config)
    if 'error' in result:
        return success_response(result, event)
    key, _first = KEYWORD_LISTS[view]
    cursor, rejected = snapshot_page_start(next_token, _run_build(result), (), event)
    if rejected is not None:
        return rejected
    offset = cursor.offset if cursor else 0
    items = result[key]
    page = [dict(item) for item in items[offset:offset + KEYWORD_PAGE]]
    if key != 'domain_summary':
        _enrich_sources(page)
    return success_response({
        'keyword': keyword, 'timestamp': result['timestamp'], key: page, f'{key}_total': len(items),
        'next_token': encode_snapshot_cursor(offset + KEYWORD_PAGE, len(items), _run_build(result)),
    }, event)


def scope_gaps(
    report_scope: ReportScope, config: dict[str, Any], limit: int, next_token: str | None, event: dict[str, Any], view: str = 'summary',
) -> dict[str, Any]:
    """The scope rollup's response (one page of keyword summaries, the enriched first gaps and the totals) or one ``view=gaps`` page."""
    params = {'limit': limit, 'scope': report_scope.describe(), 'view': view}
    request = action_request('citation-gaps', 'gaps', params, report_scope, config, event, next_token, job_params={})
    gaps = serve_action_list(request, dynamodb, dynamodb.Table(SEARCH_RESULTS_TABLE), config)
    body = gaps.body
    if body is None:
        return gaps.response or {}
    if view == 'gaps':
        _enrich_sources(body['gaps'])
        return success_response(body, event)
    _enrich_sources(body['top_gaps'])
    return success_response({**body, 'next_token': body['keyword_summaries_next_token']}, event)


@api_handler
@action_list_endpoint({
    'limit': limit_param(DEFAULT_LIMIT, MAX_LIMIT),
    'view': {'type': str, 'choices': list(VIEWS), 'default': VIEWS[0]},
}, lambda: dynamodb, paged=True)
def handler(
    event, context, report_scope: ReportScope, limit: int = DEFAULT_LIMIT, next_token: str | None = None, view: str = 'summary',
) -> dict[str, Any]:
    """Citation gaps of one keyword, a group, explicit ids, or every active keyword (see the module docstring)."""
    config = get_brand_config()
    configuration_error = first_party_brand_error(config)
    if configuration_error is not None:
        return success_response(configuration_error, event)
    if report_scope.is_single_keyword:
        if view == 'summary':
            return success_response(analyze_citation_gaps(report_scope.keywords[0], config), event)
        return keyword_list_page(report_scope.keywords[0], config, view, next_token, event)
    if view not in ('summary', 'gaps'):
        return validation_error(f'view={view} pages one keyword\'s list; a scope pages view=gaps', event, 'view')
    return scope_gaps(report_scope, config, limit, next_token, event, view)
