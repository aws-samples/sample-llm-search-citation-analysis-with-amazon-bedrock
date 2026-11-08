"""Rows, metrics and environment shared by the SEO API suites (``lambda/seo``, ``shared.seo_*``).

Fictional brands and domains only: the tracked brand is "Example Air" on
``example.com``, the competitor "Acme" on ``acme.example.org``.
"""

from __future__ import annotations

import json
import os
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

from shared.dataforseo_keyword_rows import null_metric
from shared.dataforseo_keywords import KeywordMetric, MonthlySearch
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_serp import OrganicItem
from testing.admin_authz_fixtures import caller_event
from testing.markets_fixtures import CHILE, markets_item

RUN_TS = '2026-10-02T08:00:00.000000Z'
OLDER_RUN_TS = '2026-09-25T08:00:00.000000Z'

OWNED_DOMAINS: tuple[str, ...] = ('example.com',)
COMPETITOR_DOMAINS: Mapping[str, Sequence[str]] = {'Acme': ('acme.example.org',)}
BRAND_CONFIG: Mapping[str, Any] = {'first_party_domains': ['example.com'], 'competitor_domains': {'Acme': ['acme.example.org']}}
"""The BrandConfig ``default`` item: the example brand's domains and its competitor's."""

SEO_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEO_KEYWORD_METRICS': 'test-seo-keyword-metrics',
    'DYNAMODB_TABLE_SEO_CACHE': 'test-seo-cache',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
    'SEO_BUCKET': 'test-seo',
    'CORS_ORIGIN_PARAM': '',
    'RANK_TRACKER_TARGET_ARN': 'arn:aws:lambda:us-east-1:123456789012:function:CitationAnalysis-SeoJobs',
    'RANK_TRACKER_SCHEDULER_ROLE_ARN': 'arn:aws:iam::123456789012:role/RankTrackerScheduler',
}
"""The variables the SEO stack sets on ``CitationAnalysis-SeoRouter``."""

GLOBAL_CODES = MarketCodes(location_code=2840, language_code='en', keyword_data='labs')
ADS_CODES = MarketCodes(location_code=2152, language_code='es', keyword_data='google_ads')

SEO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'seo')
"""``lambda/seo``, where the router and its sub-handlers live."""

def brand_config_stub(**default_item: Any) -> MagicMock:
    """The BrandConfig table: the ``markets`` item holds ``CHILE`` (``cl-es``), ``default`` holds ``default_item``."""
    items = {'markets': markets_item(CHILE), 'default': default_item}
    table = MagicMock()
    table.get_item.side_effect = lambda Key: {'Item': items[Key['config_id']]}
    return table


def seo_event(method: str, path: str, *, body: Any = None, query: Mapping[str, str] | None = None,
              groups: str | None = 'Users') -> dict[str, Any]:
    """An authenticated SEO API request (a ``Users`` member by default)."""
    return caller_event(method, path, groups=groups, body=body, query=query, resource=path)


def labs_price(rows: int, clickstream: bool = False) -> float:
    """``labs_usd`` as the Labs price table gives it, for suites that run against the pricing stub."""
    return (0.012 + 0.00012 * rows) * (2 if clickstream else 1)


def json_body(response: Mapping[str, Any]) -> dict[str, Any]:
    """The decoded body of a proxy response."""
    return json.loads(response['body'])


def _key_values(condition: Any) -> tuple[str, str]:
    """``(keyword, sort-key prefix)`` of a ``Key('keyword').eq(...) [& Key(...).begins_with(...)]`` condition."""
    expression = condition.get_expression()
    if expression['operator'] == 'AND':
        keyword, _prefix = _key_values(expression['values'][0])
        return keyword, expression['values'][1].get_expression()['values'][1]
    return expression['values'][1], ''


