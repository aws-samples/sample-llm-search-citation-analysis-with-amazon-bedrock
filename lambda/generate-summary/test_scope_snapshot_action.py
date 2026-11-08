"""Tests for the GenerateSummary actions that build the scope snapshots and run view jobs (``scope_snapshot_action``)."""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.request_deadline import Deadline
from shared.scope_series_build import SeriesBuildIncomplete
from shared.snapshot_store import SnapshotBuildIncomplete
from shared.view_job_routes import JobResources
from testing.citation_rollup_fixtures import lambda_context
from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))
_BUCKET = {'SCOPE_SNAPSHOT_BUCKET': 'keywords-bucket'}


_ENV = {'SUMMARY_BUCKET': '', 'DYNAMODB_TABLE_CITATIONS': 'test-citations'}
_STATE_MACHINE = 'arn:aws:states:eu-west-1:123456789012:stateMachine:CitationAnalysis-ScopeSnapshotBuild'


@pytest.fixture(scope='module')
def summary():
    with patch.dict(os.environ, _ENV):
        return load_handler_module(_HERE, 'handler.py', 'generate_summary_scope_actions_under_test')


@pytest.fixture(scope='module')
def actions():
    with patch.dict(os.environ, _ENV):
        return load_handler_module(_HERE, 'scope_snapshot_action.py', 'scope_snapshot_action_under_test')


@pytest.mark.parametrize(('event', 'entry_point'), [
    ({'action': 'build_scope_snapshots', 'execution_id': 'run-1'}, 'build_scope_snapshots'),
    ({'action': 'view_job', 'job_id': 'job-1'}, 'view_job'),
])
def test_the_handler_routes_each_action_to_its_entry_point(summary, event, entry_point):
    with patch.object(summary, entry_point, return_value={'status': 'ok'}) as called:
        summary.handler(event, None)
    assert called.call_args.args[0] == event


def test_the_build_deadline_ends_thirty_seconds_before_the_lambda_timeout(actions):
    sources = MagicMock(name='snapshot_sources')
    with patch.object(actions, 'snapshot_sources', sources), patch.object(actions, 'build_snapshots', return_value={'status': 'built'}):
        actions.build_scope_snapshots({'action': 'build_scope_snapshots'}, lambda_context(900_000))
    assert 860 < sources.call_args.args[0].remaining() <= 870


def _cut_series_build(actions: Any, event: dict[str, Any], scopes_saved: int) -> tuple[dict[str, Any], MagicMock]:
    """``build_scope_snapshots`` when the series step runs out of time after saving ``scopes_saved`` scopes, and the Lambda client it used."""
    client = MagicMock()
    context = MagicMock(invoked_function_arn='arn:aws:lambda:us-west-2:123456789012:function:CitationAnalysis-GenerateSummary')
    context.get_remaining_time_in_millis.return_value = 900_000
    with (
        patch.object(actions, 'snapshot_sources', MagicMock()),
        patch.object(actions, 'build_snapshots', side_effect=SeriesBuildIncomplete('out of time', scopes_saved)),
        patch.object(actions.boto3, 'client', return_value=client),
    ):
        return actions.build_scope_snapshots(event, context), client


class TestSeriesResume:
    def test_a_build_cut_after_saving_scopes_answers_incomplete(self, actions):
        summary, _ = _cut_series_build(actions, {'action': 'build_scope_snapshots'}, 3)
        assert (summary['status'], summary['series_saved'], summary['resumed']) == ('incomplete', 3, True)

    def test_a_build_cut_after_saving_scopes_starts_the_next_build(self, actions):
        _, client = _cut_series_build(actions, {'action': 'build_scope_snapshots', 'series_resumes': 2}, 3)
        call = client.invoke.call_args.kwargs
        assert (call['InvocationType'], json.loads(call['Payload'])) == (
            'Event', {'action': 'build_scope_snapshots', 'reason': 'resume the scope series', 'series_resumes': 3},
        )

    def test_the_resumes_stop_after_the_limit(self, actions):
        summary, client = _cut_series_build(actions, {'action': 'build_scope_snapshots', 'series_resumes': actions.MAX_SERIES_RESUMES}, 3)
        assert (summary['resumed'], client.invoke.call_count) == (False, 0)

    def test_a_build_cut_before_saving_any_scope_fails(self, actions):
        with pytest.raises(SeriesBuildIncomplete, match='out of time'):
            _cut_series_build(actions, {'action': 'build_scope_snapshots'}, 0)


def _sources_from_env(actions: Any, env: dict[str, str], event: dict[str, Any] | None = None) -> Any:
    with (
        patch.dict(os.environ, {**_BUCKET, 'DYNAMODB_TABLE_KEYWORD_RUN_KPIS': '', **env}),
        patch.object(actions, 'scoped_dynamodb_resource', return_value=MagicMock()),
        patch.object(actions, 'get_brand_config', return_value={}),
        patch.object(actions, 'query_prompts_table', return_value=None),
    ):
        return actions.snapshot_sources(Deadline(60), event)


