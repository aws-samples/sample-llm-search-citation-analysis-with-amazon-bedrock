"""Tests for historical trend aggregation and parallel keyword fan-out."""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.module_loader import load_handler_module

os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
_mod = load_handler_module(os.path.dirname(__file__), 'get-historical-trends.py')


class QueryFailure(Exception):
    """Expected query failure used by the test double."""


class TestFetchKeywordItems:
    def test_returns_items_when_dynamodb_query_succeeds(self) -> None:
        fake_resource = fake_dynamodb_resource(
            fake_table(query={'Items': [{'timestamp': '2026-01-01T00:00:00Z'}]})
        )
        with patch.object(_mod, 'dynamodb', fake_resource):
            items = _mod._fetch_keyword_items('my-keyword')

        assert items == [{'timestamp': '2026-01-01T00:00:00Z'}]

    def test_returns_empty_list_when_dynamodb_query_fails(self) -> None:
        table = MagicMock()
        table.query.side_effect = QueryFailure('throttled')
        with patch.object(_mod, 'dynamodb', fake_dynamodb_resource(table)):
            items = _mod._fetch_keyword_items('my-keyword')

        assert items == []


class TestBuildTrendFromItems:
    def test_returns_keyword_specific_error_when_items_are_empty(self) -> None:
        result = _mod._build_trend_from_items('kw', [], {}, 'day', 30)

        assert result == {'error': 'No data found for keyword: kw'}

    def test_returns_exact_prominence_fields_when_ranked_answer_exists(self) -> None:
        items = [
            {
                'keyword': 'kw',
                'timestamp': '2026-04-17T12:00:00Z',
                'provider': 'openai',
                'brands': [
                    {
                        'name': 'MyBrand',
                        'classification': 'first_party',
                        'mention_count': 1,
                        'rank': 1,
                    }
                ],
            }
        ]
        with patch.object(_mod, 'get_enabled_provider_count', return_value=4):
            result = _mod._build_trend_from_items('kw', items, {}, 'day', 30)

        assert result['keyword'] == 'kw'
        assert result['period_type'] == 'day'
        assert result['trend_data'] == [{
            'period': '2026-04-17',
            'visibility_score': 43.5,
            'total_mentions': 1,
            'provider_count': 1,
            'best_rank': 1,
            'analysis_runs': 1,
            'answers': 1,
            'mentioned_answers': 1,
            'rank_1_share': 100.0,
            'top_3_share': 100.0,
            'mean_rank': 1.0,
            'mean_first_position': None,
        }]


def _aggregate_daily(items: list[dict]) -> list[dict]:
    """Aggregate ``items`` into daily trend points with four providers enabled."""
    with patch.object(_mod, 'get_enabled_provider_count', return_value=4):
        return _mod.aggregate_by_period(items, 'day', {})


#: The daily point ``aggregate_by_period`` emits when the day's only answer
#: mentions the brand with the 999 "unranked" sentinel: the mention counts, but
#: there is no rank or first position to report.
_UNRANKED_SINGLE_ANSWER_POINT = {
    'period': '2026-09-18',
    'visibility_score': 16.5,
    'total_mentions': 1,
    'provider_count': 1,
    'best_rank': None,
    'analysis_runs': 1,
    'answers': 1,
    'mentioned_answers': 1,
    'rank_1_share': 0.0,
    'top_3_share': 0.0,
    'mean_rank': None,
    'mean_first_position': None,
}