class FakeSearchResults:
    """``CitationAnalysis-SearchResults`` over ``rows``: key conditions, sort order and the AI Overviews filter."""

    def __init__(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self.rows = [dict(row) for row in rows]
        self.query = MagicMock(side_effect=self._query)

    def _query(self, **params: Any) -> dict[str, Any]:
        keyword, prefix = _key_values(params['KeyConditionExpression'])
        rows = sorted(
            (row for row in self.rows if row['keyword'] == keyword and row['timestamp_provider'].startswith(prefix)),
            key=lambda row: row['timestamp_provider'],
            reverse=not params.get('ScanIndexForward', True),
        )
        if 'FilterExpression' in params:
            rows = [row for row in rows if row['provider'] == 'google_ai_overview' and row['status'] in {'success', 'no_answer'}]
        return {'Items': rows}


def organic_result(position: int, url: str, *, domain: str | None = None) -> dict[str, Any]:
    """One entry of an AI Overviews row's ``search_results``, as DynamoDB returns it."""
    host = domain if domain is not None else url.split('/')[2]
    return {
        'url': url, 'title': f'Result {position}', 'snippet': '', 'position': Decimal(position),
        'domain': host, 'rank_absolute': Decimal(position + 1), 'source': 'google_ai_overview',
    }


def aio_row(
    *,
    status: str = 'success',
    citations: Sequence[str] = (),
    search_results: Sequence[Mapping[str, Any]] = (),
    timestamp: str = RUN_TS,
    keyword: str = 'cheap flights',
    brands: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """A Google AI Overviews SearchResults row."""
    return {
        'keyword': keyword, 'timestamp': timestamp, 'provider': 'google_ai_overview', 'provider_type': 'llm',
        'status': status, 'query_prompt_id': 'default', 'citations': list(citations),
        'search_results': [dict(result) for result in search_results], 'brands': [dict(brand) for brand in brands],
        'timestamp_provider': f'{timestamp}#google_ai_overview#default',
    }


def answer_row(
    provider: str,
    *,
    mentions_brand: bool,
    citations: Sequence[str] = (),
    timestamp: str = RUN_TS,
    keyword: str = 'cheap flights',
    status: str = 'success',
) -> dict[str, Any]:
    """An AI engine's SearchResults row; ``mentions_brand`` names "Example Air" first."""
    brands = [{'name': 'Example Air', 'classification': 'first_party', 'rank': Decimal(1)}] if mentions_brand else []
    return {
        'keyword': keyword, 'timestamp': timestamp, 'provider': provider, 'status': status,
        'query_prompt_id': 'default', 'citations': list(citations), 'brands': brands,
        'timestamp_provider': f'{timestamp}#{provider}#default',
    }


def keyword_item(keyword: str = 'cheap flights', *, keyword_id: str = 'kw-1', **extra: Any) -> dict[str, Any]:
    """An active Keywords row."""
    return {'id': keyword_id, 'keyword': keyword, 'status': 'active', **extra}


def keyword_metric(keyword: str = 'cheap flights', **overrides: Any) -> KeywordMetric:
    """A ``KeywordMetric`` with every metric set; ``overrides`` replace fields."""
    fields: dict[str, Any] = {
        'keyword': keyword,
        'search_volume': 1900,
        'monthly_searches': (MonthlySearch(year=2026, month=9, search_volume=2100),),
        'keyword_difficulty': 41,
        'cpc': 1.25,
        'competition': 0.5,
        'competition_level': 'MEDIUM',
        'intent': 'commercial',
        'source': 'labs',
    }
    fields.update(overrides)
    return KeywordMetric(**fields)


def empty_metric(keyword: str = 'cheap flights') -> KeywordMetric:
    """A ``KeywordMetric`` for a keyword the provider has no data for."""
    return null_metric(keyword, 'labs')


def organic_item(position: int, url: str, domain: str) -> OrganicItem:
    """One ``OrganicItem`` of an organic SERP."""
    return OrganicItem(
        position=position, rank_absolute=position, url=url, domain=domain, title=f'Result {position}', description='',
    )


class FakeMetricsTable:
    """``CitationAnalysis-SeoKeywordMetrics`` through ``batch_writer``: collects the put items, or raises ``error``."""

    def __init__(self, error: Exception | None = None) -> None:
        self.items: list[dict[str, Any]] = []
        self.error = error
        self.batch_writer_options: list[dict[str, Any]] = []

    @contextmanager
    def batch_writer(self, **options: Any) -> Generator[Any]:
        self.batch_writer_options.append(options)
        yield self

    def put_item(self, Item: dict[str, Any]) -> None:
        if self.error is not None:
            raise self.error
        self.items.append(Item)
