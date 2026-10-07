"""Worker-level tests for complete-run snapshot and alert behavior."""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS
from shared.kpi_engine import Answer, answers_from_rows
from testing.dynamodb_stubs import conditional_check_failure, fake_dynamodb_resource
from testing.handler_fixtures import handler_fixture
from testing.map_run_fixtures import RESULTS_BUCKET, fake_s3_objects
from testing.search_result_fixtures import successful_answer_row

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_SUMMARY_HANDLER_DIR = os.path.join(os.path.dirname(_HANDLER_DIR), 'generate-summary')
_RUN_TIMESTAMP = '2026-10-01T10:00:00Z'
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'search',
    'DYNAMODB_TABLE_KEYWORDS': 'keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'groups',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'brand-config',
    'DYNAMODB_TABLE_KPI_SNAPSHOTS': 'snapshots',
    'DYNAMODB_TABLE_KPI_ALERTS': 'alerts',
    'DYNAMODB_TABLE_ALERT_SETTINGS': 'settings',
    'DYNAMODB_TABLE_CONTENT_CHANGES': 'changes',
    'KPI_ALERTS_TOPIC_ARN': 'arn:aws:sns:us-east-1:123456789012:kpi-alerts',
}

worker_module = handler_fixture(
    _HANDLER_DIR,
    'handler.py',
    'kpi_alert_worker_under_test',
    env=_ENV,
)
summary_module = handler_fixture(
    _SUMMARY_HANDLER_DIR,
    'handler.py',
    'generate_summary_for_kpi_alerts_under_test',
    env={},
)


def _event(status: str = 'completed') -> dict:
    return {
        'execution_id': 'exec-1',
        'execution_input': {'scope': {'mode': 'all'}},
        'report': {
            'execution_id': 'exec-1',
            'timestamp': '2026-10-01T10:05:00Z',
            'status': status,
            'run_metadata': {
                'timestamp': _RUN_TIMESTAMP,
                'timestamps': [_RUN_TIMESTAMP],
                'processed_keywords': [
                    {'keyword': 'shared keyword', 'timestamp': _RUN_TIMESTAMP},
                ],
            },
        },
    }


def _row(provider: str, *brands: tuple[str, str, int]) -> dict:
    """One engine answer to the shared keyword in the evaluated run."""
    return successful_answer_row(
        keyword='shared keyword',
        timestamp=_RUN_TIMESTAMP,
        provider=provider,
        brands=brands,
        citations=['https://hotel-mine.com/rooms'],
    )


def _answers() -> list[Answer]:
    """Two answers: the hotel 2nd behind the rival, then the rival alone."""
    return answers_from_rows([
        _row('openai', ('Rival', 'competitor', 1), ('Hotel Mine', 'first_party', 2)),
        _row('gemini', ('Rival', 'competitor', 3)),
    ])


def _single_group_tables() -> tuple[MagicMock, MagicMock, MagicMock]:
    snapshots = MagicMock()
    alerts = MagicMock()
    resource = fake_dynamodb_resource(by_name={
        'snapshots': snapshots,
        'alerts': alerts,
    })
    return snapshots, alerts, resource


_ALERTS_DISABLED = {**DEFAULT_ALERT_SETTINGS, 'enabled': False}
_EMAIL_SETTINGS = {**DEFAULT_ALERT_SETTINGS, 'notification_emails': ['ops@example.com']}
_SHARED_KEYWORD_IN_TWO_GROUPS = [{
    'id': 'keyword-1',
    'keyword': 'shared keyword',
    'group_ids': {'group-1', 'group-2'},
}]


def _complete_group_patches(
    worker_module,
    resource: MagicMock,
    settings: dict,
    answers: list[Answer] | None,
):
    return patch.multiple(
        worker_module,
        query_active_keywords=MagicMock(return_value=[{
            'id': 'keyword-1',
            'keyword': 'shared keyword',
            'group_ids': {'group-1'},
        }]),
        _load_groups=MagicMock(return_value=[{'id': 'group-1', 'name': 'Group One'}]),
        _settings=MagicMock(return_value=settings),
        get_brand_config=MagicMock(return_value={'first_party_domains': ['hotel-mine.com']}),
        _load_run_answers=MagicMock(return_value={'shared keyword': answers}),
        dynamodb=resource,
    )


