"""The data behind SEO vs GEO (``GET /api/seo/seo-geo``) and the SEO recommendations (``GET /api/seo/insights``).

Reads, never calls DataForSEO; the rules are ``shared.seo_geo`` / ``shared.seo_geo_traffic``:

* the keywords: the market's active keywords (``global`` when absent) and, with ``group_id``, that group's
  (at most ``MAX_KEYWORDS``, in keyword order);
* per keyword, its newest analysis run with a Google AI Overviews row (SearchResults, newest sort keys first,
  at most ``MAX_RUN_LOOKUP_PAGES`` pages) and every row of that run; its search volume from the SEO keyword
  metrics table;
* the latest domain snapshot (``CitationAnalysis-SeoDomainSnapshots``) of every owned and competitor domain
  in the market, with its ranked keywords from S3. A snapshot that cannot be read counts as missing, so the
  table still answers without estimated traffic.

Shipped next to the sub-handlers (the SEO router's asset), imported as ``seo_geo_data``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError
from seo_http import MARKET_ID_FIELD, brand_config, dynamodb_table, resolve_market

from shared.answer_queries import query_keyword_run_rows
from shared.domain_snapshots import (
    BUCKET_ENV,
    TABLE_ENV,
    distinct_domains,
    keyword_traffic,
    latest_snapshot,
    load_snapshot_keywords,
)
from shared.env_vars import resolve_table_env
from shared.insights_citations import competitor_domains_from
from shared.keyword_groups import resolve_scope
from shared.kpi_engine import ANSWER_PROJECTION, owned_domains_from
from shared.seo_geo import AIO_DATA_STATUSES, AIO_PROVIDER, latest_aio_run, summarize, thresholds
from shared.seo_geo_traffic import SearchTraffic, merge_traffic, seo_geo_rows, traffic_comparison
from shared.seo_keyword_metrics import load_keyword_metric_items, metric_json, metrics_table_name
from shared.utils import get_timestamp

_log = logging.getLogger(__name__)

MAX_KEYWORDS = 500
#: Pages of a keyword's newest SearchResults rows read while looking for its latest AI Overviews row.
MAX_RUN_LOOKUP_PAGES = 5
RUN_LOOKUP_PAGE_SIZE = 100
MAX_WORKERS = 10

RUN_PROJECTION = f'{ANSWER_PROJECTION}, search_results'

#: ``@validate`` schema of the two scope query parameters every SEO vs GEO read takes.
SCOPE_QUERY_SCHEMA: dict[str, dict[str, Any]] = {
    'market_id': {**MARKET_ID_FIELD, 'source': 'query'},
    'group_id': {'type': str, 'max_length': 64, 'source': 'query'},
}


@dataclass(frozen=True)
class Sources:
    """The tables and buckets SEO vs GEO reads, opened once per container."""

    keywords: Any
    search_results: Any
    snapshots: Any
    dynamodb: Any
    s3: Any
    bucket: str


@cache
def sources() -> Sources:
    """The live sources (tests replace this function)."""
    return Sources(
        keywords=dynamodb_table('DYNAMODB_TABLE_KEYWORDS'),
        search_results=dynamodb_table('DYNAMODB_TABLE_SEARCH_RESULTS'),
        snapshots=boto3.resource('dynamodb').Table(resolve_table_env(TABLE_ENV)),
        dynamodb=boto3.resource('dynamodb'),
        s3=boto3.client('s3'),
        bucket=os.environ[BUCKET_ENV],
    )


# ---------------------------------------------------------------------------
# Keywords and runs
# ---------------------------------------------------------------------------

def latest_aio_timestamp(keyword: str) -> str | None:
    """The timestamp of the keyword's newest AI Overviews row with data, or ``None`` within the page budget."""
    params: dict[str, Any] = {
        'KeyConditionExpression': Key('keyword').eq(keyword),
        'FilterExpression': Attr('provider').eq(AIO_PROVIDER) & Attr('status').is_in(sorted(AIO_DATA_STATUSES)),
        'ProjectionExpression': '#ts',
        'ExpressionAttributeNames': {'#ts': 'timestamp'},
        'ScanIndexForward': False,
        'Limit': RUN_LOOKUP_PAGE_SIZE,
    }
    for _page in range(MAX_RUN_LOOKUP_PAGES):
        response = sources().search_results.query(**params)
        items = response.get('Items', [])
        if items:
            return str(items[0].get('timestamp') or '') or None
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return None
        params['ExclusiveStartKey'] = last_key
    return None


def run_rows(keyword: str) -> Sequence[Mapping[str, Any]]:
    """Every row of the keyword's latest run with an AI Overviews row (``[]`` without one)."""
    timestamp = latest_aio_timestamp(keyword)
    if timestamp is None:
        return []
    rows = query_keyword_run_rows(sources().search_results, keyword, timestamp, projection=RUN_PROJECTION)
    return latest_aio_run(rows)[1]


