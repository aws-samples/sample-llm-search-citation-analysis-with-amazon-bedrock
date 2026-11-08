"""
The ``CitationAnalysis-KeywordRunKpis`` table: one ``shared.kpi_tally.RunTally`` per (keyword, run).

A history window used to re-read every answer of every run (O(answers)); it
now reads one small row per keyword run (O(keywords x runs)) and sums them.
PK ``keyword``, SK ``run_timestamp`` (the SearchResults ``timestamp`` of the
run). No TTL: SearchResults keeps every run, so its rollups stay too.

Attributes (the counts are JSON strings: one attribute deserializes in C
instead of a few hundred DynamoDB numbers in Python):

- ``v``: ``FORMAT_VERSION``; a row of another version is ignored (its run is read raw).
- ``answers``: the run's answers, so a run without any is skipped cheaply.
- ``owned``: ``owned_fingerprint`` of the owned domains the citation counts used.
- ``engines``: ``{provider: [counts (COUNT_FIELDS), models]}``.
- ``brands``: ``{"p": [provider, ...], "b": [[key, name, classification,
  mentions, points, rank_sum, rank_count, best_rank, [positive, neutral,
  negative, mixed], engines], ...]}``: ``BrandTally``'s fields in order, the
  classification as its index in ``_CLASSES`` and the engines as a bit mask
  over ``p``,
  at most ``BRANDS_PER_RUN`` (first-party and tracked brands always kept);
  ``brands_total`` counts every brand named.
- ``built_at``: when the row was written.

Size: ``BRANDS_PER_RUN`` brands of ~90 bytes plus ~100 bytes per engine is
~3 KB, far under DynamoDB's 400 KB item limit whatever the answer count. The
cap is set by what a window reads, not by the item limit: a 365-day window of
100 keywords is 36,500 rows, ~110 MB at the cap.

Writers: the Deduplication Lambda when a keyword's run completes
(``record_run_kpis``) and its backfill action (``keyword_run_kpis_backfill``).
Readers: the windowed reports (``shared.scoped_reports.load_window_runs``).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.answer_queries import query_keyword_run_rows
from shared.brand_names import COMPETITOR, FIRST_PARTY
from shared.emf_metrics import emit_count
from shared.env_vars import resolve_table_env
from shared.kpi_engine import OTHER, Answer, answers_from_rows, owned_domains_from
from shared.kpi_tally import COUNT_FIELDS, BrandTally, RunTally, run_tally
from shared.request_deadline import Deadline
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

FORMAT_VERSION = 1

#: Brands one row keeps at most (``shared.kpi_tally`` ``brand_cap``): bounds the row and, above all, what a window reads.
BRANDS_PER_RUN = 25

#: The attributes every reader needs; ``brands`` is added for the views that list brands.
_BASE_PROJECTION = '#kw, #rt, #v, answers, #ow, engines'
_ATTRIBUTE_NAMES = {'#kw': 'keyword', '#rt': 'run_timestamp', '#v': 'v', '#ow': 'owned'}

_BRAND_FIELDS = len(BrandTally._fields)
#: A brand's classification is stored as its index here.
_CLASSES = (FIRST_PARTY, COMPETITOR, OTHER)


def keyword_run_kpis_table_name() -> str | None:
    """The table's name (``DYNAMODB_TABLE_KEYWORD_RUN_KPIS``); ``None`` where it is not deployed, and every window is read raw."""
    return resolve_table_env('DYNAMODB_TABLE_KEYWORD_RUN_KPIS', required=False)


def keyword_run_kpis_table(resource: Any) -> Any | None:
    """The table through ``resource`` (a boto3 DynamoDB resource), or ``None`` where it is not deployed."""
    name = keyword_run_kpis_table_name()
    return None if name is None else resource.Table(name)


def tracked_brand_names(brand_config: Mapping[str, Any]) -> list[str]:
    """The competitor names the brand configuration tracks (``tracked_brands.competitors``): always kept in a row."""
    tracked = brand_config.get('tracked_brands')
    names = tracked.get('competitors') if isinstance(tracked, Mapping) else None
    return [name for name in names if isinstance(name, str)] if isinstance(names, list) else []


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

