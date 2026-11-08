"""Estimated organic traffic snapshots of a domain in a market (``CitationAnalysis-SeoDomainSnapshots``).

One snapshot = the DataForSEO Labs overview of the domain (organic keywords, estimated traffic and its ads
value, keywords per position bucket) plus its top ``SNAPSHOT_KEYWORD_LIMIT`` ranked keywords by estimated
traffic. Every figure is a DataForSEO *estimate* from search volume and click-through curves, never
measured clicks.

* Item: ``pk = <domain>#<market_id>``, ``snapshot_at`` (ISO-8601 UTC), the summary figures, and
  ``keywords_s3_key`` pointing at the ranked keywords (``seo/domain-snapshots/<domain>/<market>/<at>.json``
  in the raw-responses bucket: a page of 1,000 keywords does not fit a 400 KB item). Snapshots never expire:
  measured history is kept like every other record (TENETS.md, D2 and D5).
* Stored keyword: ``keyword``, ``position`` (organic rank, ``rank_group``, 1-100), ``etv``, ``url``,
  ``search_volume``.
* The weekly sweep over every owned and competitor domain is paid, so it is off until an Admin turns it on:
  the setting is the item ``pk='#settings'``, ``snapshot_at='schedule'`` (``#`` never starts a domain), the same
  way the backlink snapshots keep theirs. An Admin's one-off snapshot runs whatever the setting.
* An empty answer (no keyword, no traffic) is not stored when the previous snapshot of the pair had data:
  DataForSEO occasionally answers a known domain with nothing, and a stored empty snapshot would read as
  "all traffic lost" in every comparison. A pair with no history keeps its empty first snapshot, so it shows
  as "no estimated traffic" rather than "never measured".
"""

from __future__ import annotations

import functools
import json
import logging
import os
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from shared import snapshot_schedule
from shared.bounded_reads import newest_items
from shared.dataforseo_domain import DomainOverview, RankedKeyword, domain_overview, ranked_keywords
from shared.dataforseo_domain_scope import ResearchTarget
from shared.dataforseo_locations import MarketCodes
from shared.utils import normalize_keyword

logger = logging.getLogger(__name__)

TABLE_ENV = 'DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS'
BUCKET_ENV = 'RAW_RESPONSES_BUCKET'
S3_PREFIX = 'seo/domain-snapshots'
#: The most rows one Labs ``ranked_keywords`` call returns.
SNAPSHOT_KEYWORD_LIMIT = 1000
#: Positions deeper than this are not reported by Labs ranked keywords.
MAX_POSITION = 100
#: Jobs run outside the API's 29 s window; a 1,000-row Labs answer can take tens of seconds.
SNAPSHOT_TIMEOUT_S = 120.0
SOURCE = 'dataforseo_labs'

KeywordTraffic = tuple[int | None, float | None]
"""``(position, etv)`` of one keyword in a snapshot."""


def table_name() -> str:
    return os.environ[TABLE_ENV]


def snapshot_pk(domain: str, market_id: str) -> str:
    return f'{domain}#{market_id}'


def snapshot_s3_key(domain: str, market_id: str, snapshot_at: str) -> str:
    return f'{S3_PREFIX}/{domain}/{market_id}/{snapshot_at}.json'


