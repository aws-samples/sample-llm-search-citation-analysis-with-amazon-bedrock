"""
Tests for shared.scoped_reports.

``required_report_scope`` turns the injected scope parameters into the
handler's ``ReportScope`` argument or answers 400 without calling it;
``capped_scope`` keeps the first ``cap`` keywords and describes the cut.
"""

from __future__ import annotations

import inspect
import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.scope_params import SCOPE_KEYWORDS_CAP, ReportScope
from shared.scoped_reports import (
    MIN_ROWS_PER_KEYWORD,
    WINDOW_ROWS_CAP,
    WindowAnswers,
    capped_scope,
    load_window_answers,
    optional_scope_keywords,
    required_report_scope,
    rows_per_keyword,
)
from testing.assertions import present
from testing.search_results_fixtures import PartitionReadFailure, key_parts
from testing.window_rows_fixtures import group_window_rows, paged_search_results_table, run_timestamp, volume_keyword

_EVENT: dict[str, Any] = {'httpMethod': 'GET', 'path': '/api/x', 'headers': {}}


def _scope(count: int) -> ReportScope:
    keywords = tuple(f'kw {index:03}' for index in range(count))
    return ReportScope(kind='all', keywords=keywords, scope={'mode': 'all'}, label='All keywords')


def stub_handler(event: dict[str, Any], context: Any, report_scope: ReportScope, **params: Any) -> dict[str, Any]:
    return {'kind': report_scope.kind, 'keywords': list(report_scope.keywords), 'params': params}