class TestKeywordsBehind:
    def test_the_build_checks_each_keywords_newest_run_where_search_results_is_set(self, actions):
        sources = _sources_from_env(actions, {'DYNAMODB_TABLE_SEARCH_RESULTS': 'search-results'})
        assert (sources.newest_run is not None, sources.request_backfill is not None) == (True, True)

    def test_nothing_is_checked_without_search_results(self, actions):
        assert _sources_from_env(actions, {'DYNAMODB_TABLE_SEARCH_RESULTS': ''}).newest_run is None

    def test_a_build_the_backfill_started_asks_for_no_backfill(self, actions):
        sources = _sources_from_env(actions, {'DYNAMODB_TABLE_SEARCH_RESULTS': 'search-results'}, {'reason': actions.BACKFILL_BUILD_REASON})
        assert sources.request_backfill is None


@pytest.fixture
def ran_view_job(actions):
    """The ``run_view_job`` call a ``view_job`` event for job ``job-7`` made."""
    with (
        patch.dict(os.environ, _BUCKET), patch.object(actions, '_s3', return_value='s3'),
        patch.object(actions, 'job_resources', return_value=JobResources(None, [])),
        patch.object(actions, 'run_view_job', return_value={}) as run,
    ):
        actions.view_job({'action': 'view_job', 'job_id': 'job-7'}, lambda_context(900_000))
    return run.call_args


def test_a_view_job_runs_the_job_it_names(ran_view_job):
    assert ran_view_job.args == ('s3', 'keywords-bucket', 'job-7')


def test_a_view_job_computes_with_every_routes_computation(ran_view_job):
    assert {'trends', 'reports-overview', 'group-kpis', 'visibility', 'recommendations', 'brand-mentions'} <= set(ran_view_job.kwargs['computers'])


def test_job_resources_read_no_history_and_no_rows_where_the_tables_are_not_set(actions):
    environment = {**_BUCKET, 'DYNAMODB_TABLE_KEYWORD_RUN_KPIS': '', 'DYNAMODB_TABLE_SEARCH_RESULTS': ''}
    with (
        patch.dict(os.environ, environment),
        patch.object(actions, 'scoped_dynamodb_resource', return_value=MagicMock()),
        patch.object(actions, 'get_brand_config', return_value={'owned_domains': ['hotel-coruna-mar.es']}),
    ):
        resources = actions.job_resources(Deadline(60))
    assert (resources.history, resources.mention_readers) == (None, None)


def test_a_view_job_without_an_id_is_skipped(actions):
    assert actions.view_job({'action': 'view_job'}, None) == {'status': 'skipped', 'reason': 'no job_id'}


def test_no_history_is_read_where_the_rollup_table_is_not_deployed(actions):
    sources = _sources_from_env(actions, {})
    assert (sources.bucket, sources.history, sources.personas) == ('keywords-bucket', None, ())


def test_building_without_a_bucket_is_refused(actions):
    with (
        patch.dict(os.environ, {'SCOPE_SNAPSHOT_BUCKET': '', 'SUMMARY_BUCKET': ''}),
        patch.object(actions, 'scoped_dynamodb_resource', return_value=MagicMock()),
        pytest.raises(actions.SnapshotConfigurationError, match='SCOPE_SNAPSHOT_BUCKET or SUMMARY_BUCKET'),
    ):
        actions.snapshot_sources(Deadline(60))


@pytest.fixture(scope='module')
def steps():
    with patch.dict(os.environ, _ENV):
        return load_handler_module(_HERE, 'snapshot_build_steps.py', 'snapshot_build_steps_under_test')


def _build_with(
    actions: Any, *, heavy: bool, running: list[dict[str, str]] | None = None, env: str = _STATE_MACHINE,
    event: dict[str, Any] | None = None, start_error: Exception | None = None,
) -> tuple[dict[str, Any], MagicMock]:
    client = MagicMock()
    client.list_executions.return_value = {'executions': running or []}
    client.start_execution.return_value = {'executionArn': f'{_STATE_MACHINE}:build-1'}
    client.start_execution.side_effect = start_error
    with (
        patch.dict(os.environ, {'SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN': env}),
        patch.object(actions, 'snapshot_sources', MagicMock()),
        patch.object(actions, 'needs_distribution', return_value=heavy),
        patch.object(actions, 'build_snapshots', return_value={'status': 'built'}),
        patch.object(actions.boto3, 'client', return_value=client),
    ):
        request = event or {'action': 'build_scope_snapshots', 'reason': 'stale'}
        return actions.build_scope_snapshots(request, lambda_context(900_000)), client


_RUN_EVENT = {'action': 'build_scope_snapshots', 'execution_id': 'arn:aws:states:eu-west-1:123456789012:execution:CitationAnalysis-Workflow:run-7'}


