"""Which channel hears which event, and that a message carries the route's ids and status only."""

from __future__ import annotations

import pytest
from live_channel_routes import ROUTES, channel_message, is_channel_segment

from shared.change_events import (
    EXPORT_CHANGED,
    NARRATIVE_FINISHED,
    RESEARCH_JOB_CHANGED,
    SELF_REFLECTION_FINISHED,
    VIEW_JOB_FINISHED,
)
from testing.live_events_fixtures import (
    OWNER_SUB,
    PUBLISHED_KINDS,
    RESEARCH,
    STATE_MACHINE_TOPICS,
    WORKFLOW,
    WORKFLOW_KEYWORD_FINISHED,
    change_event,
    execution_status_event,
)


@pytest.mark.parametrize('kind', [*PUBLISHED_KINDS, WORKFLOW_KEYWORD_FINISHED], ids=lambda kind: kind.detail_type)
def test_every_published_kind_has_a_route(kind):
    assert (kind.source, kind.detail_type) in ROUTES


def test_a_deployment_event_goes_to_its_topic_with_only_the_route_fields():
    event = change_event(VIEW_JOB_FINISHED, {'job_id': 'j1', 'status': 'done', 'result': {'rows': [1, 2]}})

    routed = channel_message(event, STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.channel == '/deployment/view-jobs'
    assert routed.message == {'type': 'view-job.finished', 'job_id': 'j1', 'status': 'done'}


def test_an_owner_only_event_goes_to_the_owners_channel_without_the_owner_in_the_message():
    event = change_event(EXPORT_CHANGED, {'export_id': 'x1', 'status': 'ready', 'owner_sub': OWNER_SUB})

    routed = channel_message(event, STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.channel == f'/user/{OWNER_SUB}/exports'
    assert routed.message == {'type': 'export.changed', 'export_id': 'x1', 'status': 'ready'}


@pytest.mark.parametrize('owner', [None, '', '*', 'a/b', 'x' * 51, 42, '-starts-with-dash'])
def test_an_owner_only_event_without_a_valid_owner_is_heard_by_nobody(owner):
    detail = {'export_id': 'x1', 'status': 'ready'}
    if owner is not None:
        detail['owner_sub'] = owner

    assert channel_message(change_event(EXPORT_CHANGED, detail), STATE_MACHINE_TOPICS) is None


def test_fields_that_are_not_short_scalars_are_left_out():
    detail = {'keyword': 'k' * 600, 'brand': ['a'], 'query_prompt_id': True, 'status': 'done'}

    routed = channel_message(change_event(SELF_REFLECTION_FINISHED, detail), STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.message == {'type': 'self-reflection.finished', 'status': 'done'}


def test_two_kinds_can_share_a_topic_and_keep_their_type():
    routed = channel_message(change_event(NARRATIVE_FINISHED, {'group_id': 'g', 'market_id': 'es-CL'}), STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.channel == '/deployment/insights'
    assert routed.message['type'] == 'narrative.finished'


def test_a_status_change_of_a_known_state_machine_goes_to_its_topic_without_input_or_output():
    routed = channel_message(execution_status_event(WORKFLOW, 'SUCCEEDED', {'keywords': ['secret']}), STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.channel == '/deployment/runs'
    assert routed.message == {
        'type': 'execution.status', 'state_machine': WORKFLOW, 'status': 'SUCCEEDED', 'name': 'run-1',
        'executionArn': f'arn:aws:states:us-east-1:123456789012:execution:{WORKFLOW}:run-1',
    }


def test_a_research_execution_names_its_job_from_the_input():
    routed = channel_message(execution_status_event(RESEARCH, 'TIMED_OUT', {'job_id': 'job-7', 'round': 1}), STATE_MACHINE_TOPICS)

    assert routed is not None
    assert routed.channel == '/deployment/research'
    assert routed.message['job_id'] == 'job-7'


@pytest.mark.parametrize('execution_input', ['not json', ['job_id'], {'job_id': 7}])
def test_an_input_without_a_job_id_adds_none(execution_input):
    event = execution_status_event(RESEARCH, 'FAILED')
    event['detail']['input'] = execution_input if isinstance(execution_input, str) else str(execution_input)

    routed = channel_message(event, STATE_MACHINE_TOPICS)

    assert routed is not None
    assert 'job_id' not in routed.message


def test_a_status_change_of_another_state_machine_is_dropped():
    assert channel_message(execution_status_event('SomeoneElses-Machine', 'RUNNING'), STATE_MACHINE_TOPICS) is None


@pytest.mark.parametrize('event', [
    {'source': 'citation-analysis.unknown', 'detail-type': 'thing.changed', 'detail': {}},
    {'source': RESEARCH_JOB_CHANGED.source, 'detail-type': RESEARCH_JOB_CHANGED.detail_type, 'detail': 'job'},
    {'source': None, 'detail-type': None, 'detail': {}},
    {},
], ids=['unknown kind', 'detail not an object', 'no source', 'empty'])
def test_anything_else_is_dropped(event):
    assert channel_message(event, STATE_MACHINE_TOPICS) is None


@pytest.mark.parametrize(('value', 'valid'), [
    (OWNER_SUB, True), ('a', True), ('a' * 50, True), ('a' * 51, False), ('a-', False), ('a_b', False), (None, False),
])
def test_channel_segments_follow_the_appsync_rule(value, valid):
    assert is_channel_segment(value) is valid
