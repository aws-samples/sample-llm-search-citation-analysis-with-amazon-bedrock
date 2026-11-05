"""The request time budget: how it is started, read, and honoured by bounded reads and fan-outs."""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.decorators import api_handler
from shared.dynamodb_batch import collect_all_items, collect_capped_items
from shared.request_deadline import (
    DEFAULT_BUDGET_SECONDS,
    MIN_BUDGET_SECONDS,
    SAFETY_MARGIN_SECONDS,
    Deadline,
    activate_deadline,
    budget_from_context,
    clear_request_deadline,
    current_deadline,
    start_request_deadline,
)
from shared.scope_params import map_scope_keywords


def _lambda_context(remaining_ms: int) -> SimpleNamespace:
    return SimpleNamespace(get_remaining_time_in_millis=lambda: remaining_ms)


def _paged_operation(pages: int) -> MagicMock:
    """A query/scan returning ``pages`` one-item pages."""
    responses = [
        {'Items': [{'n': page}], **({'LastEvaluatedKey': {'n': page}} if page < pages - 1 else {})}
        for page in range(pages)
    ]
    return MagicMock(side_effect=responses)


@pytest.fixture(autouse=True)
def _no_active_deadline() -> Iterator[None]:
    clear_request_deadline()
    yield
    clear_request_deadline()


class TestDeadline:
    def test_remaining_counts_down_with_the_clock(self) -> None:
        ticks = iter([0.0, 3.0])
        deadline = Deadline(10, lambda: next(ticks))
        assert deadline.remaining() == 7.0

    def test_remaining_is_never_negative(self) -> None:
        ticks = iter([0.0, 30.0])
        deadline = Deadline(10, lambda: next(ticks))
        assert deadline.remaining() == 0.0

    def test_stop_reading_leaves_cut_false_while_time_remains(self) -> None:
        deadline = Deadline(10, lambda: 0.0)
        assert (deadline.stop_reading('a read'), deadline.cut) == (False, False)

    def test_stop_reading_marks_the_deadline_cut_once_expired(self) -> None:
        ticks = iter([0.0, 11.0])
        deadline = Deadline(10, lambda: next(ticks))
        assert (deadline.stop_reading('a read'), deadline.cut) == (True, True)


class TestBudgetFromContext:
    def test_budget_is_the_remaining_time_minus_the_safety_margin(self) -> None:
        assert budget_from_context(_lambda_context(29_000)) == 29 - SAFETY_MARGIN_SECONDS

    def test_budget_never_drops_below_the_minimum(self) -> None:
        assert budget_from_context(_lambda_context(500)) == MIN_BUDGET_SECONDS

    def test_budget_defaults_when_there_is_no_lambda_context(self) -> None:
        assert budget_from_context(None) == DEFAULT_BUDGET_SECONDS

    def test_budget_defaults_when_the_context_answers_a_non_number(self) -> None:
        assert budget_from_context(SimpleNamespace(get_remaining_time_in_millis=MagicMock())) == DEFAULT_BUDGET_SECONDS


class TestActiveDeadline:
    def test_current_deadline_is_the_one_started_for_the_request(self) -> None:
        started = start_request_deadline(_lambda_context(20_000))
        assert current_deadline() is started

    def test_current_deadline_outside_a_request_is_not_stored(self) -> None:
        assert current_deadline() is not current_deadline()

    def test_api_handler_keeps_one_deadline_for_the_whole_request(self) -> None:
        seen: dict[str, bool] = {}

        @api_handler
        def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
            seen['stable'] = current_deadline() is current_deadline()
            return {'statusCode': 200}

        handler({}, _lambda_context(20_000))
        assert seen == {'stable': True}

    def test_api_handler_clears_the_deadline_when_the_handler_returns(self) -> None:
        api_handler(lambda event, context: {'statusCode': 200})({}, _lambda_context(20_000))
        assert current_deadline() is not current_deadline()


class TestCappedReadsHonourTheDeadline:
    def test_capped_read_stops_after_the_first_page_once_the_budget_is_spent(self) -> None:
        activate_deadline(Deadline(0, lambda: 1.0))
        items, truncated = collect_capped_items(_paged_operation(5), 25)
        assert (items, truncated) == ([{'n': 0}], True)

    def test_capped_read_marks_the_deadline_cut_when_it_stops_early(self) -> None:
        deadline = Deadline(0, lambda: 1.0)
        activate_deadline(deadline)
        collect_capped_items(_paged_operation(5), 25)
        assert deadline.cut is True

    def test_capped_read_reads_every_page_while_time_remains(self) -> None:
        activate_deadline(Deadline(60, lambda: 0.0))
        items, truncated = collect_capped_items(_paged_operation(3), 25)
        assert (len(items), truncated) == (3, False)

    def test_uncapped_read_ignores_the_deadline(self) -> None:
        activate_deadline(Deadline(0, lambda: 1.0))
        assert len(collect_all_items(_paged_operation(4))) == 4


class TestScopeFanOutHonoursTheDeadline:
    def test_keywords_get_the_fallback_once_the_budget_is_spent(self) -> None:
        activate_deadline(Deadline(0, lambda: 1.0))
        results = map_scope_keywords(['a', 'b'], str.upper, lambda keyword: f'skipped {keyword}')
        assert results == ['skipped a', 'skipped b']

    def test_fan_out_marks_the_deadline_cut_when_it_skips_keywords(self) -> None:
        deadline = activate_deadline(Deadline(0, lambda: 1.0))
        map_scope_keywords(['a'], str.upper, lambda keyword: '')
        assert deadline.cut is True

    def test_every_keyword_is_computed_while_time_remains(self) -> None:
        activate_deadline(Deadline(60, lambda: 0.0))
        assert map_scope_keywords(['a', 'b'], str.upper, lambda keyword: '') == ['A', 'B']
