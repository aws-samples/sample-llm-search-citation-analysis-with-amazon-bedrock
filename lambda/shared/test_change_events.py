"""``shared.change_events``: thin, best-effort state-change events on the default EventBridge bus."""

from __future__ import annotations

import json
import logging

import pytest
from botocore.exceptions import EndpointConnectionError

from shared import change_events
from shared.change_events import ALL_KINDS, EXPORT_CHANGED, SOURCE_PREFIX, VIEW_JOB_FINISHED, publish_change


def test_publishes_one_entry_with_the_kind_and_compact_sorted_detail(change_events_bus):
    assert publish_change(VIEW_JOB_FINISHED, {'status': 'done', 'job_id': 'abc'}) is True

    assert change_events_bus.entries == [{
        'Source': 'citation-analysis.views',
        'DetailType': 'view-job.finished',
        'Detail': '{"job_id":"abc","status":"done"}',
    }]


def test_details_reads_back_only_the_requested_kind(change_events_bus):
    publish_change(VIEW_JOB_FINISHED, {'job_id': 'a', 'status': 'failed'})
    publish_change(EXPORT_CHANGED, {'export_id': 'e', 'status': 'ready', 'owner_sub': 'u'})

    assert change_events_bus.details(VIEW_JOB_FINISHED) == [{'job_id': 'a', 'status': 'failed'}]


def test_a_refused_entry_is_logged_and_answers_false(change_events_bus, caplog):
    change_events_bus.refuse = True

    with caplog.at_level(logging.WARNING, logger='shared.change_events'):
        assert publish_change(VIEW_JOB_FINISHED, {'job_id': 'a', 'status': 'done'}) is False

    assert 'InternalFailure' in caplog.text


def test_a_client_error_never_raises_into_the_caller(change_events_bus, caplog):
    change_events_bus.error = EndpointConnectionError(endpoint_url='https://events.example')

    with caplog.at_level(logging.WARNING, logger='shared.change_events'):
        assert publish_change(VIEW_JOB_FINISHED, {'job_id': 'a', 'status': 'done'}) is False

    assert 'Could not publish view-job.finished' in caplog.text


def test_a_detail_too_large_for_an_id_only_event_is_refused_before_the_call(change_events_bus):
    assert publish_change(VIEW_JOB_FINISHED, {'job_id': 'x' * change_events.MAX_DETAIL_BYTES}) is False

    assert change_events_bus.entries == []


@pytest.mark.parametrize('kind', ALL_KINDS, ids=lambda kind: kind.detail_type)
def test_every_kind_uses_the_platform_source_prefix(kind):
    assert kind.source.startswith(SOURCE_PREFIX)


def test_kinds_are_unique():
    assert len({(kind.source, kind.detail_type) for kind in ALL_KINDS}) == len(ALL_KINDS)


def test_detail_values_that_are_not_json_are_sent_as_text(change_events_bus):
    publish_change(VIEW_JOB_FINISHED, {'job_id': 'a', 'status': {'done'}})

    assert json.loads(change_events_bus.entries[0]['Detail'])['status'] == "{'done'}"