def encode_brands(tally: RunTally) -> str:
    """The ``brands`` attribute of ``tally``: its brands in the compact layout above, as JSON."""
    providers = list(tally.engines)
    brands = {
        'p': providers,
        'b': [
            [brand.key, brand.name, _CLASSES.index(brand.classification), *brand[3:8], list(brand.split),
             sum(1 << providers.index(engine) for engine in brand.engines if engine in providers)]
            for brand in tally.brands
        ],
    }
    return json.dumps(brands, ensure_ascii=False, separators=(',', ':'))


def tally_item(tally: RunTally, built_at: str | None = None) -> dict[str, Any]:
    """The table row of ``tally``."""
    engines = {provider: [list(counts), list(tally.models.get(provider, ()))] for provider, counts in tally.engines.items()}
    return {
        'keyword': tally.keyword,
        'run_timestamp': tally.timestamp,
        'v': FORMAT_VERSION,
        'answers': tally.answers,
        'owned': tally.owned,
        'engines': json.dumps(engines, separators=(',', ':')),
        'brands': encode_brands(tally),
        'brands_total': tally.brands_total,
        'built_at': built_at or get_timestamp(),
    }


def decode_brands(encoded: Mapping[str, Any]) -> tuple[BrandTally, ...]:
    """The brands of a decoded ``brands`` attribute (``encode_brands``).

    The row is ours, so its JSON already holds the types and only the shape is
    checked: a year's window decodes millions of brands.
    """
    providers: list[str] = encoded['p']
    combos: dict[int, tuple[str, ...]] = {}
    brands = []
    for fields in encoded['b']:
        if len(fields) != _BRAND_FIELDS:
            raise ValueError('brand entry of the wrong length')
        mask = fields[9]
        engines = combos.get(mask)
        if engines is None:
            engines = combos[mask] = tuple(sorted(provider for bit, provider in enumerate(providers) if mask >> bit & 1))
        key, name, classification, mentions, points, rank_sum, rank_count, best_rank, split = fields[:9]
        brands.append(BrandTally(key, name, _CLASSES[classification], mentions, points, rank_sum, rank_count, best_rank, tuple(split), engines))
    return tuple(brands)


def _counts(values: list[Any]) -> tuple[int, ...]:
    if len(values) != len(COUNT_FIELDS):
        raise ValueError('engine counts of the wrong length')
    return tuple(int(value) for value in values)


def tally_from_item(item: Mapping[str, Any]) -> RunTally | None:
    """The tally a row holds; ``None`` for a row of another format or a malformed one (logged)."""
    if int(item.get('v') or 0) != FORMAT_VERSION:
        return None
    try:
        engines = json.loads(str(item.get('engines') or '{}'))
        brands = decode_brands(json.loads(str(item['brands']))) if 'brands' in item else ()
        counts = {str(provider): _counts(entry[0]) for provider, entry in engines.items()}
        return RunTally(
            keyword=str(item['keyword']),
            timestamp=str(item['run_timestamp']),
            engines=counts,
            models={str(provider): tuple(str(model) for model in entry[1]) for provider, entry in engines.items() if entry[1]},
            brands=brands,
            brands_total=int(item.get('brands_total') or 0),
            owned=str(item.get('owned') or ''),
        )
    except (KeyError, TypeError, ValueError, IndexError, AttributeError):
        logger.warning('Ignoring a malformed KeywordRunKpis row of %r at %r', item.get('keyword'), item.get('run_timestamp'))
        return None


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RunTallies:
    """One keyword run counted twice: ``capped`` is the KeywordRunKpis row, ``full`` keeps every brand (KeywordRunBrands, KeywordLatest)."""

    capped: RunTally
    full: RunTally


def run_tally_pair(keyword: str, timestamp: str, answers: Sequence[Answer], brand_config: Mapping[str, Any]) -> RunTallies:
    """``answers`` (one keyword, one run) tallied with ``BRANDS_PER_RUN`` brands and with every brand."""
    owned = owned_domains_from(brand_config)
    capped = run_tally(keyword, timestamp, answers, owned, brand_cap=BRANDS_PER_RUN, tracked_brands=tracked_brand_names(brand_config))
    full = capped if capped.brands_total <= BRANDS_PER_RUN else run_tally(keyword, timestamp, answers, owned)
    return RunTallies(capped, full)


