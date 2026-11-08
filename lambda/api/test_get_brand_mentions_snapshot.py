"""GET /api/brand-mentions for a large scope: snapshot answers, view jobs and cursors (design 2.45.0 §2, §5 tests 2, 4, 5)."""

from __future__ import annotations

import json
import os
from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.api_response import success_response
from shared.brand_mention_views import latest_run_source
from testing.mention_snapshot_fixtures import LargeScopeHandler, status_and_code, tenant_fixture
from testing.report_scope_fixtures import load_scoped_handler, scoped_report
from testing.scale_data import ScaleSpec
from testing.search_results_fixtures import search_results_table

_HERE = os.path.dirname(os.path.abspath(__file__))
_BRAND_CONFIG = {'tracked_brands': {}, 'updated_at': '2026-10-01T00:00:00Z'}

tenant = tenant_fixture(ScaleSpec(keywords=12, personas=2, runs=2, long_tail=20))


@pytest.fixture(scope='module')
def brand_mentions():
    return load_scoped_handler(_HERE, 'get-brand-mentions.py', '_snapshot')


def _json(value: Any) -> Any:
    return json.loads(json.dumps(value))


@pytest.fixture
def large(brand_mentions, tenant) -> Generator[LargeScopeHandler]:
    with scoped_report(brand_mentions, _BRAND_CONFIG) as report:
        yield LargeScopeHandler(
            brand_mentions, tenant.mention_readers(), tenant.artifacts(), lambda params: report.call({'group_id': 'coruna', **params}),
        )


class TestSummary:
    def test_aggregated_block_equals_the_uncapped_live_summary(self, large, tenant):
        assert large.body({})['aggregated'] == _json(tenant.oracle_summary(None, None, None))

    def test_says_it_comes_from_the_snapshot_as_of_its_build(self, large):
        body = large.body({})

        assert (body['source'], body['as_of'], body['stale'], body['refreshing']) == ('snapshot', '2026-10-05T07:12:00Z', False, False)

    def test_coverage_is_complete_for_every_scope_keyword(self, large):
        body = large.body({})

        assert (body['coverage']['complete'], body['keywords_truncated']) == (True, False)

    def test_serves_a_stale_build_and_says_it_is_refreshing(self, large, tenant):
        large.build = tenant.artifacts(stale=True, refreshing=True)
        body = large.body({})

        assert (body['stale'], body['refreshing']) == (True, True)

    def test_filters_by_persona_provider_and_classification(self, large, tenant):
        body = large.body({'query_prompt_id': 'persona-02', 'provider': 'perplexity', 'classification': 'competitor'})

        assert body['aggregated'] == _json(tenant.oracle_summary('persona-02', 'perplexity', 'competitor'))


class TestViewJobs:
    def test_answers_202_while_a_scope_without_a_build_is_computed(self, large):
        large.build = None

        assert large.call({})['statusCode'] == 202

    def test_answers_202_for_an_older_run(self, large):
        assert large.call({'timestamp': '2026-09-01T06:00:00Z'})['statusCode'] == 202

    def test_answers_the_stored_job_result_with_the_scope_contract(self, large):
        large.build = None
        large.job = success_response({'aggregated': {'brands': []}, 'keywords_analyzed': 2, 'as_of': '2026-10-05T07:41:00Z'}, {})
        body = large.body({})

        assert (body['source'], body['as_of'], body['coverage']['keywords_analyzed'], 'config' in body) == (
            'snapshot', '2026-10-05T07:41:00Z', 2, True,
        )


class TestAppearances:
    def test_concatenated_pages_equal_the_uncapped_live_list(self, large, tenant):
        pages = large.pages({'view': 'appearances', 'limit': '29'}, 'appearances')

        assert pages == _json(tenant.oracle_appearances(None, None, None, None))

    def test_total_appearances_is_exact(self, large, tenant):
        assert large.body({'view': 'appearances', 'limit': '1'})['total_appearances'] == len(tenant.oracle_appearances(None, None, None, None))

    def test_a_cursor_of_a_replaced_build_answers_cursor_expired(self, large, tenant):
        response = large.after_rebuild({'view': 'appearances', 'limit': '3'}, tenant.artifacts(build_id='build-0002'))

        assert status_and_code(response) == (400, 'cursor_expired')

    def test_a_cursor_of_other_filters_answers_cursor_expired(self, large):
        token = large.body({'view': 'appearances', 'limit': '3'})['next_token']
        response = large.call({'view': 'appearances', 'limit': '3', 'next_token': token, 'brand': 'Hotel Coruña Mar'})

        assert status_and_code(response) == (400, 'cursor_expired')


class TestNoExportJob:
    def test_answers_the_appearances_page_when_an_old_export_parameter_is_sent(self, large):
        assert large.body({'view': 'appearances', 'export': 'csv'}) == large.body({'view': 'appearances'})


class TestRouting:
    def test_routes_a_scope_whose_answers_pass_the_budget_to_the_snapshot(self):
        rows = {f'k{index:03}': [] for index in range(201)}
        with patch('shared.brand_mention_views.answers_per_run', return_value=40):
            assert latest_run_source(search_results_table(rows), 'group', list(rows)) == 'snapshot'

    def test_keeps_a_scope_past_the_former_keyword_cap_live_within_the_budget(self):
        with patch('shared.brand_mention_views.answers_per_run', return_value=40):
            assert latest_run_source(MagicMock(), 'group', [f'k{index:03}' for index in range(200)]) == 'live'

    def test_keeps_keyword_ids_live_whatever_their_size(self):
        assert latest_run_source(MagicMock(), 'keywords', [f'k{index:03}' for index in range(9_000)]) == 'live'

    def test_routes_every_scope_over_the_budget_at_one_answer_per_keyword_without_counting(self):
        table = MagicMock()

        assert (latest_run_source(table, 'all', [f'k{index:05}' for index in range(8_001)]), table.query.call_count) == ('snapshot', 0)