class TestRouting:
    def test_a_workflow_run_starts_the_build_under_a_name_of_that_run(self, actions):
        _, client = _build_with(actions, heavy=True, event=_RUN_EVENT)
        assert client.start_execution.call_args.kwargs['name'] == actions._execution_name(_RUN_EVENT)

    def test_the_rollup_and_snapshot_requests_of_one_run_send_the_same_input(self, actions):
        _, client = _build_with(actions, heavy=True, event={**_RUN_EVENT, 'action': 'build_citation_rollup'})
        assert json.loads(client.start_execution.call_args.kwargs['input']) == {'reason': f"run {_RUN_EVENT['execution_id']}"}

    def test_a_build_of_that_run_already_started_answers_running(self, actions):
        exists = ClientError({'Error': {'Code': 'ExecutionAlreadyExists', 'Message': 'exists'}}, 'StartExecution')
        result, _ = _build_with(actions, heavy=True, event=_RUN_EVENT, start_error=exists)
        assert result == {'status': 'running', 'execution': actions._execution_name(_RUN_EVENT)}

    def test_a_heavy_build_starts_the_state_machine_with_its_reason(self, actions):
        _, client = _build_with(actions, heavy=True)
        assert json.loads(client.start_execution.call_args.kwargs['input']) == {'reason': 'stale'}

    def test_a_heavy_build_answers_started(self, actions):
        assert _build_with(actions, heavy=True)[0] == {'status': 'started', 'execution': f'{_STATE_MACHINE}:build-1'}

    def test_a_heavy_build_while_one_runs_starts_none(self, actions):
        result, client = _build_with(actions, heavy=True, running=[{'executionArn': 'running-1'}])
        assert (result, client.start_execution.call_count) == ({'status': 'running', 'execution': 'running-1'}, 0)

    def test_a_light_build_runs_in_process(self, actions):
        assert _build_with(actions, heavy=False)[0] == {'status': 'built'}

    def test_without_the_state_machine_every_build_runs_in_process(self, actions):
        assert _build_with(actions, heavy=True, env='')[0] == {'status': 'built'}

    @pytest.mark.parametrize('action', [
        'snapshot_build_plan', 'snapshot_build_unit', 'snapshot_build_series', 'snapshot_build_rollup_shard', 'snapshot_build_rollup_merge',
        'snapshot_build_publish',
    ])
    def test_the_handler_routes_every_step_to_build_step(self, summary, action):
        with patch.object(summary, 'build_step', return_value={}) as called:
            summary.handler({'action': action, 'build_id': 'b'}, None)
        assert called.call_args.args[0] == {'action': action, 'build_id': 'b'}


class TestSteps:
    def test_the_plan_passes_the_reason_on(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'plan_build', return_value={'build_id': 'b'}):
            assert steps.build_step({'action': 'snapshot_build_plan', 'reason': 'stale'}, lambda_context(900_000)) == {'build_id': 'b', 'reason': 'stale'}

    def test_a_unit_runs_the_item_it_names(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'run_unit', return_value={}) as run:
            steps.build_step({'action': 'snapshot_build_unit', 'build_id': 'b', 'unit': 7}, lambda_context(900_000))
        assert run.call_args.args[1:] == ('b', 7)

    def test_a_rollup_shard_runs_the_shard_it_names(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'run_rollup_shard_step', return_value={}) as run:
            steps.build_step({'action': 'snapshot_build_rollup_shard', 'build_id': 'b', 'shard': 3}, lambda_context(900_000))
        assert run.call_args.args[1:] == ('b', 3)

    def test_a_rollup_merge_runs_the_item_it_names(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'run_rollup_merge_step', return_value={}) as run:
            steps.build_step({'action': 'snapshot_build_rollup_merge', 'build_id': 'b', 'merge': 2}, lambda_context(900_000))
        assert run.call_args.args[1:] == ('b', 2)

    def test_a_series_turn_counts_the_turns(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'run_series', return_value={'done': False}):
            assert steps.build_step({'action': 'snapshot_build_series', 'build_id': 'b', 'batch': 1, 'turn': 2}, lambda_context(900_000)) == {'done': False, 'turn': 3}

    def test_a_series_turn_stops_at_the_turn_budget(self, steps):
        with patch.object(steps, 'snapshot_sources', MagicMock()), patch.object(steps, 'run_series', return_value={'done': False}) as run:
            steps.build_step({'action': 'snapshot_build_series', 'build_id': 'b', 'batch': 4}, lambda_context(900_000))
        assert (run.call_args.args[2], 0 < run.call_args.args[3].remaining() <= steps.SERIES_TURN_SECONDS) == (4, True)

    def test_a_build_past_the_last_series_turn_fails(self, steps):
        with pytest.raises(SnapshotBuildIncomplete, match='more than'):
            steps.build_step({'action': 'snapshot_build_series', 'build_id': 'b', 'turn': steps.MAX_SERIES_TURNS}, lambda_context(900_000))

    def test_a_step_without_a_build_id_fails(self, steps):
        with pytest.raises(SnapshotBuildIncomplete, match='needs a build_id'):
            steps.build_step({'action': 'snapshot_build_unit', 'unit': 0}, lambda_context(900_000))

    def test_an_unknown_step_fails(self, steps):
        with pytest.raises(SnapshotBuildIncomplete, match='Not a scope snapshot build step'):
            steps.build_step({'action': 'snapshot_build_other', 'build_id': 'b'}, lambda_context(900_000))