class TestAggregateByPeriod:
    def test_calculates_answer_level_prominence_across_a_period(self) -> None:
        timestamp = '2026-09-18T10:00:00Z'
        items = [
            {
                'timestamp': timestamp,
                'provider': 'openai',
                'brands': [
                    {'name': 'Mine', 'classification': 'first_party', 'mention_count': 1, 'rank': 4, 'first_position': 40},
                    {'name': 'Mine Plus', 'classification': 'first_party', 'mention_count': 1, 'rank': 1, 'first_position': 10},
                ],
            },
            {
                'timestamp': timestamp,
                'provider': 'gemini',
                'brands': [
                    {'name': 'Mine', 'classification': 'first_party', 'mention_count': 1, 'rank': 3, 'first_position': 30}
                ],
            },
            {
                'timestamp': timestamp,
                'provider': 'perplexity',
                'brands': [
                    {'name': 'Mine', 'classification': 'first_party', 'mention_count': 1, 'rank': 999, 'first_position': 20}
                ],
            },
            {
                'timestamp': timestamp,
                'provider': 'claude',
                'brands': [
                    {'name': 'Rival', 'classification': 'competitor', 'mention_count': 1, 'rank': 1, 'first_position': 5}
                ],
            },
        ]

        trend_data = _aggregate_daily(items)

        assert trend_data == [{
            'period': '2026-09-18',
            'visibility_score': 68.2,
            'total_mentions': 4,
            'provider_count': 3,
            'best_rank': 1,
            'analysis_runs': 1,
            'answers': 4,
            'mentioned_answers': 3,
            'rank_1_share': 25.0,
            'top_3_share': 50.0,
            'mean_rank': 2.0,
            'mean_first_position': 20.0,
        }]

    def test_returns_unavailable_rank_values_when_only_sentinel_exists(self) -> None:
        items = [{
            'timestamp': '2026-09-18T10:00:00Z',
            'provider': 'openai',
            'brands': [
                {'name': 'Mine', 'classification': 'first_party', 'mention_count': 1, 'rank': 999}
            ],
        }]

        trend_data = _aggregate_daily(items)

        assert trend_data == [_UNRANKED_SINGLE_ANSWER_POINT]


class TestBuildGroupSeries:
    def test_averages_keyword_prominence_without_removing_best_rank(self) -> None:
        trends = [
            {'trend_data': [{
                'period': '2026-09-18',
                'visibility_score': 80.0,
                'total_mentions': 4,
                'provider_count': 3,
                'best_rank': 1,
                'analysis_runs': 2,
                'answers': 4,
                'mentioned_answers': 3,
                'rank_1_share': 50.0,
                'top_3_share': 75.0,
                'mean_rank': 1.5,
                'mean_first_position': 10.0,
            }]},
            {'trend_data': [{
                'period': '2026-09-18',
                'visibility_score': 40.0,
                'total_mentions': 2,
                'provider_count': 1,
                'best_rank': 4,
                'analysis_runs': 1,
                'answers': 2,
                'mentioned_answers': 1,
                'rank_1_share': 0.0,
                'top_3_share': 0.0,
                'mean_rank': 4.0,
                'mean_first_position': 30.0,
            }]},
            {'trend_data': [{
                'period': '2026-09-18',
                'visibility_score': 60.0,
                'total_mentions': 1,
                'provider_count': 2,
                'best_rank': None,
                'analysis_runs': 1,
                'answers': 1,
                'mentioned_answers': 1,
                'rank_1_share': 0.0,
                'top_3_share': 0.0,
                'mean_rank': None,
                'mean_first_position': None,
            }]},
        ]

        group_series = _mod.build_group_series(trends)

        assert group_series == [{
            'period': '2026-09-18',
            'visibility_score': 60.0,
            'total_mentions': 7,
            'provider_count': 3,
            'best_rank': 1,
            'analysis_runs': 4,
            'answers': 7,
            'mentioned_answers': 5,
            'rank_1_share': 16.7,
            'top_3_share': 25.0,
            'mean_rank': 2.75,
            'mean_first_position': 20.0,
            'keywords_with_data': 3,
        }]

    @pytest.mark.parametrize(
        ('field_name', 'boolean_value'),
        [
            pytest.param('mean_rank', True, id='mean-rank'),
            pytest.param('mean_first_position', False, id='mean-first-position'),
        ],
    )
    def test_returns_unavailable_group_mean_when_source_value_is_boolean(
        self,
        field_name: str,
        boolean_value: bool,
    ) -> None:
        point = {**_UNRANKED_SINGLE_ANSWER_POINT, field_name: boolean_value}

        group_series = _mod.build_group_series([{'trend_data': [point]}])

        assert group_series[0][field_name] is None