def _decimal(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def _position(value: int | None) -> int | None:
    return value if value is not None and 1 <= value <= MAX_POSITION else None


def snapshot_keyword(row: RankedKeyword) -> dict[str, Any]:
    """The stored form of one ranked keyword (organic position, ``None`` beyond 100)."""
    return {
        'keyword': row.keyword,
        'position': _position(row.organic_position),
        'etv': row.etv,
        'url': row.url,
        'search_volume': row.search_volume,
    }


def snapshot_item(
    domain: str, market_id: str, snapshot_at: str, overview: DomainOverview, keyword_count: int,
) -> dict[str, Any]:
    """The DynamoDB item of one snapshot."""
    return {
        'pk': snapshot_pk(domain, market_id),
        'snapshot_at': snapshot_at,
        'domain': domain,
        'market_id': market_id,
        'source': SOURCE,
        'organic_keywords': overview.organic_keywords,
        'estimated_traffic': overview.estimated_traffic,
        'traffic_cost': _decimal(overview.traffic_cost),
        'position_buckets': dict(overview.position_buckets),
        'keywords_stored': keyword_count,
        'keywords_s3_key': snapshot_s3_key(domain, market_id, snapshot_at),
    }


def _float(value: object) -> float | None:
    """A stored number (DynamoDB answers ``Decimal``) as ``float``; ``None`` for anything else."""
    return None if isinstance(value, bool) or not isinstance(value, int | float | Decimal) else float(value)


def _int(value: object) -> int | None:
    number = _float(value)
    return None if number is None else int(number)


def summary_json(item: Mapping[str, Any]) -> dict[str, Any]:
    """The API form of a stored snapshot (no keyword list)."""
    buckets = item.get('position_buckets')
    return {
        'domain': str(item.get('domain') or ''),
        'market_id': str(item.get('market_id') or ''),
        'snapshot_at': str(item.get('snapshot_at') or ''),
        'organic_keywords': _int(item.get('organic_keywords')),
        'estimated_traffic': _int(item.get('estimated_traffic')),
        'traffic_cost': _float(item.get('traffic_cost')),
        'position_buckets': [
            {'label': str(label), 'keywords': _int(count) or 0}
            for label, count in (buckets.items() if isinstance(buckets, Mapping) else [])
        ],
        'keywords_stored': _int(item.get('keywords_stored')) or 0,
    }


def _has_data(item: Mapping[str, Any] | None) -> bool:
    return item is not None and bool(_int(item.get('organic_keywords')) or _int(item.get('keywords_stored')))


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def list_snapshots(table: Any, domain: str, market_id: str, limit: int = 60) -> list[dict[str, Any]]:
    """The pair's newest ``limit`` snapshot items, newest first."""
    return newest_items(table, 'pk', snapshot_pk(domain, market_id), limit)


def latest_snapshot(table: Any, domain: str, market_id: str) -> dict[str, Any] | None:
    """The pair's newest snapshot item, ``None`` before the first."""
    items = list_snapshots(table, domain, market_id, limit=1)
    return items[0] if items else None


def load_snapshot_keywords(s3: Any, bucket: str, item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The stored ranked keywords of a snapshot item; ``[]`` when the object is missing or unreadable."""
    key = item.get('keywords_s3_key')
    if not isinstance(key, str) or not key:
        return []
    try:
        body = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
        keywords = json.loads(body).get('keywords')
    except Exception:
        logger.exception('domain snapshot keywords unreadable')
        return []
    return [entry for entry in keywords if isinstance(entry, Mapping)] if isinstance(keywords, list) else []


def keyword_traffic(keywords: Iterable[Mapping[str, Any]]) -> dict[str, KeywordTraffic]:
    """``normalize_keyword(text) -> (position, etv)``; Labs lists a keyword once, so a repeat keeps the first."""
    traffic: dict[str, KeywordTraffic] = {}
    for entry in keywords:
        text = entry.get('keyword')
        key = normalize_keyword(text) if isinstance(text, str) else ''
        if key and key not in traffic:
            traffic[key] = (_position(_int(entry.get('position'))), _float(entry.get('etv')))
    return traffic


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def take_snapshot(
    domain: str, market_id: str, codes: MarketCodes, *, table: Any, s3: Any, bucket: str, now: datetime | None = None,
) -> dict[str, Any]:
    """Fetch and store one snapshot of ``domain`` (and its subdomains) in one market.

    Two billed Labs calls, each sent once. Returns ``{status, keywords}``: ``stored``, or ``kept_previous``
    when the answer was empty and the previous snapshot had data (nothing written).
    """
    moment = now or datetime.now(UTC)
    overview = domain_overview(domain, codes, timeout_s=SNAPSHOT_TIMEOUT_S)
    page = ranked_keywords(
        ResearchTarget(scope='subdomains', hostname=domain, path=''), codes, limit=SNAPSHOT_KEYWORD_LIMIT,
        sort='traffic', order='desc', timeout_s=SNAPSHOT_TIMEOUT_S,
    )
    if not overview.has_data and not page.items and _has_data(latest_snapshot(table, domain, market_id)):
        logger.warning('domain snapshot answer was empty; previous snapshot kept')
        return {'status': 'kept_previous', 'keywords': 0}
    snapshot_at = moment.strftime('%Y-%m-%dT%H:%M:%SZ')
    keywords = [snapshot_keyword(row) for row in page.items]
    s3.put_object(
        Bucket=bucket, Key=snapshot_s3_key(domain, market_id, snapshot_at), ContentType='application/json',
        Body=json.dumps({
            'domain': domain, 'market_id': market_id, 'snapshot_at': snapshot_at, 'source': SOURCE,
            'estimated': True, 'keywords': keywords,
        }).encode('utf-8'),
    )
    table.put_item(Item=snapshot_item(domain, market_id, snapshot_at, overview, len(keywords)))
    return {'status': 'stored', 'keywords': len(keywords)}


#: The weekly sweep's setting (``#`` never starts a domain, so no snapshot uses this key).
SCHEDULE_KEY = {'pk': '#settings', 'snapshot_at': 'schedule'}


#: ``schedule_enabled(table)``: whether an Admin turned the weekly sweep on (off when never set).
schedule_enabled = functools.partial(snapshot_schedule.schedule_enabled, key=SCHEDULE_KEY)
#: ``set_schedule(table, enabled=, updated_by=, updated_at=)``: record an Admin's choice.
set_schedule = functools.partial(snapshot_schedule.set_schedule, key=SCHEDULE_KEY)


def distinct_domains(domains: Sequence[str]) -> list[str]:
    """``domains`` without the ones another entry already covers as a subdomain (a snapshot rolls them up)."""
    unique = sorted(set(domains))
    return [domain for domain in unique if not any(domain.endswith(f'.{other}') for other in unique if other != domain)]


__all__ = [
    'BUCKET_ENV',
    'SNAPSHOT_KEYWORD_LIMIT',
    'TABLE_ENV',
    'KeywordTraffic',
    'distinct_domains',
    'keyword_traffic',
    'latest_snapshot',
    'list_snapshots',
    'load_snapshot_keywords',
    'schedule_enabled',
    'set_schedule',
    'snapshot_item',
    'snapshot_s3_key',
    'summary_json',
    'table_name',
    'take_snapshot',
]
