"""
Tests for shared.scoped_reports.

``required_report_scope`` turns the injected scope parameters into the
handler's ``ReportScope`` argument or answers 400 without calling it;
``capped_scope`` keeps the first ``cap`` keywords and describes the cut.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline, current_deadline
from shared.scope_params import SCOPE_KEYWORDS_CAP, ReportScope
from shared.scoped_reports import (
    BASELINE_MEMORY_MB,
    DEFAULT_MEMORY_MB,
    MAX_WINDOW_ROWS,
    MIN_WINDOW_ROWS,
    ROW_HEAP_KIB,
    WINDOW_READ_SHARE,
    WINDOW_ROWS_CAP,
    WindowAnswers,
    capped_scope,
    load_window_answers,
    load_window_histories,
    optional_scope_keywords,
    read_scope_keywords,
    required_report_scope,
    rows_per_keyword,
    scope_read_fields,
    window_read_deadline,
    window_rows_cap,
)
from testing.assertions import present
from testing.search_results_fixtures import PartitionReadFailure, key_parts
from testing.window_budget_fixtures import expired_deadline, ticking_deadline, window_read_budget
from testing.window_rows_fixtures import group_window_rows, paged_search_results_table, run_timestamp, volume_keyword

_EVENT: dict[str, Any] = {'httpMethod': 'GET', 'path': '/api/x', 'headers': {}}


@pytest.fixture(autouse=True)
def _no_active_deadline() -> Iterator[None]:
    clear_request_deadline()
    yield
    clear_request_deadline()


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

    def test_keeps_the_total_within_the_cap_however_many_keywords(self) -> None:
        assert rows_per_keyword(7, cap=100) * 7 <= 100

    def test_reads_one_row_per_keyword_when_keywords_outnumber_the_cap(self) -> None:
        assert rows_per_keyword(500, cap=100) == 1

    def test_gives_one_keyword_the_whole_cap(self) -> None:
        assert rows_per_keyword(1) == WINDOW_ROWS_CAP


class TestWindowRowsCap:
    def test_holds_the_worst_shaped_rows_in_three_quarters_of_a_512_mb_container(self) -> None:
        assert window_rows_cap(512) == int((512 - BASELINE_MEMORY_MB) * 1024 * 0.75 // ROW_HEAP_KIB)

    def test_grows_with_the_function_memory(self) -> None:
        assert (window_rows_cap(512), window_rows_cap(1769)) == (15_902, 72_688)

    def test_never_drops_below_the_minimum_in_a_small_container(self) -> None:
        assert window_rows_cap(128) == MIN_WINDOW_ROWS

    def test_never_passes_the_maximum_in_a_large_container(self) -> None:
        assert window_rows_cap(10_240) == MAX_WINDOW_ROWS

    def test_outside_lambda_assumes_the_smallest_api_function(self) -> None:
        assert WINDOW_ROWS_CAP == window_rows_cap(DEFAULT_MEMORY_MB)


class TestWindowReadDeadline:
    def test_spends_the_read_share_of_what_the_request_has_left(self) -> None:
        activate_deadline(Deadline(10, lambda: 0.0))

        assert window_read_deadline().remaining() == pytest.approx(10 * WINDOW_READ_SHARE, abs=0.1)

    def test_is_expired_when_the_request_has_no_time_left(self) -> None:
        activate_deadline(expired_deadline())

        assert window_read_deadline().expired() is True


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


#: One worker, so the keywords of a window are read in order and a fake clock's checks are deterministic.
_ONE_WORKER = patch('shared.scope_params.SCOPE_MAX_WORKERS', 1)


class TestLoadWindowAnswersTimeBudget:
    """The window read stops at its deadline: newest runs kept, unread keywords named."""

    def test_keeps_the_newest_runs_of_a_single_keyword_the_budget_stops_mid_read(self) -> None:
        # Checks: the keyword's start, then after the first page (5 of 12 rows: run 2 and one row of run 1).
        with window_read_budget(lambda: ticking_deadline(2)):
            window = load_window_answers(paged_search_results_table({_LONG: _WINDOW_ROWS[_LONG]}, page_size=5), [_LONG], _WINDOW_START)

        assert (_run_timestamps(window, _LONG), window.truncated_before) == ([run_timestamp(2)], run_timestamp(1))

    def test_skips_a_keyword_of_several_the_budget_stops_mid_read(self) -> None:
        # Checks: the short keyword's start (one page), the long keyword's start, after its first page.
        with _ONE_WORKER, window_read_budget(lambda: ticking_deadline(3)):
            window = load_window_answers(paged_search_results_table(_WINDOW_ROWS, page_size=5), [_SHORT, _LONG], _WINDOW_START)

        assert (list(window.answers), window.skipped) == ([_SHORT], (_LONG,))

    def test_keeps_the_whole_window_of_the_keywords_read_before_the_budget_ran_out(self) -> None:
        with _ONE_WORKER, window_read_budget(lambda: ticking_deadline(3)):
            window = load_window_answers(paged_search_results_table(_WINDOW_ROWS, page_size=5), [_SHORT, _LONG], _WINDOW_START)

        assert (len(window.answers[_SHORT]), window.truncated_before) == (3, None)

    def test_skips_every_keyword_when_the_budget_is_spent_before_the_read(self) -> None:
        with window_read_budget(expired_deadline):
            window = load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG, _SHORT], _WINDOW_START)

        assert (window.answers, set(window.skipped)) == ({}, {_LONG, _SHORT})

    def test_marks_the_request_deadline_cut_when_the_window_read_stopped(self) -> None:
        request = activate_deadline(Deadline(60, lambda: 0.0))

        with window_read_budget(expired_deadline):
            load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG], _WINDOW_START)

        assert request.cut is True

    def test_leaves_the_request_deadline_uncut_when_the_window_was_read_whole(self) -> None:
        request = activate_deadline(Deadline(60, lambda: 0.0))

        load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG], _WINDOW_START)

        assert request.cut is False

    def test_lists_the_unread_keywords_out_of_the_read_keywords(self) -> None:
        window = WindowAnswers(answers={_SHORT: []}, truncated_before=None, skipped=(_LONG,))

        assert window.read_keywords([_LONG, _SHORT]) == [_SHORT]

    def test_window_histories_cover_only_the_keywords_read(self) -> None:
        with _ONE_WORKER, window_read_budget(lambda: ticking_deadline(3)):
            histories, _truncated_before = load_window_histories(
                paged_search_results_table(_WINDOW_ROWS, page_size=5), [_SHORT, _LONG], _WINDOW_START, [],
            )

        assert [history['keyword'] for history in histories] == [_SHORT]


class TestReadScopeKeywords:
    def test_answers_every_keywords_value_in_scope_order(self) -> None:
        read = read_scope_keywords(['b', 'a'], str.upper, lambda _keyword: '')

        assert (read.values, read.skipped) == ({'b': 'B', 'a': 'A'}, ())

    def test_answers_the_fallback_for_a_keyword_whose_read_fails(self) -> None:
        def failing(keyword: str) -> str:
            raise PartitionReadFailure(keyword)

        read = read_scope_keywords(['a'], failing, lambda _keyword: 'none')

        assert (read.keywords, read.values['a']) == (['a'], 'none')

    def test_skips_every_keyword_when_the_request_budget_is_spent(self) -> None:
        activate_deadline(expired_deadline())

        read = read_scope_keywords(['a', 'b'], str.upper, lambda _keyword: '')

        assert (read.values, read.skipped) == ({}, ('a', 'b'))

    def test_skips_the_keywords_left_once_the_budget_runs_out_mid_fan_out(self) -> None:
        # Checks: the start of 'a' passes, the start of 'b' finds the budget spent.
        activate_deadline(ticking_deadline(2))

        with _ONE_WORKER:
            read = read_scope_keywords(['a', 'b'], str.upper, lambda _keyword: '')

        assert (read.keywords, read.skipped) == (['a'], ('b',))


class TestScopeReadFields:
    def test_flags_keywords_truncated_when_the_budget_left_keywords_unread(self) -> None:
        assert scope_read_fields({'scope': {}, 'keywords_truncated': False}, ['a']) == {'scope': {}, 'keywords_truncated': True}

    def test_keeps_the_caps_flag_when_every_keyword_was_read(self) -> None:
        assert scope_read_fields({'scope': {}, 'keywords_truncated': True}, []) == {'scope': {}, 'keywords_truncated': True}

    def test_leaves_keywords_truncated_false_when_nothing_was_cut(self) -> None:
        assert scope_read_fields({'keywords_truncated': False}, ())['keywords_truncated'] is False


def test_current_deadline_outside_a_request_is_never_cut_by_a_window_read() -> None:
    with window_read_budget(expired_deadline):
        load_window_answers(paged_search_results_table(_WINDOW_ROWS), [_LONG], _WINDOW_START)

    assert current_deadline().cut is False
