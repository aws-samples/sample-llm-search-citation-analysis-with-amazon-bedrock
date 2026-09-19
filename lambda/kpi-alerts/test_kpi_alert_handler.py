"""Worker-level tests for complete-run snapshot and alert behavior."""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.handler_fixtures import handler_fixture

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_RUN_TIMESTAMP = '2026-10-01T10:00:00Z'
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'search',
    'DYNAMODB_TABLE_KEYWORDS': 'keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'groups',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'providers',
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


def _visibility() -> dict:
    first_party = {
        'name': 'Hotel Mine',
        'classification': 'first_party',
        'visibility_score': 60.0,
        'share_of_voice': 50.0,
        'provider_count': 2,
        'providers': ['openai', 'gemini'],
        'total_mentions': 2,
        'best_rank': 2,
    }
    competitor = {
        'name': 'Rival',
        'classification': 'competitor',
        'visibility_score': 40.0,
        'share_of_voice': 50.0,
        'provider_count': 1,
        'providers': ['openai'],
        'total_mentions': 2,
        'best_rank': 1,
    }
    return {
        'keyword': 'shared keyword',
        'timestamp': _RUN_TIMESTAMP,
        'total_mentions': 4,
        'brands': [first_party, competitor],
        'first_party': [first_party],
        'competitors': [competitor],
        'others': [],
        'prominence': {
            'answers': 2,
            'mentioned_answers': 1,
            'rank_1_share': 0.0,
            'top_3_share': 50.0,
            'mean_rank': 2.0,
            'mean_first_position': 12.0,
        },
        'summary': {
            'first_party_avg_score': 60.0,
            'competitor_avg_score': 40.0,
            'first_party_total_sov': 50.0,
            'competitor_total_sov': 50.0,
        },
    }


def _single_group_tables() -> tuple[MagicMock, MagicMock, MagicMock]:
    snapshots = MagicMock()
    alerts = MagicMock()
    resource = fake_dynamodb_resource(by_name={
        'snapshots': snapshots,
        'alerts': alerts,
    })
    return snapshots, alerts, resource


def _complete_group_patches(
    worker_module,
    resource: MagicMock,
    settings: dict,
    metrics: dict,
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
        get_enabled_provider_count=MagicMock(return_value=4),
        _load_exact_metrics=MagicMock(return_value={'shared keyword': metrics}),
        dynamodb=resource,
    )


class TestRunEligibility:
    def test_skips_degraded_report_without_reading_tables(self, worker_module) -> None:
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(_event('completed_degraded'), None)

        assert result['status'] == 'skipped'
        assert result['reason'] == 'report_not_comparable'
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
        active = [{
            'id': 'keyword-1',
            'keyword': 'shared keyword',
            'group_ids': {'group-1', 'group-2'},
        }]
        groups = [{'id': 'group-1'}, {'id': 'group-2'}]

        touched = worker_module._touched_groups({}, ['shared keyword'], active, groups)

        assert touched == {'group-1', 'group-2'}