@contextmanager
def _complete_group_run(
    worker_module,
    resource: MagicMock,
    settings: dict,
    previous_snapshot: dict | None = None,
) -> Iterator[None]:
    """One complete group whose exact-run answers are `_answers()`, with notification stubbed out."""
    with (
        _complete_group_patches(worker_module, resource, settings, _answers()),
        patch.object(worker_module, '_previous_snapshot', return_value=previous_snapshot),
        patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
    ):
        yield


def _run_complete_group(
    worker_module,
    resource: MagicMock,
    settings: dict,
    previous_snapshot: dict | None,
) -> dict:
    """Run the worker over one complete group whose exact-run answers are `_answers()`."""
    with _complete_group_run(worker_module, resource, settings, previous_snapshot):
        return worker_module.handler(_event(), None)


def _recorded_snapshot(worker_module) -> dict:
    """The snapshot the worker stores for the complete group, with alerts disabled and no previous snapshot."""
    snapshots, _alerts, resource = _single_group_tables()
    _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)
    return snapshots.put_item.call_args.kwargs['Item']

class TestRunEligibility:
    def test_skips_degraded_report_without_reading_tables(self, worker_module) -> None:
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(_event('completed_degraded'), None)

        assert result['status'] == 'skipped'
        assert result['reason'] == 'report_not_comparable'
        assert resource.method_calls == []

    def test_skips_generate_summary_degraded_report_before_reading_tables(
        self,
        worker_module,
        summary_module,
    ) -> None:
        summary_module.SUMMARY_BUCKET = ''
        report = summary_module.handler({
            'execution_id': 'exec-1',
            'keyword_results': [{
                'status': 'success',
                'keyword': 'shared keyword',
                'timestamp': _RUN_TIMESTAMP,
                'provider_summary': {
                    'result_count': 2,
                    'by_provider': {
                        'openai': {'queries': 1, 'citations': 1},
                        'claude': {'queries': 1, 'citations': 0, 'failures': 1},
                    },
                },
                'deduplicated_citations': [],
                'crawled_results': [],
            }],
        }, None)
        event = _event()
        event['report'] = report
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(event, None)

        assert report['status'] == 'completed_degraded'
        assert result == {
            'status': 'skipped',
            'reason': 'report_not_comparable',
            'groups_evaluated': 0,
            'snapshots_recorded': 0,
            'alerts_created': 0,
            'skipped_partial': 0,
        }
        assert resource.method_calls == []

    def test_skips_ambiguous_timestamp_without_reading_tables(self, worker_module) -> None:
        event = _event()
        event['report']['run_metadata']['timestamp'] = None
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(event, None)

        assert result['reason'] == 'run_timestamp_missing_or_ambiguous'
        assert resource.method_calls == []

    def test_counts_touched_group_as_partial_when_active_member_was_not_processed(self, worker_module) -> None:
        members = {
            'group-1': [
                {'keyword': 'processed'},
                {'keyword': 'not processed'},
            ],
        }

        complete, skipped = worker_module._complete_groups(
            {'group-1'},
            ['processed'],
            members,
        )

        assert complete == []
        assert skipped == 1

    def test_marks_every_membership_of_shared_keyword_as_touched(self, worker_module) -> None:
        groups = [{'id': 'group-1'}, {'id': 'group-2'}]

        touched = worker_module._touched_groups({}, ['shared keyword'], _SHARED_KEYWORD_IN_TWO_GROUPS, groups)

        assert touched == {'group-1', 'group-2'}


