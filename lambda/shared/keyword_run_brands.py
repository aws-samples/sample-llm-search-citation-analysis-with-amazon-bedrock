"""
The ``CitationAnalysis-KeywordRunBrands`` table: every brand of a keyword run whose KeywordRunKpis row is capped.

A KeywordRunKpis row keeps ``BRANDS_PER_RUN`` brands (first-party and tracked
ones always), so windows read small rows. When a run names more
(``brands_total > BRANDS_PER_RUN``), the same writer puts the complete brand
list here; readers that need an exact long tail (the scope series when a
member is added, a trend leaderboard the certificate could not prove) read
it beside the capped row. Runs that name at most ``BRANDS_PER_RUN`` brands
have no row here: their KeywordRunKpis row is already complete.

PK ``keyword``, SK ``run_timestamp`` (as KeywordRunKpis). Attributes: ``v``,
``brands`` (``shared.keyword_run_kpis.encode_brands``), ``brands_total`` and
``built_at``. A separate table, not a sibling sort key in KeywordRunKpis: a
``b#...`` sort key would sort after the run timestamps and break that table's
newest-first queries.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.keyword_run_kpis import BRANDS_PER_RUN, FORMAT_VERSION, decode_brands, encode_brands
from shared.kpi_tally import BrandTally, RunTally
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

def keyword_run_brands_table(resource: Any) -> Any | None:
    """The table (``DYNAMODB_TABLE_KEYWORD_RUN_BRANDS``) through ``resource``, or ``None`` where it is not deployed."""
    name = resolve_table_env('DYNAMODB_TABLE_KEYWORD_RUN_BRANDS', required=False)
    return None if name is None else resource.Table(name)


def needs_brand_row(full: RunTally) -> bool:
    """Whether the KeywordRunKpis row of this run drops brands, so the complete list needs a row here."""
    return full.brands_total > BRANDS_PER_RUN


def brands_item(full: RunTally, built_at: str | None = None) -> dict[str, Any]:
    """The table row of ``full``'s brands (``full`` tallied without a brand cap)."""
    return {
        'keyword': full.keyword,
        'run_timestamp': full.timestamp,
        'v': FORMAT_VERSION,
        'brands': encode_brands(full),
        'brands_total': full.brands_total,
        'built_at': built_at or get_timestamp(),
    }


def put_run_brands(table: Any, full: RunTally) -> bool:
    """Write ``full``'s brand row when its KeywordRunKpis row is capped; whether a row was written."""
    if not needs_brand_row(full):
        return False
    table.put_item(Item=brands_item(full))
    return True


def brands_from_item(item: Mapping[str, Any]) -> tuple[BrandTally, ...] | None:
    """The brands a row holds; ``None`` for another format or a malformed row (logged)."""
    if int(item.get('v') or 0) != FORMAT_VERSION:
        return None
    try:
        return decode_brands(json.loads(str(item['brands'])))
    except (KeyError, TypeError, ValueError, IndexError, AttributeError):
        logger.warning('Ignoring a malformed KeywordRunBrands row of %r at %r', item.get('keyword'), item.get('run_timestamp'))
        return None


def query_run_brands(table: Any, keyword: str, since: str, until: str | None = None) -> dict[str, tuple[BrandTally, ...]]:
    """``keyword``'s complete brand lists of the runs from ``since`` through ``until``, by run timestamp."""
    sort_key = Key('run_timestamp')
    condition = Key('keyword').eq(keyword) & (sort_key.gte(since) if until is None else sort_key.between(since, until))
    items = collect_all_items(
        table.query, KeyConditionExpression=condition,
        ProjectionExpression='#rt, #v, brands', ExpressionAttributeNames={'#rt': 'run_timestamp', '#v': 'v'},
    )
    runs: dict[str, tuple[BrandTally, ...]] = {}
    for item in items:
        brands = brands_from_item(item)
        if brands is not None:
            runs[str(item['run_timestamp'])] = brands
    return runs


def with_all_brands(tally: RunTally, brands_by_run: Mapping[str, tuple[BrandTally, ...]]) -> RunTally:
    """``tally`` (a capped KeywordRunKpis row) with every brand of its run, when the run has a brand row."""
    brands = brands_by_run.get(tally.timestamp)
    return tally if brands is None else replace(tally, brands=brands)


__all__ = [
    'brands_from_item',
    'brands_item',
    'keyword_run_brands_table',
    'needs_brand_row',
    'put_run_brands',
    'query_run_brands',
    'with_all_brands',
]
