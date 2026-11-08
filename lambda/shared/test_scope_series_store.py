"""Tests for the stored history a scope series and a window job read (``shared.scope_series_store.stored_history``)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from boto3.dynamodb.conditions import ConditionBase

from shared.keyword_run_brands import brands_item
from shared.keyword_run_kpis import tally_item
from shared.request_deadline import Deadline
from shared.scope_series import SERIES_RUNS
from shared.scope_series_store import stored_history
from testing.memory_dynamodb import MemoryTable
from testing.scale_data import ScaleSpec, keyword_text, run_timestamp
from testing.scope_snapshot_fixtures import full_tally

_SPEC = ScaleSpec(keywords=1, groups=1, largest_group=1, markets=0, personas=1, engines=('openai',), runs=1, long_tail=40)
_STORED_RUNS = SERIES_RUNS + 35
_KEYWORD = keyword_text(0)


@dataclass
class _CountingTable(MemoryTable):
    """A table that also counts the rows its queries returned."""

    rows_returned: int = 0

    def query(self, **params: Any) -> dict[str, Any]:
        response = super().query(**params)
        self.rows_returned += len(response.get('Items') or [])
        return response


def _tables() -> tuple[_CountingTable, _CountingTable]:
    rollups = _CountingTable('rollups', ('keyword', 'run_timestamp'))
    brands = _CountingTable('brands', ('keyword', 'run_timestamp'))
    tally = full_tally(_SPEC, 0, 0)
    for run in range(_STORED_RUNS):
        moved = replace(tally, timestamp=run_timestamp(run))
        rollups.put_item(Item=tally_item(moved))
        brands.put_item(Item=brands_item(moved))
    return rollups, brands


def _lower_bounds(table: MemoryTable) -> set[str]:
    """The run timestamps the ``keyword = :k AND run_timestamp >= :t`` conditions of every query started at."""
    bounds = set()
    for _, params in table.reads:
        condition: ConditionBase = params['KeyConditionExpression']
        sort_condition = condition.get_expression()['values'][1]
        bounds.add(str(sort_condition.get_expression()['values'][1]))
    return bounds


class TestSeriesHistory:
    def test_returns_only_the_newest_series_runs_oldest_first(self):
        rollups, brands = _tables()
        runs = stored_history(rollups, brands, Deadline(60))(_KEYWORD, '')
        assert [run.timestamp for run in runs] == [run_timestamp(run) for run in range(_STORED_RUNS - SERIES_RUNS, _STORED_RUNS)]

    def test_stops_reading_the_rollups_after_the_series_runs(self):
        rollups, brands = _tables()
        stored_history(rollups, brands, Deadline(60))(_KEYWORD, '')
        assert rollups.rows_returned == SERIES_RUNS

    def test_reads_brand_rows_only_from_the_oldest_kept_run(self):
        rollups, brands = _tables()
        stored_history(rollups, brands, Deadline(60))(_KEYWORD, '')
        assert (_lower_bounds(brands), brands.rows_returned) == ({run_timestamp(_STORED_RUNS - SERIES_RUNS)}, SERIES_RUNS)


class TestWindowHistory:
    def test_returns_every_run_from_since(self):
        rollups, brands = _tables()
        runs = stored_history(rollups, brands, Deadline(60))(_KEYWORD, run_timestamp(_STORED_RUNS - 30))
        assert [run.timestamp for run in runs] == [run_timestamp(run) for run in range(_STORED_RUNS - 30, _STORED_RUNS)]

    def test_queries_both_tables_from_since(self):
        rollups, brands = _tables()
        stored_history(rollups, brands, Deadline(60))(_KEYWORD, run_timestamp(_STORED_RUNS - 30))
        assert (_lower_bounds(rollups), rollups.rows_returned, brands.rows_returned) == ({run_timestamp(_STORED_RUNS - 30)}, 30, 30)

    def test_a_keyword_without_runs_reads_no_brand_rows(self):
        rollups, brands = _tables()
        runs = stored_history(rollups, brands, Deadline(60))('another keyword', '')
        assert (runs, brands.reads) == ([], [])
