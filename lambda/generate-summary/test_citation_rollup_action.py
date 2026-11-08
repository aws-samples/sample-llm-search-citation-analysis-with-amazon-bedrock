"""Tests for GenerateSummary's ``build_citation_rollup`` action."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.request_deadline import current_deadline
from testing.citation_rollup_fixtures import lambda_context
from testing.handler_fixtures import handler_fixture

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {'SUMMARY_BUCKET': '', 'DYNAMODB_TABLE_CITATIONS': 'test-citations'}

summary_module = handler_fixture(_HANDLER_DIR, 'handler.py', 'generate_summary_rollup_under_test', env=_ENV)
action_module = handler_fixture(_HANDLER_DIR, 'citation_rollup_action.py', 'citation_rollup_action_under_test', env=_ENV)


def test_routes_the_rollup_action_to_the_builder(summary_module):
    with patch.object(summary_module, 'build_citation_rollup', return_value={'status': 'built'}) as build:
        result = summary_module.handler({'action': 'build_citation_rollup', 'execution_id': 'run-1'}, None)

    assert (result, build.call_args.args[0]['execution_id']) == ({'status': 'built'}, 'run-1')


def test_builds_under_a_deadline_that_ends_before_the_lambda_timeout(action_module):
    seen: dict[str, Any] = {}

    def fake_build(_sources: Any) -> dict[str, Any]:
        seen['remaining'] = current_deadline().remaining()
        return {'status': 'built'}

    with (
        patch.object(action_module, 'rollup_sources', return_value=MagicMock()),
        patch.object(action_module, 'build_rollup', side_effect=fake_build),
    ):
        action_module.build_citation_rollup({'action': 'build_citation_rollup'}, lambda_context(900_000))

    assert 860 < seen['remaining'] <= 870


def test_refuses_to_build_without_a_bucket(action_module):
    with (
        patch.dict(os.environ, {'CITATION_ROLLUP_BUCKET': '', 'SUMMARY_BUCKET': ''}),
        pytest.raises(action_module.RollupConfigurationError, match='CITATION_ROLLUP_BUCKET or SUMMARY_BUCKET'),
    ):
        action_module.rollup_sources()


def test_a_tenant_the_distributed_build_serves_starts_it_instead_of_building(action_module):
    started = {'status': 'started', 'execution': 'build-1'}
    with (
        patch.dict(os.environ, {'SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN': 'arn:sm'}),
        patch.object(action_module, 'snapshot_sources', return_value=MagicMock()),
        patch.object(action_module, 'start_distributed_build', return_value=started),
        patch.object(action_module, 'build_rollup') as build,
    ):
        result = action_module.build_citation_rollup({'action': 'build_citation_rollup'}, lambda_context(900_000))
    assert (result, build.call_count) == (started, 0)


def test_without_the_state_machine_the_rollup_builds_in_process(action_module):
    with (
        patch.dict(os.environ, {'SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN': ''}),
        patch.object(action_module, 'start_distributed_build') as start,
        patch.object(action_module, 'rollup_sources', return_value=MagicMock()),
        patch.object(action_module, 'build_rollup', return_value={'status': 'built'}),
    ):
        result = action_module.build_citation_rollup({'action': 'build_citation_rollup'}, lambda_context(900_000))
    assert (result, start.call_count) == ({'status': 'built'}, 0)