def scoped_keywords(market_id: str, group_id: str | None) -> list[dict[str, Any]]:
    """The active keywords of the market (and group), at most ``MAX_KEYWORDS``."""
    scope: dict[str, Any] = {'mode': 'groups', 'group_ids': [group_id]} if group_id else {'mode': 'all'}
    keywords = resolve_scope({**scope, 'market_ids': [market_id]}, sources().keywords)
    if len(keywords) > MAX_KEYWORDS:
        _log.warning('SEO vs GEO reads the first %d of %d keywords', MAX_KEYWORDS, len(keywords))
    return keywords[:MAX_KEYWORDS]


def search_volumes(keywords: Sequence[Mapping[str, Any]], market_id: str) -> dict[str, int | None]:
    """Each keyword's stored search volume, by the keyword's id in the Keywords table."""
    rows = load_keyword_metric_items(sources().dynamodb, metrics_table_name(), keywords, market_id)
    return {stored: metric_json(row)['search_volume'] for stored, row in rows.items()}


# ---------------------------------------------------------------------------
# Domain snapshots
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DomainKeywords:
    snapshot_at: str
    traffic: Mapping[str, tuple[int | None, float | None]]


def domain_keywords(domain: str, market_id: str) -> DomainKeywords | None:
    """The latest snapshot's keywords of one domain in the market; ``None`` without a readable snapshot."""
    store = sources()
    try:
        item = latest_snapshot(store.snapshots, domain, market_id)
    except ClientError:
        _log.exception('domain snapshot lookup failed')
        return None
    if item is None:
        return None
    keywords = load_snapshot_keywords(store.s3, store.bucket, item)
    return DomainKeywords(snapshot_at=str(item.get('snapshot_at') or ''), traffic=keyword_traffic(keywords))


def _merged(domains: Sequence[str], found: Mapping[str, DomainKeywords | None]) -> dict[str, Any] | None:
    snapshots = [snapshot for domain in domains if (snapshot := found.get(domain)) is not None]
    return merge_traffic(snapshot.traffic for snapshot in snapshots) if snapshots else None


def search_traffic(
    market_id: str, owned: Sequence[str], competitors: Mapping[str, Sequence[str]],
) -> tuple[SearchTraffic, str | None]:
    """The market's snapshot traffic of you and each competitor, and the newest owned snapshot's time."""
    owned_domains = distinct_domains(owned)
    competitor_domains = {name: distinct_domains(domains) for name, domains in competitors.items()}
    every = sorted({*owned_domains, *(domain for domains in competitor_domains.values() for domain in domains)})
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        found = dict(zip(every, pool.map(lambda domain: domain_keywords(domain, market_id), every), strict=True))
    competitor_traffic = {
        name: merged for name, domains in competitor_domains.items() if (merged := _merged(domains, found)) is not None
    }
    stamps = [snapshot.snapshot_at for domain in owned_domains if (snapshot := found.get(domain)) is not None]
    return SearchTraffic(owned=_merged(owned_domains, found), competitors=competitor_traffic), max(stamps, default=None)


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SeoGeoData:
    market_id: str
    group_id: str | None
    rows: list[dict[str, Any]]
    traffic_comparison: list[dict[str, Any]]
    traffic_snapshot_at: str | None


def load_seo_geo(market_id: str | None, group_id: str | None) -> SeoGeoData:
    """Every SEO vs GEO row and the traffic comparison of a market (and keyword group)."""
    resolved_id, _market = resolve_market(market_id)
    keywords = scoped_keywords(resolved_id, group_id or None)
    config = brand_config()
    owned, competitors = owned_domains_from(config), competitor_domains_from(config)
    volumes = search_volumes(keywords, resolved_id)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        runs = list(pool.map(run_rows, [str(item['keyword']) for item in keywords]))
    traffic, snapshot_at = search_traffic(resolved_id, owned, competitors)
    rows = seo_geo_rows(
        keywords, runs, owned_domains=owned, competitor_domains=competitors, volumes=volumes, traffic=traffic,
    )
    return SeoGeoData(
        market_id=resolved_id,
        group_id=group_id or None,
        rows=rows,
        traffic_comparison=traffic_comparison(keywords, runs, traffic, list(competitors)),
        traffic_snapshot_at=snapshot_at,
    )


def seo_geo_payload(data: SeoGeoData) -> dict[str, Any]:
    """The ``GET /api/seo/seo-geo`` body."""
    return {
        'market_id': data.market_id,
        'group_id': data.group_id,
        'generated_at': get_timestamp(),
        'thresholds': thresholds(),
        'summary': summarize(data.rows),
        'rows': data.rows,
        'traffic_comparison': data.traffic_comparison,
        'traffic_snapshot_at': data.traffic_snapshot_at,
    }
