"""``shared.change_events``: thin, best-effort state-change events on the default EventBridge bus."""

from __future__ import annotations

import json
import logging

import pytest
from botocore.exceptions import EndpointConnectionError

from shared import change_events
from shared.change_events import CONTENT_CHANGED, EXPORT_CHANGED, SOURCE_PREFIX, ChangeKind, publish_change
from testing.live_events_fixtures import PUBLISHED_KINDS


def test_publishes_one_entry_with_the_kind_and_compact_sorted_detail(change_events_bus):
    assert publish_change(CONTENT_CHANGED, {'status': 'done', 'content_id': 'abc'}) is True

    assert change_events_bus.entries == [{
        'Source': 'citation-analysis.content-studio',
        'DetailType': 'content.changed',
        'Detail': '{"content_id":"abc","status":"done"}',
    }]


def test_details_reads_back_only_the_requested_kind(change_events_bus):
    publish_change(CONTENT_CHANGED, {'content_id': 'a', 'status': 'failed'})
    publish_change(EXPORT_CHANGED, {'export_id': 'e', 'status': 'ready', 'owner_sub': 'u'})

    assert change_events_bus.details(CONTENT_CHANGED) == [{'content_id': 'a', 'status': 'failed'}]


@pytest.mark.parametrize(('failure', 'logged'), [
    ({'refuse': True}, 'EventBridge refused content.changed: InternalFailure'),
    ({'error': EndpointConnectionError(endpoint_url='https://events.example')}, 'Could not publish content.changed'),
], ids=['refused entry', 'client error'])
def test_a_failed_publish_is_logged_and_never_raises_into_the_caller(change_events_bus, caplog, failure, logged):
    for name, value in failure.items():
        setattr(change_events_bus, name, value)

    with caplog.at_level(logging.WARNING, logger='shared.change_events'):
        assert publish_change(CONTENT_CHANGED, {'content_id': 'a', 'status': 'done'}) is False

    assert logged in caplog.text


def test_a_detail_too_large_for_an_id_only_event_is_refused_before_the_call(change_events_bus):
    assert publish_change(CONTENT_CHANGED, {'content_id': 'x' * change_events.MAX_DETAIL_BYTES}) is False

    assert change_events_bus.entries == []


@pytest.mark.parametrize('kind', PUBLISHED_KINDS, ids=lambda kind: kind.detail_type)
def test_every_kind_uses_the_platform_source_prefix(kind):
    assert kind.source.startswith(SOURCE_PREFIX)


def test_a_kind_outside_the_platform_prefix_is_refused():
    with pytest.raises(ValueError, match='does not start with'):
        ChangeKind('aws.states', 'run.step.finished')


def test_kinds_are_unique():
    assert len(PUBLISHED_KINDS) == 9
    assert len({(kind.source, kind.detail_type) for kind in PUBLISHED_KINDS}) == len(PUBLISHED_KINDS)


def test_detail_values_that_are_not_json_are_sent_as_text(change_events_bus):
    publish_change(CONTENT_CHANGED, {'content_id': 'a', 'status': {'done'}})

    assert json.loads(change_events_bus.entries[0]['Detail'])['status'] == "{'done'}"
