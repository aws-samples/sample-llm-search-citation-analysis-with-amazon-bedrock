"""The view-job.finished event: its shape, its publishing, and when a view job publishes it."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.scope_params import ReportScope
from shared.scope_snapshot import job_result_key
from shared.view_job_events import DETAIL_TYPE, SOURCE, finished_entry, publish_finished
from shared.view_jobs import JobRequest, read_status, run_view_job, start_job
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, RecordingLambda
from testing.snapshot_fakes import ConditionalS3
from testing.view_job_event_fixtures import VIEW_JOB_EVENT_NAMES

_NOW = datetime(2026, 11, 6, 8, 0, tzinfo=UTC)
_SCOPE = ReportScope(kind='all', keywords=('hotel coruña',), scope={'mode': 'all'}, label='All keywords')
_JOB = 'job-1'


class _ResultRefusingS3(ConditionalS3):
    """A bucket that refuses to store a job's result (statuses are stored)."""

    def put_object(self, **params: Any) -> dict[str, Any]:
        if params['Key'] == job_result_key(_JOB):
            raise ClientError({'Error': {'Code': 'SlowDown', 'Message': 'x'}}, 'PutObject')
        return super().put_object(**params)


def _started(s3: ConditionalS3) -> str:
    """Start ``_JOB`` for route ``visibility``; its run's ``started_at``."""
    return str(start_job(s3, SNAPSHOT_BUCKET, RecordingLambda(), 'generate-summary', _JOB, JobRequest('visibility', {}, _SCOPE), _NOW)['started_at'])


def _run(s3: ConditionalS3, computers: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, str]]]:
    heard: list[tuple[str, str, str]] = []
    summary = run_view_job(s3, SNAPSHOT_BUCKET, _JOB, computers=computers, notify=lambda *outcome: heard.append(outcome))
    return summary, heard


class TestEntry:
    def test_names_the_source_and_detail_type_the_rule_matches(self) -> None:
        assert (SOURCE, DETAIL_TYPE) == (VIEW_JOB_EVENT_NAMES['source'], VIEW_JOB_EVENT_NAMES['detail_type'])

    def test_carries_the_job_its_run_and_the_outcome_on_the_default_bus(self) -> None:
        entry = finished_entry(_JOB, '2026-11-06T08:00:00Z', 'done')

        assert ('EventBusName' in entry, json.loads(entry['Detail'])) == (
            False, {'job_id': _JOB, 'started_at': '2026-11-06T08:00:00Z', 'status': 'done'},
        )


class TestPublish:
    def test_an_accepted_event_is_published(self) -> None:
        events = MagicMock()
        events.put_events.return_value = {'FailedEntryCount': 0, 'Entries': [{'EventId': 'e-1'}]}

        assert publish_finished(events, _JOB, 'x', 'done') is True

    def test_an_entry_eventbridge_refuses_is_reported_not_raised(self) -> None:
        events = MagicMock()
        events.put_events.return_value = {'FailedEntryCount': 1, 'Entries': [{'ErrorCode': 'InternalFailure'}]}

        assert publish_finished(events, _JOB, 'x', 'done') is False

    def test_a_failed_call_is_reported_not_raised(self) -> None:
        events = MagicMock()
        events.put_events.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException', 'Message': 'x'}}, 'PutEvents')

        assert publish_finished(events, _JOB, 'x', 'failed') is False


class TestViewJobPublishes:
    def test_a_job_that_stored_its_result_says_done_after_storing_it(self) -> None:
        s3 = ConditionalS3()
        _started(s3)
        stored_before: list[bool] = []

        run_view_job(s3, SNAPSHOT_BUCKET, _JOB, computers={'visibility': lambda _request, _context: {'rows': []}},
                     notify=lambda *_outcome: stored_before.append(job_result_key(_JOB) in s3.objects))

        assert stored_before == [True]

    def test_a_job_that_stored_its_result_names_its_run(self) -> None:
        s3 = ConditionalS3()
        started_at = _started(s3)

        _, heard = _run(s3, {'visibility': lambda _request, _context: {'rows': []}})

        assert heard == [(_JOB, started_at, 'done')]

    def test_a_job_that_failed_says_failed_after_storing_its_status(self) -> None:
        s3 = ConditionalS3()
        started_at = _started(s3)

        summary, heard = _run(s3, {})
        status = read_status(s3, SNAPSHOT_BUCKET, _JOB)

        assert (summary['status'], status and status['status'], heard) == ('failed', 'failed', [(_JOB, started_at, 'failed')])

    def test_a_job_whose_result_could_not_be_stored_says_failed(self) -> None:
        s3 = _ResultRefusingS3()
        started_at = _started(s3)
        heard: list[tuple[str, str, str]] = []

        with pytest.raises(ClientError):
            run_view_job(s3, SNAPSHOT_BUCKET, _JOB, computers={'visibility': lambda _request, _context: {'rows': []}}, notify=lambda *outcome: heard.append(outcome))

        assert heard == [(_JOB, started_at, 'failed')]

    def test_a_skipped_job_says_nothing(self) -> None:
        summary, heard = _run(ConditionalS3(), {})

        assert (summary['status'], heard) == ('skipped', [])
