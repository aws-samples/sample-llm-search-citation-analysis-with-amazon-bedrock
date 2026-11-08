"""Exports waiting on a view job: tokens registered against the job run, sent back by its view-job.finished event."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError

from shared.export_view_job_wait import (
    MAX_WAITERS,
    VIEW_JOB_FAILED_ERROR,
    ViewJobRun,
    ViewJobWaitError,
    finish_view_job,
    register_wait,
    run_from,
)
from testing.export_fakes import ConditionalTable, FakeStepFunctions, exports_table
from testing.export_fixtures import NOW

RUN = ViewJobRun('job-1', '2026-11-06T08:00:00Z')
#: The same job started again after its first run failed.
NEXT_RUN = ViewJobRun('job-1', '2026-11-06T08:20:00Z')


@pytest.fixture
def table() -> ConditionalTable:
    return exports_table()


@pytest.fixture
def sfn() -> FakeStepFunctions:
    return FakeStepFunctions()


def _answered(sfn: FakeStepFunctions) -> dict[str, list[str]]:
    """The tokens Step Functions was sent: ``done`` (task success) and ``failed`` (task failure ``ViewJobFailed``)."""
    return {'done': sfn.succeeded, 'failed': [failure['taskToken'] for failure in sfn.failed if failure['error'] == VIEW_JOB_FAILED_ERROR]}


def _waiter(table: ConditionalTable, run: ViewJobRun = RUN) -> dict:
    item = table.get_item(Key={'export_id': run.key}).get('Item')
    assert item is not None
    return item


class TestRunFrom:
    def test_reads_the_run_a_chunk_answers(self) -> None:
        assert run_from(RUN.answer()) == RUN

    @pytest.mark.parametrize('value', [None, 'job-1', {'id': 'job-1'}, {'id': '', 'started_at': 'x'}, {'id': 'job-1', 'started_at': 7}])
    def test_refuses_anything_else(self, value: object) -> None:
        assert run_from(value) is None


class TestRegister:
    def test_a_waiting_export_resumes_nothing_yet(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        answer = register_wait(table, sfn, RUN, 'token-a', NOW)

        assert (answer['waiting'], sfn.succeeded, sfn.failed) == (True, [], [])

    def test_every_export_waiting_on_one_run_is_kept(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        _waiting(table, sfn, 'token-a', 'token-b', 'token-c')

        assert _waiter(table)['tokens'] == ['token-a', 'token-b', 'token-c']

    def test_the_waiter_item_is_invisible_to_the_owner_index_and_expires(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        register_wait(table, sfn, RUN, 'token-a', NOW)
        item = _waiter(table)

        assert ('owner' in item, item['expires_at']) == (False, int((NOW + timedelta(hours=24)).timestamp()))

    @pytest.mark.parametrize('status', ['done', 'failed'])
    def test_a_run_that_ended_before_the_token_was_registered_answers_the_export_at_once(self, table: ConditionalTable, sfn: FakeStepFunctions, status: str) -> None:
        finish_view_job(table, sfn, RUN, status, NOW)

        answer = register_wait(table, sfn, RUN, 'token-late', NOW)

        assert (answer['waiting'], _answered(sfn)) == (False, {'done': [], 'failed': [], status: ['token-late']})

    def test_the_end_of_one_run_does_not_resume_an_export_waiting_on_the_next(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        finish_view_job(table, sfn, RUN, 'failed', NOW)

        answer = register_wait(table, sfn, NEXT_RUN, 'token-next', NOW)

        assert (answer['waiting'], sfn.failed) == (True, [])

    def test_a_full_run_fails_the_export_that_would_wait_beyond_it(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        for index in range(MAX_WAITERS):
            register_wait(table, sfn, RUN, f'token-{index}', NOW)

        with pytest.raises(ViewJobWaitError):
            register_wait(table, sfn, RUN, 'token-extra', NOW)

    def test_a_write_that_lost_to_another_writer_reads_again_and_keeps_both_tokens(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        register_wait(table, sfn, RUN, 'token-a', NOW)
        original = table.put_item
        raced: list[bool] = []

        def racing_put(**params: Any) -> dict:
            if not raced:
                raced.append(True)
                current = _waiter(table)
                original(Item={**current, 'tokens': [*current['tokens'], 'token-b'], 'revision': int(current['revision']) + 1})
            return original(**params)

        with patch.object(table, 'put_item', side_effect=racing_put):
            register_wait(table, sfn, RUN, 'token-c', NOW)

        assert _waiter(table)['tokens'] == ['token-a', 'token-b', 'token-c']

    def test_an_item_that_keeps_changing_fails_the_export(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        with patch('shared.export_view_job_wait.applied_conditionally', return_value=False), pytest.raises(ViewJobWaitError):
            register_wait(table, sfn, RUN, 'token-a', NOW)


def _waiting(table: ConditionalTable, sfn: FakeStepFunctions, *tokens: str) -> None:
    """Register ``tokens`` against ``RUN`` in order."""
    for token in tokens:
        register_wait(table, sfn, RUN, token, NOW)


def _refused_once(table: ConditionalTable, sfn: FakeStepFunctions) -> pytest.ExceptionInfo[ClientError]:
    """``token-a`` waits on ``RUN``; finishing it while Step Functions throttles raises (Step Functions answers again after)."""
    _waiting(table, sfn, 'token-a')
    sfn.refusing = 'ThrottlingException'
    with pytest.raises(ClientError) as refused:
        finish_view_job(table, sfn, RUN, 'done', NOW)
    sfn.refusing = None
    return refused


class TestFinish:
    @pytest.mark.parametrize('status', ['done', 'failed'])
    def test_an_ended_run_answers_every_export_waiting_on_it_once(self, table: ConditionalTable, sfn: FakeStepFunctions, status: str) -> None:
        _waiting(table, sfn, 'token-a', 'token-b')

        resumed = finish_view_job(table, sfn, RUN, status, NOW)['resumed']

        assert (_answered(sfn), resumed) == ({'done': [], 'failed': [], status: ['token-a', 'token-b']}, 2)

    def test_a_run_nobody_waits_on_is_marked_finished(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        answer = finish_view_job(table, sfn, RUN, 'done', NOW)

        assert (answer['waiting'], _waiter(table)['finished']) == (0, 'done')

    def test_an_export_whose_wait_already_timed_out_is_skipped(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        _waiting(table, sfn, 'token-timed-out', 'token-b')
        sfn.ended.add('token-timed-out')

        answer = finish_view_job(table, sfn, RUN, 'done', NOW)

        assert (sfn.succeeded, answer['resumed']) == (['token-b'], 1)

    def test_an_event_delivered_twice_resumes_each_export_once(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        _waiting(table, sfn, 'token-a')
        finish_view_job(table, sfn, RUN, 'done', NOW)

        again = finish_view_job(table, sfn, RUN, 'done', NOW)

        assert (sfn.succeeded, again['resumed']) == (['token-a'], 0)

    def test_a_token_step_functions_refuses_raises_so_the_event_is_retried(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        refused = _refused_once(table, sfn)

        assert (refused.value.response.get('Error', {}).get('Code'), sfn.succeeded) == ('ThrottlingException', [])

    def test_the_retry_after_a_refusal_resumes_the_export(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        _refused_once(table, sfn)

        finish_view_job(table, sfn, RUN, 'done', NOW)

        assert sfn.succeeded == ['token-a']

    def test_a_status_other_than_done_or_failed_is_refused(self, table: ConditionalTable, sfn: FakeStepFunctions) -> None:
        with pytest.raises(ValueError, match='done or failed'):
            finish_view_job(table, sfn, RUN, 'computing', NOW)
