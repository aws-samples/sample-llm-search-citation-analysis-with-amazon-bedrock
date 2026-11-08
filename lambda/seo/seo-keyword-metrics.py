"""
SEO keyword metrics API (response shapes in ``web/src/types/api/seo.ts``):

- POST /api/seo/keywords/metrics        - fetch metrics for up to 700 keywords from DataForSEO and store them
- POST /api/seo/keywords/metrics/lookup - the stored metrics of up to 500 keyword ids (no DataForSEO call); an id is
  the Keywords table's, and a keyword stored before keyword identities is found through its text

Every requested keyword gets a stored row, its unknown metrics written as absent attributes, so a refresh never
leaves stale numbers behind. Rows are keyed ``(keyword_id, market_id)`` with the
Keywords-table identity (``shared.utils.keyword_id``).
"""

import sys
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3
from seo_http import MARKET_ID_FIELD, body_list, keyword_id_list, keyword_list, resolve_market, seo_route

from shared.api_response import success_response
from shared.dataforseo_keywords import keyword_metrics
from shared.dataforseo_locations import market_codes
from shared.decorators import json_object_body, validate
from shared.dynamodb_batch import batch_get_items
from shared.env_vars import resolve_table_env
from shared.seo_keyword_metrics import (
    BATCH_GET_SIZE,
    load_keyword_metric_items,
    metric_item,
    metric_json,
    metrics_table_name,
    put_metric_items,
)
from shared.utils import get_timestamp, normalize_keyword

dynamodb = boto3.resource('dynamodb')
METRICS_TABLE_NAME = metrics_table_name()
KEYWORDS_TABLE_NAME = resolve_table_env('DYNAMODB_TABLE_KEYWORDS')
metrics_table = dynamodb.Table(METRICS_TABLE_NAME)

#: DataForSEO's per-task keyword cap (``keyword_overview`` / ``search_volume`` batches of 700).
MAX_METRIC_KEYWORDS = 700
MAX_LOOKUP_IDS = 500

MARKET_SCHEMA: dict[str, dict[str, Any]] = {'market_id': MARKET_ID_FIELD}


def metrics_response(market_id: str, items: list[dict[str, Any]], event: dict[str, Any]) -> dict[str, Any]:
    return success_response({'market_id': market_id, 'metrics': [metric_json(item) for item in items]}, event)


@json_object_body
@body_list('keywords', keyword_list, MAX_METRIC_KEYWORDS)
@validate(MARKET_SCHEMA)
def handle_metrics(event: dict[str, Any], _context: Any, *, keywords: list[str], market_id: str | None,
                   **_request: Any) -> dict[str, Any]:
    """POST /api/seo/keywords/metrics - fetch, store and answer the metrics of the requested keywords."""
    resolved_id, market = resolve_market(market_id)
    metrics, _cost_usd = keyword_metrics(keywords, market_codes(market))
    fetched_at = get_timestamp()
    items = [metric_item(metric, resolved_id, fetched_at) for metric in metrics if normalize_keyword(metric.keyword)]
    put_metric_items(metrics_table, items)
    return metrics_response(resolved_id, items, event)


def stored_keywords(keyword_ids: list[str]) -> list[dict[str, Any]]:
    """Each requested id as its Keywords-table item (its text included), or as a bare id when no keyword has it."""
    distinct = list(dict.fromkeys(keyword_ids))
    known: dict[str, dict[str, Any]] = {}
    for start in range(0, len(distinct), BATCH_GET_SIZE):
        keys = [{'id': key} for key in distinct[start:start + BATCH_GET_SIZE]]
        known.update({str(item.get('id')): item for item in batch_get_items(dynamodb, KEYWORDS_TABLE_NAME, keys)})
    return [known.get(key, {'id': key}) for key in distinct]


@json_object_body
@body_list('keyword_ids', keyword_id_list, MAX_LOOKUP_IDS)
@validate(MARKET_SCHEMA)
def handle_lookup(event: dict[str, Any], _context: Any, *, keyword_ids: list[str], market_id: str | None,
                  **_request: Any) -> dict[str, Any]:
    """POST /api/seo/keywords/metrics/lookup - the stored metrics of the requested keyword ids."""
    stored_market = resolve_market(market_id)[0]
    keywords = stored_keywords(keyword_ids)
    rows = load_keyword_metric_items(dynamodb, METRICS_TABLE_NAME, keywords, stored_market)
    items = [{**rows[key], 'keyword_id': key} for key in dict.fromkeys(keyword_ids) if key in rows]
    return metrics_response(stored_market, items, event)


handler = seo_route({
    # Before `/metrics`, which also matches `/metrics/lookup` as an interior segment.
    ('POST', '/metrics/lookup'): handle_lookup,
    ('POST', '/metrics'): handle_metrics,
})
