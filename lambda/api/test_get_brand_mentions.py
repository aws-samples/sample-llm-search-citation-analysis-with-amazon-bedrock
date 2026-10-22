"""GET /api/brand-mentions: bounded reads and the ``view=appearances`` pages.

The scope behaviour shared with the other report routes lives in
``test_report_scopes.py``; the size budgets in ``test_get_brand_mentions_volume.py``.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from testing.brand_mentions_fixtures import VOLUME_GROUP_ID, volume_keyword_text, volume_keywords
from testing.report_scope_fixtures import OLD_TS, RUN_TS, load_scoped_handler, scoped_report
from testing.report_scope_fixtures import brand as _brand
from testing.report_scope_fixtures import result as _result
from testing.search_results_fixtures import key_parts

_HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(scope='module')
def brand_mentions():
    return load_scoped_handler(_HERE, 'get-brand-mentions.py', '_views')


@pytest.fixture
def coruna(brand_mentions):
    with scoped_report(brand_mentions, {'tracked_brands': {}}) as report:
        yield report


def _sort_operator(call: Any) -> str | None:
    sort = key_parts(call.kwargs['KeyConditionExpression'])[1]
    return None if sort is None else sort.expression_operator


def _answer_text_reads(report: Any) -> list[Any]:
    return [call for call in report.tables['search'].query.call_args_list if '#rs' in call.kwargs.get('ProjectionExpression', '')]


class TestBoundedReads:
    @pytest.mark.parametrize('params', [
        pytest.param({'group_id': 'coruna'}, id='group'),
        pytest.param({'keyword': 'hotel coruna spa'}, id='keyword'),
        pytest.param({'group_id': 'coruna', 'view': 'appearances'}, id='appearances'),
    ])
    def test_reads_one_row_or_one_run_per_query(self, coruna, params):
        coruna.call(params)

        assert all(
            call.kwargs.get('Limit') == 1 or _sort_operator(call) == 'begins_with'
            for call in coruna.tables['search'].query.call_args_list
        )

    def test_single_keyword_summary_reads_answer_text_of_the_selected_run_only(self, coruna):
        coruna.call({'keyword': 'hotel coruna spa', 'timestamp': OLD_TS})

        reads = _answer_text_reads(coruna)
        assert [key_parts(call.kwargs['KeyConditionExpression'])[1].get_expression()['values'][1] for call in reads] == [f'{OLD_TS}#']

    def test_appearances_view_reads_no_answer_text(self, coruna):
        coruna.call({'keyword': 'hotel coruna spa', 'view': 'appearances'})

        assert _answer_text_reads(coruna) == []

    def test_available_runs_list_only_the_latest_run_past_the_deep_listed_keywords(self, brand_mentions):
        keywords = volume_keywords(12)
        rows = {
            volume_keyword_text(index): [
                _result(volume_keyword_text(index), 'openai', [], timestamp=RUN_TS),
                _result(volume_keyword_text(index), 'openai', [], timestamp=f'2026-01-{index + 1:02d}T00:00:00Z'),
            ]
            for index in range(12)
        }
        with scoped_report(brand_mentions, {'tracked_brands': {}}, search_rows=rows, active=keywords) as report:
            runs = report.body({'group_id': VOLUME_GROUP_ID})['available_runs']

        assert runs == [RUN_TS] + [f'2026-01-{day:02d}T00:00:00Z' for day in range(10, 0, -1)]


class TestAppearancesView:
    def test_lists_every_appearance_of_the_selected_runs(self, coruna):
        body = coruna.body({'group_id': 'coruna', 'view': 'appearances'})

        assert [(row['brand'], row['keyword'], row['provider']) for row in body['appearances']] == [
            ('Hotel Coruna', 'hotel coruna spa', 'openai'),
            ('Hotel Coruna', 'hotel coruna spa', 'gemini'),
            ('Rival Inn', 'best hotels galicia', 'openai'),
            ('Rival Inn', 'hotel coruna spa', 'openai'),
        ]

    def test_narrows_to_one_brand(self, coruna):
        body = coruna.body({'group_id': 'coruna', 'view': 'appearances', 'brand': 'hotel coruna'})

        assert (body['total_appearances'], {row['brand'] for row in body['appearances']}) == (2, {'Hotel Coruna'})

    def test_reads_the_requested_historical_run(self, coruna):
        body = coruna.body({'keyword': 'hotel coruna spa', 'view': 'appearances', 'timestamp': OLD_TS})

        assert [(row['brand'], row['mention_count']) for row in body['appearances']] == [('Rival Inn', 5)]

    def test_ends_with_a_null_next_token(self, coruna):
        body = coruna.body({'group_id': 'coruna', 'view': 'appearances'})

        assert (body['next_token'], body['total_appearances']) == (None, 4)

    def test_hands_out_a_next_token_when_the_limit_cuts_the_list(self, coruna):
        first = coruna.body({'group_id': 'coruna', 'view': 'appearances', 'limit': '3'})
        second = coruna.body({'group_id': 'coruna', 'view': 'appearances', 'limit': '3', 'next_token': first['next_token']})

        assert (len(first['appearances']), len(second['appearances']), second['next_token']) == (3, 1, None)

    def test_answers_an_empty_page_for_a_keyword_never_analysed(self, coruna):
        body = coruna.body({'keyword': 'hotel marino beach', 'view': 'appearances'})

        assert (body['appearances'], body['next_token']) == ([], None)

    def test_rejects_an_unknown_view(self, coruna):
        assert coruna.call({'group_id': 'coruna', 'view': 'everything'})['statusCode'] == 400


def test_summary_brands_name_their_appearance_count(brand_mentions):
    rows = {'hotel coruna spa': [_result('hotel coruna spa', provider, [_brand('Rival Inn', 'competitor')]) for provider in ('a', 'b', 'c')]}
    with scoped_report(brand_mentions, {'tracked_brands': {}}, search_rows=rows) as report:
        brand = report.body({'keyword': 'hotel coruna spa'})['aggregated']['brands'][0]

    assert (brand['appearance_count'], brand['provider_ranks']) == (3, {'a': 1, 'b': 1, 'c': 1})