class TestCompleteSnapshotEvaluation:
    def test_queries_shared_keyword_once_for_two_complete_groups(self, worker_module) -> None:
        snapshots = MagicMock()
        resource = fake_dynamodb_resource(by_name={'snapshots': snapshots})
        groups = [
            {'id': 'group-1', 'name': 'Group One'},
            {'id': 'group-2', 'name': 'Group Two'},
        ]
        load_answers = MagicMock(return_value={'shared keyword': _answers()})

        with (
            patch.object(worker_module, 'query_active_keywords', return_value=_SHARED_KEYWORD_IN_TWO_GROUPS),
            patch.object(worker_module, '_load_groups', return_value=groups),
            patch.object(worker_module, '_settings', return_value=_ALERTS_DISABLED),
            patch.object(worker_module, 'get_brand_config', return_value={}),
            patch.object(worker_module, '_load_run_answers', load_answers),
            patch.object(worker_module, '_previous_snapshot', return_value=None),
            patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
            patch.object(worker_module, 'dynamodb', resource),
        ):
            result = worker_module.handler(_event(), None)

        assert load_answers.call_args.args == (['shared keyword'], _RUN_TIMESTAMP)
        assert snapshots.put_item.call_count == 2
        assert result['snapshots_recorded'] == 2
        assert result['skipped_partial'] == 0

    def test_records_snapshot_when_alerts_are_disabled(self, worker_module) -> None:
        snapshots, alerts, resource = _single_group_tables()

        result = _run_complete_group(
            worker_module,
            resource,
            _ALERTS_DISABLED,
            {'snapshot_at': '2026-09-01T10:00:00Z'},
        )

        stored_snapshot = snapshots.put_item.call_args.kwargs['Item']
        assert snapshots.put_item.call_count == 1
        assert (
            stored_snapshot['group_id'],
            stored_snapshot['snapshot_at'],
            stored_snapshot['ttl'],
        ) == ('group-1', _RUN_TIMESTAMP, 1822384800)
        assert alerts.put_item.call_count == 0
        assert result['alerts_created'] == 0

    def test_persists_nested_snapshot_metrics_as_decimals(self, worker_module) -> None:
        snapshots, _alerts, resource = _single_group_tables()

        _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)

        stored_snapshot = snapshots.put_item.call_args.kwargs['Item']
        assert (stored_snapshot['kpi_version'], stored_snapshot['kpis']['visibility_score']) == (2, Decimal('45.0'))
        assert stored_snapshot['keywords'] == [{
            'keyword': 'shared keyword',
            'mentioned': True,
            'average_position': Decimal('2.0'),
        }]

    def test_measures_the_citation_kpis_against_the_owned_domains(self, worker_module) -> None:
        assert _recorded_snapshot(worker_module)['kpis']['citation_rate'] == Decimal('100.0')

    def test_reads_the_owned_domains_from_the_brand_config_table(self, worker_module) -> None:
        _snapshots, _alerts, resource = _single_group_tables()
        brand_config = MagicMock(return_value={})

        with (
            _complete_group_run(worker_module, resource, _ALERTS_DISABLED),
            patch.object(worker_module, 'get_brand_config', brand_config),
        ):
            worker_module.handler(_event(), None)

        brand_config.assert_called_once_with('brand-config')

    def test_records_the_best_position_of_each_competitor(self, worker_module) -> None:
        assert _recorded_snapshot(worker_module)['competitors'] == [{'name': 'Rival', 'best_position': 1}]

    def test_persists_exact_alert_shape_with_compared_run_timestamp(self, worker_module) -> None:
        _snapshots, alerts, resource = _single_group_tables()
        specification = {
            'type': 'mention_rate_drop',
            'severity': 'warning',
            'previous': 64.0,
            'current': 52.0,
            'delta': 12.0,
            'threshold': 10.0,
            'entity': 'group-1',
            'message': 'Mention rate fell by 12.0 points.',
        }

        with (
            patch.object(worker_module, '_content_change', return_value=None),
            patch.object(worker_module, 'compare_snapshots', return_value=[specification]),
        ):
            result = _run_complete_group(
                worker_module,
                resource,
                DEFAULT_ALERT_SETTINGS,
                {'snapshot_at': '2026-09-01T10:00:00Z'},
            )

        assert alerts.put_item.call_args.kwargs == {
            'Item': {
                'id': 'alert-80dedc654d7f56f1015ec86c395380bd',
                'group_id': 'group-1',
                'group_name': 'Group One',
                'execution_id': 'exec-1',
                'created_at': _RUN_TIMESTAMP,
                'run_timestamp': _RUN_TIMESTAMP,
                'status': 'open',
                'acknowledged': False,
                'ttl': 1822384800,
                'type': 'mention_rate_drop',
                'severity': 'warning',
                'previous': Decimal('64.0'),
                'current': Decimal('52.0'),
                'delta': Decimal('12.0'),
                'threshold': Decimal('10.0'),
                'entity': 'group-1',
                'message': 'Mention rate fell by 12.0 points.',
            },
            'ConditionExpression': 'attribute_not_exists(id)',
        }
        assert result['alerts_created'] == 1

    def test_names_the_run_and_the_snapshotted_groups_for_the_insights_step(self, worker_module) -> None:
        _snapshots, _alerts, resource = _single_group_tables()

        result = _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)

        assert (result['run_timestamp'], result['snapshot_group_ids']) == (_RUN_TIMESTAMP, ['group-1'])

    def test_names_no_snapshotted_group_when_the_only_group_is_partial(self, worker_module) -> None:
        with _complete_group_patches(worker_module, fake_dynamodb_resource(), DEFAULT_ALERT_SETTINGS, None):
            result = worker_module.handler(_event(), None)

        assert result['snapshot_group_ids'] == []

    def test_names_no_snapshotted_group_when_no_touched_group_is_complete(self, worker_module) -> None:
        with (
            patch.object(worker_module, 'query_active_keywords', return_value=[]),
            patch.object(worker_module, '_load_groups', return_value=[{'id': 'group-1', 'name': 'Group One'}]),
            patch.object(worker_module, 'dynamodb', fake_dynamodb_resource()),
        ):
            result = worker_module.handler(_event(), None)

        assert (result['run_timestamp'], result['snapshot_group_ids']) == (_RUN_TIMESTAMP, [])

    @pytest.mark.parametrize('answers', [None, []], ids=['read failed', 'no engine answered'])
    def test_skips_group_when_a_keyword_has_no_exact_run_answers(self, worker_module, answers) -> None:
        resource = fake_dynamodb_resource()

        with _complete_group_patches(
            worker_module,
            resource,
            DEFAULT_ALERT_SETTINGS,
            answers,
        ):
            result = worker_module.handler(_event(), None)

        assert result['groups_evaluated'] == 0
        assert result['snapshots_recorded'] == 0
        assert result['skipped_partial'] == 1