def build_run_tally(search_table: Any, keyword: str, timestamp: str, brand_config: Mapping[str, Any]) -> RunTally:
    """The tally of ``keyword``'s run ``timestamp``, read from every SearchResults row of the run."""
    answers = answers_from_rows(query_keyword_run_rows(search_table, keyword, timestamp))
    return run_tally_pair(keyword, timestamp, answers, brand_config).capped


def put_run_tally(table: Any, tally: RunTally) -> None:
    """Write ``tally``'s row (a put: writing a run again replaces it)."""
    table.put_item(Item=tally_item(tally))


def emit_write_failure_metric(stage: str) -> None:
    """One CloudWatch EMF count of a rollup row not written (``stage``: ``workflow`` or ``backfill``)."""
    emit_count('CitationAnalysis/KpiRollup', 'KeywordRunKpisWriteFailure', 'Stage', stage)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StoredRuns:
    """A keyword's rollup rows of a window, oldest first, read newest first within a time budget."""

    runs: list[RunTally]
    """Every row read, including runs without answers (they still say the run was rolled up)."""
    cut: str | None = None
    """``None`` when the window was read whole; else the run at and before which no row is kept (the budget stopped the read)."""


def _window_condition(keyword: str, since: str, until: str | None) -> Any:
    sort_key = Key('run_timestamp')
    return Key('keyword').eq(keyword) & (sort_key.gte(since) if until is None else sort_key.between(since, until))


def query_stored_runs(
    table: Any, keyword: str, since: str, *, until: str | None = None, brands: bool = True, limit: int | None = None, deadline: Deadline,
) -> StoredRuns:
    """``keyword``'s rollup rows from ``since`` through the run ``until``, newest first, checking ``deadline`` between pages.

    ``brands`` False leaves the brand counts unread (views that list no brand).
    ``limit`` keeps only the newest ``limit`` rows and stops reading there.
    When the deadline stops the read, the oldest row read becomes ``cut`` and
    is dropped too, as a raw window read drops its possibly partial oldest run.
    """
    params: dict[str, Any] = {
        'KeyConditionExpression': _window_condition(keyword, since, until),
        'ProjectionExpression': f'{_BASE_PROJECTION}, brands, brands_total' if brands else _BASE_PROJECTION,
        'ExpressionAttributeNames': _ATTRIBUTE_NAMES,
        'ScanIndexForward': False,
    }
    items: list[Mapping[str, Any]] = []
    while True:
        if limit is not None:
            params['Limit'] = limit - len(items)
        response = table.query(**params)
        items.extend(response.get('Items') or [])
        last_key = response.get('LastEvaluatedKey')
        if not last_key or (limit is not None and len(items) >= limit):
            return StoredRuns([tally for tally in map(tally_from_item, reversed(items)) if tally is not None])
        if deadline.stop_reading('a keyword rollup read'):
            cut = str(items[-1]['run_timestamp'])
            return StoredRuns([tally for tally in map(tally_from_item, reversed(items)) if tally is not None and tally.timestamp > cut], cut)
        params['ExclusiveStartKey'] = last_key


def stored_timestamps(table: Any, keyword: str) -> dict[str, str]:
    """Every run of ``keyword`` with a current-format row, and the ``owned`` fingerprint of each (the backfill's skip list)."""
    found: dict[str, str] = {}
    params: dict[str, Any] = {
        'KeyConditionExpression': Key('keyword').eq(keyword),
        'ProjectionExpression': '#rt, #v, #ow',
        'ExpressionAttributeNames': {'#rt': 'run_timestamp', '#v': 'v', '#ow': 'owned'},
    }
    while True:
        response = table.query(**params)
        for item in response.get('Items') or []:
            if int(item.get('v') or 0) == FORMAT_VERSION:
                found[str(item['run_timestamp'])] = str(item.get('owned') or '')
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return found
        params['ExclusiveStartKey'] = last_key


__all__ = [
    'BRANDS_PER_RUN',
    'FORMAT_VERSION',
    'RunTallies',
    'StoredRuns',
    'build_run_tally',
    'decode_brands',
    'emit_write_failure_metric',
    'encode_brands',
    'keyword_run_kpis_table',
    'keyword_run_kpis_table_name',
    'put_run_tally',
    'query_stored_runs',
    'run_tally_pair',
    'stored_timestamps',
    'tally_from_item',
    'tally_item',
    'tracked_brand_names',
]