class TestGetAllKeywordsTrendsParallelFanOut:
    @staticmethod
    def _fake_keyword_items(keyword: str) -> list[dict]:
        return [
            {
                'keyword': keyword,
                'timestamp': '2026-04-17T12:00:00Z',
                'provider': 'openai',
                'brands': [
                    {
                        'name': 'MyBrand',
                        'classification': 'first_party',
                        'mention_count': 1,
                        'rank': 1,
                    }
                ],
            }
        ]

    @staticmethod
    def _keywords_resource(count: int, search_table: MagicMock | None = None) -> MagicMock:
        keywords_table = fake_table(query={'Items': [{'keyword': f'kw{index}'} for index in range(count)]})
        if search_table is None:
            return fake_dynamodb_resource(keywords_table)
        return fake_dynamodb_resource(keywords_table, by_name={_mod.SEARCH_RESULTS_TABLE: search_table})

    @classmethod
    @contextmanager
    def _fan_out(
        cls,
        keyword_count: int,
        fetch: Callable[[str], list[dict]] | MagicMock | None = None,
        search_table: MagicMock | None = None,
    ) -> Iterator[MagicMock]:
        if fetch is None:
            fetch = MagicMock(side_effect=cls._fake_keyword_items)
        elif not isinstance(fetch, MagicMock):
            fetch = MagicMock(side_effect=fetch)
        with (
            patch.object(_mod, 'dynamodb', cls._keywords_resource(keyword_count, search_table)),
            patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}),
            patch.object(_mod, '_fetch_keyword_items', fetch),
            patch.object(_mod, 'get_enabled_provider_count', return_value=4),
            patch.object(
                _mod.concurrent.futures,
                'ThreadPoolExecutor',
                wraps=_mod.concurrent.futures.ThreadPoolExecutor,
            ) as pool_spy,
        ):
            yield pool_spy

    def test_fetches_each_keyword_exactly_once(self) -> None:
        counting_fetch = MagicMock(side_effect=self._fake_keyword_items)

        with self._fan_out(5, fetch=counting_fetch, search_table=MagicMock()):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        assert counting_fetch.call_count == 5
        assert result['keywords_analyzed'] == 5

    def test_uses_thread_pool_when_multiple_keywords_are_requested(self) -> None:
        with self._fan_out(3) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        pool_spy.assert_called_once()

    def test_caps_worker_count_when_keywords_exceed_maximum(self) -> None:
        with self._fan_out(20) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        pool_spy.assert_called_once()
        _, kwargs = pool_spy.call_args
        assert kwargs['max_workers'] == _mod._TRENDS_MAX_WORKERS

    def test_matches_worker_count_to_keyword_count_when_below_maximum(self) -> None:
        with self._fan_out(3) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        _, kwargs = pool_spy.call_args
        assert kwargs['max_workers'] == 3

    def test_returns_empty_payload_when_no_keywords_exist(self) -> None:
        mock_fetch = MagicMock()

        with self._fan_out(0, fetch=mock_fetch):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        mock_fetch.assert_not_called()
        assert result['keywords_analyzed'] == 0
        assert result['keyword_trends'] == []
        assert result['overall']['avg_score'] == 0

    def test_preserves_every_keyword_when_futures_complete_out_of_order(self) -> None:
        with self._fan_out(5):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        returned_keywords = {trend['keyword'] for trend in result['keyword_trends']}
        assert returned_keywords == {f'kw{index}' for index in range(5)}

    def test_caps_fan_out_at_twenty_keywords_for_all_scope(self) -> None:
        counting_fetch = MagicMock(side_effect=self._fake_keyword_items)

        with self._fan_out(50, fetch=counting_fetch):
            _mod.get_all_keywords_trends({}, 'day', 30)

        assert counting_fetch.call_count == 20

    def test_preserves_successful_keywords_when_one_fetch_returns_empty(self) -> None:
        def mixed_fetch(keyword: str) -> list[dict]:
            if keyword == 'kw1':
                return []
            return self._fake_keyword_items(keyword)

        with self._fan_out(3, fetch=mixed_fetch):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        assert result['keywords_analyzed'] == 2