class TestCompleteSnapshotEvaluation:
    def test_queries_shared_keyword_once_for_two_complete_groups(self, worker_module) -> None:
        snapshots = MagicMock()
        resource = fake_dynamodb_resource(by_name={'snapshots': snapshots})
        active = [{
            'id': 'keyword-1',
            'keyword': 'shared keyword',
            'group_ids': {'group-1', 'group-2'},
        }]
        groups = [
            {'id': 'group-1', 'name': 'Group One'},
            {'id': 'group-2', 'name': 'Group Two'},
        ]
        load_metrics = MagicMock(return_value={'shared keyword': _visibility()})

        with (
            patch.object(worker_module, 'query_active_keywords', return_value=active),
            patch.object(worker_module, '_load_groups', return_value=groups),
            patch.object(worker_module, '_settings', return_value={**DEFAULT_ALERT_SETTINGS, 'enabled': False}),
            patch.object(worker_module, 'get_enabled_provider_count', return_value=4),
            patch.object(worker_module, '_load_exact_metrics', load_metrics),
            patch.object(worker_module, '_previous_snapshot', return_value=None),
            patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
            patch.object(worker_module, 'dynamodb', resource),
        ):
            result = worker_module.handler(_event(), None)

        assert load_metrics.call_args.args == (['shared keyword'], _RUN_TIMESTAMP, 4)
        assert snapshots.put_item.call_count == 2
        assert result['snapshots_recorded'] == 2
        assert result['skipped_partial'] == 0

    def test_records_snapshot_when_alerts_are_disabled(self, worker_module) -> None:
        snapshots, alerts, resource = _single_group_tables()

        with (
            _complete_group_patches(
                worker_module,
                resource,
                {**DEFAULT_ALERT_SETTINGS, 'enabled': False},
                _visibility(),
            ),
            patch.object(worker_module, '_previous_snapshot', return_value={'snapshot_at': '2026-09-01T10:00:00Z'}),
            patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
        ):
            result = worker_module.handler(_event(), None)

        stored_snapshot = snapshots.put_item.call_args.kwargs['Item']
        assert snapshots.put_item.call_count == 1
        assert (
            stored_snapshot['group_id'],
            stored_snapshot['snapshot_at'],
            stored_snapshot['ttl'],
        ) == ('group-1', _RUN_TIMESTAMP, 1822384800)
        assert alerts.put_item.call_count == 0
        assert result['alerts_created'] == 0

    def test_persists_exact_alert_shape_with_compared_run_timestamp(self, worker_module) -> None:
        _snapshots, alerts, resource = _single_group_tables()
        specification = {
            'type': 'citation_rate_drop',
            'severity': 'warning',
            'previous': 64.0,
            'current': 52.0,
            'delta': 12.0,
            'threshold': 10.0,
            'entity': 'group-1',
            'message': 'Citation coverage fell by 12.0 percentage points.',
        }

        with (
            _complete_group_patches(
                worker_module,
                resource,
                DEFAULT_ALERT_SETTINGS,
                _visibility(),
            ),
            patch.object(worker_module, '_previous_snapshot', return_value={'snapshot_at': '2026-09-01T10:00:00Z'}),
            patch.object(worker_module, '_content_change', return_value=None),
            patch.object(worker_module, 'compare_snapshots', return_value=[specification]),
            patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
        ):
            result = worker_module.handler(_event(), None)

        assert alerts.put_item.call_args.kwargs == {
            'Item': {
                'id': 'alert-d9c3a09f6c91aeb393b663030c383310',
                'group_id': 'group-1',
                'group_name': 'Group One',
                'execution_id': 'exec-1',
                'created_at': _RUN_TIMESTAMP,
                'run_timestamp': _RUN_TIMESTAMP,
                'status': 'open',
                'acknowledged': False,
                'ttl': 1822384800,
                'type': 'citation_rate_drop',
                'severity': 'warning',
                'previous': Decimal('64.0'),
                'current': Decimal('52.0'),
                'delta': Decimal('12.0'),
                'threshold': Decimal('10.0'),
                'entity': 'group-1',
                'message': 'Citation coverage fell by 12.0 percentage points.',
            },
            'ConditionExpression': 'attribute_not_exists(id)',
        }
        assert result['alerts_created'] == 1

    def test_skips_group_when_exact_run_rows_are_missing(self, worker_module) -> None:
        resource = fake_dynamodb_resource()

        with _complete_group_patches(
            worker_module,
            resource,
            DEFAULT_ALERT_SETTINGS,
            {'error': 'No data'},
        ):
            result = worker_module.handler(_event(), None)

        assert result['groups_evaluated'] == 0
        assert result['snapshots_recorded'] == 0
        assert result['skipped_partial'] == 1


class TestIdempotentAlertWrites:
    def test_reports_new_alert_when_conditional_write_succeeds(self, worker_module) -> None:
        table = MagicMock()
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'alerts': table})

        created = worker_module._put_new_alert({'id': 'alert-1'})

        assert created is True
        assert table.put_item.call_args.kwargs['ConditionExpression'] == 'attribute_not_exists(id)'

    def test_reports_duplicate_when_alert_id_already_exists(self, worker_module) -> None:
        table = MagicMock()
        table.put_item.side_effect = ClientError(
            {'Error': {'Code': 'ConditionalCheckFailedException', 'Message': 'duplicate'}},
            'PutItem',
        )
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'alerts': table})

        created = worker_module._put_new_alert({'id': 'alert-1'})

        assert created is False


class TestNotification:
    def test_publishes_one_plain_text_message_for_new_alerts_with_emails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        alerts = [{
            'severity': 'warning',
            'message': 'Citation coverage fell.',
        }]
        settings = {**DEFAULT_ALERT_SETTINGS, 'notification_emails': ['ops@example.com']}

        result = worker_module._notify(alerts, 'exec-1', settings)

        assert result == {'status': 'published'}
        assert worker_module.sns.publish.call_count == 1
        assert worker_module.sns.publish.call_args.kwargs['Message'] == (
            'Citation Analysis detected 1 new KPI alert(s) for execution exec-1.\n'
            '- [WARNING] Citation coverage fell.'
        )
        assert len(worker_module.sns.publish.call_args.kwargs['Subject']) <= 100

    def test_keeps_persisted_alerts_when_notification_fails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        worker_module.sns.publish.side_effect = RuntimeError('SNS unavailable')
        settings = {**DEFAULT_ALERT_SETTINGS, 'notification_emails': ['ops@example.com']}

        result = worker_module._notify([
            {'severity': 'warning', 'message': 'Alert'},
        ], 'exec-1', settings)

        assert result == {'status': 'failed'}

    def test_does_not_publish_when_no_email_is_configured(self, worker_module) -> None:
        worker_module.sns = MagicMock()

        result = worker_module._notify([
            {'severity': 'warning', 'message': 'Alert'},
        ], 'exec-1', DEFAULT_ALERT_SETTINGS)

        assert result == {'status': 'not_sent', 'reason': 'no_configured_emails'}
        assert worker_module.sns.publish.call_count == 0