class TestLoadRunAnswers:
    def test_reads_each_keywords_answers_in_the_run(self, worker_module) -> None:
        search = MagicMock()
        search.query.return_value = {'Items': [_row('openai', ('Rival', 'competitor', 1)), _row('brave')]}
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'search': search})

        answers = worker_module._load_run_answers(['shared keyword'], _RUN_TIMESTAMP)

        assert [(answer.provider, answer.timestamp) for answer in answers['shared keyword']] == [('openai', _RUN_TIMESTAMP)]

    def test_marks_a_keyword_that_cannot_be_read(self, worker_module, caplog) -> None:
        search = MagicMock()
        search.query.side_effect = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'Query')
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'search': search})

        with caplog.at_level(logging.ERROR):
            answers = worker_module._load_run_answers(['shared keyword'], _RUN_TIMESTAMP)

        assert answers == {'shared keyword': None}
        assert [record.getMessage() for record in caplog.records] == ['Exact-run answers query failed for one keyword']

    def test_reads_nothing_for_no_keywords(self, worker_module) -> None:
        assert worker_module._load_run_answers([], _RUN_TIMESTAMP) == {}


class TestIdempotentAlertWrites:
    @staticmethod
    def _put_alert_into(worker_module, table: MagicMock) -> bool:
        """Write `alert-1` through the worker with `table` as the alerts table."""
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'alerts': table})
        return worker_module._put_new_alert({'id': 'alert-1'})

    def test_reports_new_alert_when_conditional_write_succeeds(self, worker_module) -> None:
        table = MagicMock()

        created = self._put_alert_into(worker_module, table)

        assert created is True
        assert table.put_item.call_args.kwargs['ConditionExpression'] == 'attribute_not_exists(id)'

    def test_reports_duplicate_when_alert_id_already_exists(self, worker_module) -> None:
        table = MagicMock()
        table.put_item.side_effect = conditional_check_failure('PutItem', message='duplicate')

        assert self._put_alert_into(worker_module, table) is False


