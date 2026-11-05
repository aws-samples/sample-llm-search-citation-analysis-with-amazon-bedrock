"""Tests for shared.bounded_writes: parallel writes that stop at the request's time budget."""

from __future__ import annotations

import itertools
from unittest.mock import patch

import pytest

from shared import bounded_writes
from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline


class WriteFailedError(Exception):
    """The error a fake write raises."""


@pytest.fixture(autouse=True)
def _no_active_deadline():
    yield
    clear_request_deadline()


def test_returns_every_result_by_key_in_input_order_when_the_budget_lasts() -> None:
    writes = bounded_writes.map_writes(str.upper, ['b', 'a', 'c'], what='test writes')

    assert (list(writes.written.items()), writes.pending) == ([('b', 'B'), ('a', 'A'), ('c', 'C')], [])


def test_returns_the_keys_not_started_as_pending_when_the_deadline_is_spent() -> None:
    ticks = itertools.count()
    activate_deadline(Deadline(3, lambda: next(ticks)))

    writes = bounded_writes.map_writes(str.upper, ['a', 'b', 'c', 'd'], what='test writes', max_workers=1)

    assert (writes.written, writes.pending) == ({'a': 'A', 'b': 'B'}, ['c', 'd'])


def test_marks_the_deadline_cut_when_a_write_is_left_pending() -> None:
    deadline = activate_deadline(Deadline(0, lambda: 1.0))

    bounded_writes.map_writes(str.upper, ['a'], what='test writes')

    assert deadline.cut is True


def test_writes_nothing_and_leaves_nothing_pending_for_no_keys() -> None:
    writes = bounded_writes.map_writes(str.upper, [], what='test writes')

    assert (writes.written, writes.pending) == ({}, [])


def test_propagates_the_first_failed_write() -> None:
    def write(key: str) -> str:
        raise WriteFailedError(key)

    with pytest.raises(WriteFailedError, match='a'):
        bounded_writes.map_writes(write, ['a'], what='test writes')


def test_runs_at_most_max_workers_writes_at_once() -> None:
    with patch.object(bounded_writes, 'ThreadPoolExecutor', wraps=bounded_writes.ThreadPoolExecutor) as executor:
        bounded_writes.map_writes(str.upper, [str(index) for index in range(25)], what='test writes')

    assert executor.call_args.kwargs == {'max_workers': 10}