class TestRequiredReportScope:
    def test_hands_the_resolved_scope_and_the_other_params_to_the_handler(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        answer = handler(_EVENT, None, keyword='hotel coruna', group_id=None, keyword_ids=None, scope=None, days=30)

        assert answer == {'kind': 'keyword', 'keywords': ['hotel coruna'], 'params': {'days': 30}}

    def test_answers_400_on_the_keyword_field_without_a_scope(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        response = handler(_EVENT, None, days=30)

        assert present(response)['statusCode'] == 400
        assert json.loads(present(response)['body'])['field'] == 'keyword'

    def test_answers_400_on_contradictory_scopes(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        response = handler(_EVENT, None, keyword='a', group_id='coruna')

        assert present(response)['statusCode'] == 400

    def test_unwraps_to_the_decorated_handler_so_its_name_reaches_error_logs(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        assert inspect.unwrap(handler) is stub_handler

    def test_resolves_the_keywords_table_on_every_request(self) -> None:
        keywords_table = MagicMock(return_value=MagicMock())
        handler = required_report_scope(keywords_table)(stub_handler)

        handler(_EVENT, None, keyword='a')
        handler(_EVENT, None, keyword='b')

        assert keywords_table.call_count == 2

    def test_takes_the_market_filter_out_of_the_handler_params(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': [
            {'id': 'k1', 'keyword': 'hotel coruna', 'group_ids': {'g'}},
            {'id': 'k2', 'keyword': 'hotel coruña', 'group_ids': {'g'}, 'market_id': 'es-es'},
        ]}
        handler = required_report_scope(lambda: table)(stub_handler)

        answer = handler(_EVENT, None, group_id='g', market_id='es-es', days=30)

        assert answer == {'kind': 'group', 'keywords': ['hotel coruña'], 'params': {'days': 30}}


def stub_keywords_handler(event: dict[str, Any], context: Any, keywords: list[str] | None, **params: Any) -> dict[str, Any]:
    return {'keywords': keywords, 'params': params}


def _optional(**query: Any) -> dict[str, Any] | None:
    """Call a handler under ``optional_scope_keywords`` with the given query parameters."""
    return optional_scope_keywords(MagicMock)(stub_keywords_handler)(_EVENT, None, **query)


def _rejection_field(response: dict[str, Any] | None) -> tuple[int, str]:
    return present(response)['statusCode'], json.loads(present(response)['body'])['field']


class TestOptionalScopeKeywords:
    """Action Center and Prompt Insights: a scope narrows the keywords, no scope keeps the handler's default."""

    def test_hands_the_scopes_keyword_texts_and_the_other_params_to_the_handler(self) -> None:
        assert _optional(keyword='hotel coruna', group_id=None, use_llm=False) == {
            'keywords': ['hotel coruna'], 'params': {'use_llm': False},
        }

    def test_hands_none_without_a_scope_so_the_handler_applies_its_default(self) -> None:
        assert _optional(keyword=None, group_id=None, limit=20) == {'keywords': None, 'params': {'limit': 20}}

    def test_answers_400_on_the_scope_field_for_contradictory_scopes_without_calling_the_handler(self) -> None:
        assert _rejection_field(_optional(keyword='a', group_id='coruna')) == (400, 'scope')


class TestCappedScope:
    def test_keeps_every_keyword_under_the_cap(self) -> None:
        keywords, fields = capped_scope(_scope(2))

        assert (keywords, fields['keywords_truncated']) == (['kw 000', 'kw 001'], False)

    def test_cuts_the_keywords_at_the_default_cap(self) -> None:
        keywords, fields = capped_scope(_scope(SCOPE_KEYWORDS_CAP + 1))

        assert (len(keywords), fields['keywords_truncated']) == (SCOPE_KEYWORDS_CAP, True)

    def test_cuts_the_keywords_at_a_given_cap(self) -> None:
        keywords, _fields = capped_scope(_scope(3), cap=2)

        assert keywords == ['kw 000', 'kw 001']

    def test_describes_the_whole_scope(self) -> None:
        _keywords, fields = capped_scope(_scope(3), cap=2)

        assert fields['scope'] == {'mode': 'all', 'kind': 'all', 'label': 'All keywords', 'keyword_count': 3}


class TestRowsPerKeyword:
    def test_shares_the_window_cap_between_the_keywords(self) -> None:
        assert rows_per_keyword(100) == WINDOW_ROWS_CAP // 100

    def test_reads_at_least_the_minimum_per_keyword_however_many_keywords(self) -> None:
        assert rows_per_keyword(10_000) == MIN_ROWS_PER_KEYWORD

    def test_gives_one_keyword_the_whole_cap(self) -> None:
        assert rows_per_keyword(1) == WINDOW_ROWS_CAP


_LONG = volume_keyword(0)
_SHORT = volume_keyword(1)
# Three runs: four answers a run for the first keyword, one for the second.
_WINDOW_ROWS = {
    _LONG: group_window_rows(1, 3, answers_per_run=4)[_LONG],
    _SHORT: group_window_rows(2, 3, answers_per_run=1)[_SHORT],
}
_WINDOW_START = '2026-01-01T00:00:00.000000Z'


def _run_timestamps(window: WindowAnswers, keyword: str) -> list[str]:
    return sorted({answer.timestamp for answer in window.answers[keyword]})


class TestLoadWindowAnswers:
    @pytest.fixture
    def capped_window(self) -> Any:
        """Both keywords' window read with a cap of six rows: inside the long keyword's history."""
        return load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG, _SHORT], _WINDOW_START, max_rows=6)
    def test_reads_every_answer_of_the_window_under_the_cap(self) -> None:
        window = load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG, _SHORT], _WINDOW_START, max_rows=100)

        assert ([len(window.answers[_LONG]), len(window.answers[_SHORT])], window.truncated_before) == ([12, 3], None)

    def test_reports_the_run_the_cap_stopped_at(self, capped_window) -> None:
        assert capped_window.truncated_before == run_timestamp(1)

    def test_cuts_every_keyword_at_the_same_run_when_one_keyword_is_capped(self, capped_window) -> None:
        assert (_run_timestamps(capped_window, _LONG), _run_timestamps(capped_window, _SHORT)) == ([run_timestamp(2)], [run_timestamp(2)])

    def test_reads_through_the_run_until(self) -> None:
        window = load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_SHORT], _WINDOW_START, until=run_timestamp(1))

        assert _run_timestamps(window, _SHORT) == [run_timestamp(0), run_timestamp(1)]

    def test_answers_no_answers_for_a_keyword_whose_read_fails(self) -> None:
        table = paged_search_results_table(_WINDOW_ROWS)
        answer_page = table.query.side_effect

        def failing_for_the_short_keyword(**kwargs: Any) -> dict[str, Any]:
            if key_parts(kwargs['KeyConditionExpression'])[0] == _SHORT:
                raise PartitionReadFailure(_SHORT)
            return answer_page(**kwargs)

        table.query.side_effect = failing_for_the_short_keyword

        window = load_window_answers(table, [_LONG, _SHORT], _WINDOW_START)

        assert ([len(window.answers[_LONG]), window.answers[_SHORT]], window.truncated_before) == ([12, []], None)

    def test_reads_nothing_for_no_keywords(self) -> None:
        window = load_window_answers(paged_search_results_table({}), [], _WINDOW_START)

        assert (window.answers, window.truncated_before) == ({}, None)
