"""The export worker Lambda: action dispatch and the chunk deadline."""

from __future__ import annotations

from collections.abc import Iterator
from types import ModuleType, SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared import request_deadline
from testing.export_fixtures import ExportHarness, citations_source, export_handler_fixture

worker = export_handler_fixture(__file__, 'handler.py', 'export_worker_handler')

_FULL_LAMBDA = SimpleNamespace(get_remaining_time_in_millis=lambda: 900_000)


@pytest.fixture
def harness(worker: ModuleType) -> Iterator[ExportHarness]:
    harness = ExportHarness(citations_source(5))
    with (
        patch.object(worker, 's3', harness.s3),
        patch.object(worker, 'exports_table', harness.table),
        patch.object(worker, 'export_sources', return_value={harness.source.view: harness.source}),
    ):
        yield harness


def _steps(worker: ModuleType, export_id: str, *actions: str) -> Any:
    """Run ``actions`` in order; the last one's answer."""
    answer = None
    for action in actions:
        answer = worker.handler({'action': action, 'export_id': export_id}, _FULL_LAMBDA)
    return answer


class TestDispatch:
    def test_prepare_marks_the_export_running(self, worker: ModuleType, harness: ExportHarness) -> None:
        export_id = harness.queue('csv')
        _steps(worker, export_id, 'prepare')

        assert harness.item(export_id)['status'] == 'running'

    def test_chunk_writes_every_row_and_answers_done(self, worker: ModuleType, harness: ExportHarness) -> None:
        export_id = harness.queue('xlsx')

        assert _steps(worker, export_id, 'prepare', 'chunk') == {'export_id': export_id, 'done': True}

    def test_finalize_marks_the_export_ready(self, worker: ModuleType, harness: ExportHarness) -> None:
        export_id = harness.queue('csv')
        _steps(worker, export_id, 'prepare', 'chunk', 'finalize')

        assert harness.item(export_id)['status'] == 'ready'

    def test_fail_marks_the_export_failed_with_the_caught_error_type(self, worker: ModuleType, harness: ExportHarness) -> None:
        export_id = harness.queue('csv')
        worker.handler({'action': 'fail', 'export_id': export_id, 'error': {'Error': 'Lambda.Unknown', 'Cause': 'x'}}, _FULL_LAMBDA)

        assert harness.item(export_id)['error'].startswith('The export failed (Lambda.Unknown)')

    @pytest.mark.usefixtures('harness')
    def test_refuses_an_unknown_action(self, worker: ModuleType) -> None:
        with pytest.raises(ValueError, match="unknown export action 'explode'"):
            _steps(worker, 'exp-1', 'explode')

    def test_refuses_an_event_without_an_export_id(self, worker: ModuleType) -> None:
        with pytest.raises(ValueError, match='needs an action and an export_id'):
            worker.handler({'action': 'chunk'}, _FULL_LAMBDA)


class TestChunkDeadline:
    def test_keeps_the_reserve_seconds_before_the_lambda_timeout(self, worker: ModuleType) -> None:
        assert worker.chunk_deadline(_FULL_LAMBDA).remaining() == pytest.approx(840, abs=1)

    def test_never_drops_under_the_minimum_budget(self, worker: ModuleType) -> None:
        context = SimpleNamespace(get_remaining_time_in_millis=lambda: 30_000)

        assert worker.chunk_deadline(context).remaining() == pytest.approx(worker.MIN_CHUNK_SECONDS, abs=1)

    def test_is_cleared_when_the_chunk_returns(self, worker: ModuleType, harness: ExportHarness) -> None:
        _steps(worker, harness.queue('csv'), 'prepare', 'chunk')

        assert request_deadline.active_deadline() is None


class TestOwnerGroups:
    """The worker reads an owner's groups from Cognito for the Admin re-check (review F12)."""

    def test_reads_every_page_of_the_users_groups(self, worker: ModuleType) -> None:
        cognito = MagicMock()
        cognito.admin_list_groups_for_user.side_effect = [
            {'Groups': [{'GroupName': 'Users'}], 'NextToken': 'page-2'}, {'Groups': [{'GroupName': 'Admin'}]},
        ]
        with patch.object(worker, '_cognito', return_value=cognito), patch.dict('os.environ', {'USER_POOL_ID': 'eu-west-1_pool'}):
            assert worker.owner_groups('ana@example.com') == frozenset({'Users', 'Admin'})

    def test_a_user_cognito_no_longer_knows_has_no_groups(self, worker: ModuleType) -> None:
        cognito = MagicMock()
        cognito.exceptions.UserNotFoundException = _UserNotFound
        cognito.admin_list_groups_for_user.side_effect = _UserNotFound()
        with patch.object(worker, '_cognito', return_value=cognito), patch.dict('os.environ', {'USER_POOL_ID': 'eu-west-1_pool'}):
            assert worker.owner_groups('gone@example.com') == frozenset()

    def test_without_a_user_pool_the_groups_cannot_be_checked(self, worker: ModuleType) -> None:
        with patch.dict('os.environ', {'USER_POOL_ID': ''}):
            assert worker.groups_lookup() is None


class _UserNotFound(Exception):
    """Cognito's ``UserNotFoundException``."""