_ALERT = {'severity': 'warning', 'message': 'Alert'}


class TestNotification:
    def test_publishes_one_plain_text_message_for_new_alerts_with_emails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        alerts = [{
            'severity': 'warning',
            'message': 'Mention rate fell.',
        }]

        result = worker_module._notify(alerts, 'exec-1', _EMAIL_SETTINGS)

        assert result == {'status': 'published'}
        assert worker_module.sns.publish.call_count == 1
        assert worker_module.sns.publish.call_args.kwargs['Message'] == (
            'Citation Analysis detected 1 new KPI alert(s) for execution exec-1.\n'
            '- [WARNING] Mention rate fell.'
        )
        assert len(worker_module.sns.publish.call_args.kwargs['Subject']) <= 100

    def test_keeps_persisted_alerts_when_notification_fails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        worker_module.sns.publish.side_effect = RuntimeError('SNS unavailable')

        result = worker_module._notify([_ALERT], 'exec-1', _EMAIL_SETTINGS)

        assert result == {'status': 'failed'}

    def test_does_not_publish_when_no_email_is_configured(self, worker_module) -> None:
        worker_module.sns = MagicMock()

        result = worker_module._notify([_ALERT], 'exec-1', DEFAULT_ALERT_SETTINGS)

        assert result == {'status': 'not_sent', 'reason': 'no_configured_emails'}
        assert worker_module.sns.publish.call_count == 0


_FULL_REPORT_KEY = 'execution-summaries/20261001100500-exec-1.json'


def _compact_event(status: str = 'completed', s3_location: str | None = f's3://{RESULTS_BUCKET}/{_FULL_REPORT_KEY}') -> dict:
    """What the workflow sends since GenerateSummary returns the compact report."""
    event = _event(status)
    report = event['report']
    report['run_metadata'] = {'timestamp': _RUN_TIMESTAMP, 'timestamps': [_RUN_TIMESTAMP], 'keyword_count': 1}
    if s3_location is not None:
        report['s3_location'] = s3_location
    return event


class TestFullReportFromS3:
    """The compact report has no per-keyword identity; the full one is read back from S3."""

    def test_evaluates_the_run_from_the_full_report_stored_at_its_s3_location(self, worker_module) -> None:
        s3 = fake_s3_objects({(RESULTS_BUCKET, _FULL_REPORT_KEY): _event()['report']})
        _snapshots, _alerts, resource = _single_group_tables()

        with (
            _complete_group_run(worker_module, resource, _ALERTS_DISABLED),
            patch.object(worker_module, 's3', s3),
        ):
            result = worker_module.handler(_compact_event(), None)

        assert (result['status'], result['snapshots_recorded']) == ('completed', 1)

    def test_skips_with_a_reason_when_the_full_report_cannot_be_read(self, worker_module) -> None:
        with patch.object(worker_module, 's3', fake_s3_objects({})):
            result = worker_module.handler(_compact_event(), None)

        assert (result['status'], result['reason']) == ('skipped', 'full_report_unreadable')

    def test_skips_with_a_reason_when_the_compact_report_names_no_s3_location(self, worker_module) -> None:
        with patch.object(worker_module, 's3', fake_s3_objects({})):
            result = worker_module.handler(_compact_event(s3_location=None), None)

        assert (result['status'], result['reason']) == ('skipped', 'full_report_location_missing')

    def test_does_not_read_s3_for_a_report_that_is_not_comparable(self, worker_module) -> None:
        s3 = fake_s3_objects({})

        with patch.object(worker_module, 's3', s3):
            result = worker_module.handler(_compact_event('completed_with_errors'), None)

        assert result['reason'] == 'report_not_comparable'
        s3.get_object.assert_not_called()
