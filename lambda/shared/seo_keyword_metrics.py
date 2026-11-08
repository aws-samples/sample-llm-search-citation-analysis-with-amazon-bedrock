"""
The ``CitationAnalysis-SeoKeywordMetrics`` table: search metrics per keyword and market.

A cache of the latest values, not a measurement history: one row per ``(keyword_id, market_id)``; ``keyword_id`` is ``shared.utils.keyword_id``
of the keyword text, the id of every keyword created since keyword identities. Keywords
stored before that keep a random id, so readers join the two through
``load_keyword_metric_items``, which looks a keyword up under both. A refresh replaces the whole row: a metric the
provider no longer returns is written as an absent attribute, never left stale,
and an absent attribute reads back as ``null``.
Numbers are stored as ``Decimal``.

Two writers: ``POST /api/seo/keywords/metrics``,
and every fresh (national) keyword research, whose rows already carry the metrics
(``persist_research_rows``), so tracking a researched keyword needs no second paid call.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

from shared.dataforseo_keyword_rows import KeywordSourceName
from shared.dataforseo_keywords import KeywordMetric, KeywordRow
from shared.dynamodb_batch import batch_get_items
from shared.env_vars import resolve_table_env
from shared.utils import keyword_id, normalize_keyword

logger = logging.getLogger(__name__)

#: ``BatchGetItem`` takes at most 100 keys per call.
BATCH_GET_SIZE = 100

#: The key attributes; ``batch_writer`` drops a repeated key within one flush.
KEY_ATTRIBUTES = ('keyword_id', 'market_id')

#: The data sources a stored row can name (``KeywordMetric.source``).
SOURCES = ('labs', 'google_ads')


def metrics_table_name() -> str:
    """The table, from the required ``DYNAMODB_TABLE_SEO_KEYWORD_METRICS`` variable."""
    return resolve_table_env('DYNAMODB_TABLE_SEO_KEYWORD_METRICS')


def _decimal(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def metric_item(metric: KeywordMetric, market_id: str, fetched_at: str) -> dict[str, Any]:
    """The table row of ``metric`` in ``market_id``; metrics the provider did not return are left out."""
    item: dict[str, Any] = {
        'keyword_id': keyword_id(metric.keyword),
        'market_id': market_id,
        'keyword': metric.keyword,
        'monthly_searches': [
            {'year': month.year, 'month': month.month, 'search_volume': month.search_volume}
            for month in metric.monthly_searches
        ],
        'source': metric.source,
        'fetched_at': fetched_at,
    }
    optional: dict[str, Any] = {
        'search_volume': metric.search_volume,
        'keyword_difficulty': metric.keyword_difficulty,
        'cpc': _decimal(metric.cpc),
        'competition': _decimal(metric.competition),
        'competition_level': metric.competition_level,
        'intent': metric.intent,
    }
    item.update({name: value for name, value in optional.items() if value is not None})
    return item


def put_metric_items(table: Any, items: Iterable[Mapping[str, Any]]) -> None:
    """Upsert ``items``: ``batch_writer`` sends them 25 per ``BatchWriteItem`` and resends unprocessed ones."""
    with table.batch_writer(overwrite_by_pkeys=list(KEY_ATTRIBUTES)) as batch:
        for item in items:
            batch.put_item(Item=dict(item))


def research_metric(row: KeywordRow, source: KeywordSourceName) -> KeywordMetric:
    """The stored metric of one research row (``trend`` is the monthly series; research has no competition level)."""
    return KeywordMetric(
        keyword=row.keyword,
        search_volume=row.search_volume,
        monthly_searches=row.trend,
        keyword_difficulty=row.keyword_difficulty,
        cpc=row.cpc,
        competition=row.competition,
        competition_level=None,
        intent=row.intent,
        source=source,
    )


def persist_research_rows(
    table: Any, rows: Iterable[KeywordRow], market_id: str, source: KeywordSourceName, fetched_at: str,
) -> int:
    """Upsert the metrics of fresh research ``rows`` in batches; the number written (0 when the write failed).

    A failure is logged and never raised: the research answer was already paid for and must still be returned.
    """
    items = [
        metric_item(research_metric(row, source), market_id, fetched_at)
        for row in rows if normalize_keyword(row.keyword)
    ]
    if not items:
        return 0
    try:
        put_metric_items(table, items)
    except (ClientError, BotoCoreError) as exc:
        logger.warning('seo_keyword_metrics.research-persist-failed market_id=%s rows=%d error=%s',
                       market_id, len(items), type(exc).__name__)
        return 0
    return len(items)


def _int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)):
        return None
    return int(value)


def _float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    return float(value)


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _months(value: object) -> list[dict[str, int]]:
    entries = value if isinstance(value, list) else []
    months: list[dict[str, int]] = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        year, month, volume = (_int(entry.get(name)) for name in ('year', 'month', 'search_volume'))
        if year is not None and month is not None and volume is not None:
            months.append({'year': year, 'month': month, 'search_volume': volume})
    return months


def metric_json(item: Mapping[str, object]) -> dict[str, Any]:
    """The API form (``KeywordMetric``) of a stored row; an absent metric is ``None``."""
    source = item.get('source')
    return {
        'keyword_id': str(item.get('keyword_id') or ''),
        'keyword': str(item.get('keyword') or ''),
        'market_id': str(item.get('market_id') or ''),
        'search_volume': _int(item.get('search_volume')),
        'monthly_searches': _months(item.get('monthly_searches')),
        'keyword_difficulty': _int(item.get('keyword_difficulty')),
        'cpc': _float(item.get('cpc')),
        'competition': _float(item.get('competition')),
        'competition_level': _text(item.get('competition_level')),
        'intent': _text(item.get('intent')),
        'source': source if source in SOURCES else 'labs',
        'fetched_at': str(item.get('fetched_at') or ''),
    }


def load_metric_items(
    resource: Any, table_name: str, keyword_ids: Sequence[str], market_id: str,
) -> list[dict[str, Any]]:
    """The stored rows of ``keyword_ids`` in ``market_id``, in request order; ids without a row are absent.

    One ``BatchGetItem`` per 100 distinct ids; no provider call.
    """
    distinct = list(dict.fromkeys(keyword_ids))
    found: dict[str, dict[str, Any]] = {}
    for start in range(0, len(distinct), BATCH_GET_SIZE):
        keys = [{'keyword_id': key, 'market_id': market_id} for key in distinct[start:start + BATCH_GET_SIZE]]
        for item in batch_get_items(resource, table_name, keys):
            found[str(item.get('keyword_id'))] = item
    return [found[key] for key in distinct if key in found]


def load_keyword_metric_items(
    resource: Any, table_name: str, keywords: Sequence[Mapping[str, Any]], market_id: str,
) -> dict[str, dict[str, Any]]:
    """The stored row of each Keywords-table item in ``market_id``, by the item's ``id``; items without a row are absent.

    A row is keyed by ``keyword_id`` of the keyword text, which is the ``id`` of every keyword created since keyword
    identities; keywords stored before that keep a random id, so each item is looked up under both (its text id
    first). No provider call.
    """
    lookup: dict[str, str] = {}
    for item in keywords:
        stored = str(item.get('id') or '')
        if not stored:
            continue
        text = item.get('keyword')
        if isinstance(text, str) and normalize_keyword(text):
            lookup.setdefault(keyword_id(text), stored)
        lookup.setdefault(stored, stored)
    found: dict[str, dict[str, Any]] = {}
    for row in load_metric_items(resource, table_name, list(lookup), market_id):
        stored = lookup.get(str(row.get('keyword_id')))
        if stored is not None:
            found.setdefault(stored, row)
    return found
