"""Tests for shared/keyword_run_kpis.py: the per-run KPI rollup rows, written and read back."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from hypothesis import given, settings

from shared.keyword_run_kpis import (
    BRANDS_PER_RUN,
    FORMAT_VERSION,
    build_run_tally,
    keyword_run_kpis_table,
    query_stored_runs,
    stored_timestamps,
    tally_from_item,
    tally_item,
    tracked_brand_names,
)
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import run_tally
from shared.request_deadline import Deadline
from testing.assertions import present
from testing.keyword_run_kpis_fixtures import ROLLUP_TABLE_NAME, as_stored, rollup_items, rollup_table, rollups_deployed
from testing.kpi_row_strategies import KEYWORDS, OWNED_DOMAINS, search_rows
from testing.kpi_tally_fixtures import keyword_run_tallies
from testing.window_budget_fixtures import ticking_deadline
from testing.window_rows_fixtures import group_window_rows, paged_search_results_table, run_timestamp, volume_keyword

_KEYWORD = volume_keyword(0)
_ROWS = group_window_rows(1, 4, answers_per_run=3)
_START = '2026-01-01T00:00:00.000000Z'
_OWNED = ['hotel-coruna-mar.es']


class TestRows:
    @settings(max_examples=200, deadline=None)
    @given(rows=search_rows(), owned=OWNED_DOMAINS)
    def test_a_stored_row_reads_back_as_the_tally_written(self, rows, owned):
        tallies = keyword_run_tallies(answers_from_rows(rows), KEYWORDS, owned)

        assert [tally_from_item(as_stored(tally_item(tally))) for tally in tallies] == tallies

    def test_a_row_read_without_brands_has_no_brand_counts(self):
        item = rollup_items(_ROWS)[_KEYWORD][0]

        assert present(tally_from_item({key: value for key, value in item.items() if key != 'brands'})).brands == ()

    def test_a_row_of_another_format_is_not_read(self):
        item = rollup_items(_ROWS)[_KEYWORD][0]

        assert tally_from_item({**item, 'v': FORMAT_VERSION + 1}) is None

    @pytest.mark.parametrize('engines', ['not json', '{"openai": [[1, 2], []]}', '{"openai": 3}'])
    def test_a_malformed_row_is_not_read(self, engines):
        item = rollup_items(_ROWS)[_KEYWORD][0]

        assert tally_from_item({**item, 'engines': engines}) is None

    def test_a_row_stays_far_under_the_item_limit_at_the_brand_cap(self):
        brands = [{'name': f'Competidor número {index:03} de Galicia', 'classification': 'competitor', 'rank': index % 12 + 1} for index in range(200)]
        rows = [{'keyword': 'k', 'provider': provider, 'timestamp': 't', 'brands': brands, 'metadata': {'model': 'm' * 40}} for provider in ('openai', 'perplexity', 'gemini', 'claude')]

        item = tally_item(run_tally('k', 't', answers_from_rows(rows), ['hotel-sol.com'], brand_cap=BRANDS_PER_RUN))

        assert len(json.dumps(item, default=str).encode()) < 16_000


class TestBuildRunTally:
    def test_tallies_every_row_of_the_run_with_the_brand_configs_owned_domains(self):
        table = paged_search_results_table(_ROWS)

        tally = build_run_tally(table, _KEYWORD, run_timestamp(2), {'first_party_domains': _OWNED})

        assert (tally.answers, tally.timestamp, tally.owned) == (3, run_timestamp(2), run_tally('k', 't', [], _OWNED).owned)

    def test_reads_the_tracked_competitors_of_the_brand_config(self):
        assert tracked_brand_names({'tracked_brands': {'competitors': ['NH', 7, 'Meliá']}}) == ['NH', 'Meliá']

    @pytest.mark.parametrize('config', [{}, {'tracked_brands': ['NH']}, {'tracked_brands': {'competitors': 'NH'}}])
    def test_tracks_no_competitor_without_a_competitor_list(self, config):
        assert tracked_brand_names(config) == []


class TestQueryStoredRuns:
    def test_reads_every_run_of_the_window_oldest_first(self):
        stored = query_stored_runs(rollup_table(rollup_items(_ROWS), page_size=2), _KEYWORD, _START, deadline=Deadline(60))

        assert ([run.timestamp for run in stored.runs], stored.cut) == ([run_timestamp(index) for index in range(4)], None)

    def test_reads_through_the_run_until(self):
        stored = query_stored_runs(rollup_table(rollup_items(_ROWS)), _KEYWORD, _START, until=run_timestamp(1), deadline=Deadline(60))

        assert [run.timestamp for run in stored.runs] == [run_timestamp(0), run_timestamp(1)]

    def test_drops_the_oldest_run_read_and_names_it_when_the_deadline_stops_the_read(self):
        # Pages of two rows, newest first: runs 3 and 2 are read, then the deadline is spent.
        stored = query_stored_runs(rollup_table(rollup_items(_ROWS), page_size=2), _KEYWORD, _START, deadline=ticking_deadline(0))

        assert ([run.timestamp for run in stored.runs], stored.cut) == ([run_timestamp(3)], run_timestamp(2))

    def test_keeps_only_the_newest_runs_up_to_the_limit(self):
        stored = query_stored_runs(rollup_table(rollup_items(_ROWS), page_size=3), _KEYWORD, '', limit=2, deadline=Deadline(60))

        assert [run.timestamp for run in stored.runs] == [run_timestamp(2), run_timestamp(3)]

    def test_stops_querying_once_the_limit_is_read(self):
        table = rollup_table(rollup_items(_ROWS), page_size=1)
        query_stored_runs(table, _KEYWORD, '', limit=2, deadline=Deadline(60))

        assert table.query.call_count == 2

    def test_leaves_the_brand_counts_unread_when_asked(self):
        stored = query_stored_runs(rollup_table(rollup_items(_ROWS)), _KEYWORD, _START, brands=False, deadline=Deadline(60))

        assert {run.brands for run in stored.runs} == {()}

    def test_lists_each_stored_runs_owned_fingerprint(self):
        found = stored_timestamps(rollup_table(rollup_items(_ROWS, _OWNED), page_size=3), _KEYWORD)

        assert found == dict.fromkeys((run_timestamp(index) for index in range(4)), run_tally('k', 't', [], _OWNED).owned)


class TestTableName:
    def test_is_none_where_the_table_is_not_deployed(self):
        assert keyword_run_kpis_table(object()) is None

    def test_is_the_configured_table_where_it_is_deployed(self):
        resource = MagicMock()
        resource.Table.side_effect = str

        with rollups_deployed():
            assert keyword_run_kpis_table(resource) == ROLLUP_TABLE_NAME
