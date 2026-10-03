"""API contract tests for KPI alerts, settings, and content markers."""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any, NamedTuple
from unittest.mock import MagicMock, call, patch

import pytest
from botocore.exceptions import ClientError

from shared.kpi_alerts import (
    DEFAULT_ALERT_SETTINGS,
    deterministic_content_change_id,
    ttl_for_timestamp,
)
from testing.admin_authz_fixtures import caller_claims
from testing.dynamodb_stubs import conditional_check_failure, fake_dynamodb_resource
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'CORS_ORIGIN_PARAM': '',
    'DYNAMODB_TABLE_KPI_ALERTS': 'alerts',
    'DYNAMODB_TABLE_ALERT_SETTINGS': 'settings',
    'DYNAMODB_TABLE_CONTENT_CHANGES': 'changes',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'groups',
    'KPI_ALERTS_TOPIC_ARN': 'arn:aws:sns:us-east-1:123456789012:kpi-alerts',
}
_ADMIN = caller_claims('Admin')
_USER = caller_claims('Users', 'reader@example.com')
_DEFAULT_THRESHOLDS = {
    'mention_rate_drop': 10.0,
    'position_loss': 1.0,
    'competitor_top_n': 3,
    'improvement_after_content_change': 5.0,
}
_PUBLISHED_PAGE = {
    'group_id': 'group-1',
    'description': 'Published landing page',
    'url': 'https://example.com/page',
}

alert_api = handler_fixture(
    _API_DIR,
    'manage-alerts.py',
    'manage_alerts_under_test',
    env=_ENV,
)


class AlertTables(NamedTuple):
    """The table stubs the handler's ``dynamodb.Table(name)`` hands out, by table."""

    alerts: MagicMock
    settings: MagicMock
    changes: MagicMock
    groups: MagicMock


@pytest.fixture(autouse=True)
def tables(alert_api, monkeypatch) -> AlertTables:
    """Fresh table stubs and an SNS client whose topic has no subscriptions."""
    stubs = AlertTables(*(MagicMock(name=name) for name in AlertTables._fields))
    monkeypatch.setattr(alert_api, 'dynamodb', fake_dynamodb_resource(by_name=stubs._asdict()))
    sns = MagicMock(name='sns')
    sns.list_subscriptions_by_topic.return_value = {'Subscriptions': []}
    monkeypatch.setattr(alert_api, 'sns', sns)
    return stubs


def _settings(**overrides: object) -> dict:
    return {**DEFAULT_ALERT_SETTINGS, **overrides}


def _settings_request(**overrides: object) -> dict:
    settings = _settings(**overrides)
    return {
        'enabled': settings['enabled'],
        'notification_emails': settings['notification_emails'],
        'thresholds': {name: settings[name] for name in _DEFAULT_THRESHOLDS},
    }


def _call(
    alert_api: Any,
    method: str,
    path: str,
    *,
    body: object | None = None,
    query: dict[str, str] | None = None,
    claims: dict[str, str] | None = None,
    alert_id: str | None = None,
) -> tuple[int, Any]:
    """``(status, body)`` the handler answers the request with."""
    event = api_gateway_event(
        method,
        path,
        body=body,
        query=query,
        claims=claims,
        path_params={'id': alert_id} if alert_id is not None else None,
        resource=path,
    )
    return parse_response(alert_api.handler(event, None))


def _acknowledge(alert_api: Any, alert_id: str, claims: dict[str, str] = _ADMIN) -> tuple[int, Any]:
    return _call(alert_api, 'POST', f'/api/alerts/{alert_id}/acknowledge', claims=claims, alert_id=alert_id)


def _test_notification(alert_api: Any, body: object | None = None) -> tuple[int, Any]:
    return _call(alert_api, 'POST', '/api/alerts/test-notification', claims=_ADMIN, body=body)


def _put_settings(alert_api: Any, body: object, claims: dict[str, str] = _ADMIN) -> tuple[int, Any]:
    return _call(alert_api, 'PUT', '/api/alerts/settings', body=body, claims=claims)


def _post_content_change(alert_api: Any, body: object) -> tuple[int, Any]:
    return _call(alert_api, 'POST', '/api/alerts/content-changes', body=body, claims=_ADMIN)


def _email_subscription(email: str, arn: str = 'PendingConfirmation') -> dict[str, str]:
    return {'Protocol': 'email', 'Endpoint': email, 'SubscriptionArn': arn}


def _subscribe(alert_api: Any, *subscriptions: dict[str, str]) -> None:
    alert_api.sns.list_subscriptions_by_topic.return_value = {'Subscriptions': list(subscriptions)}


def _store_settings(tables: AlertTables, **overrides: object) -> None:
    tables.settings.get_item.return_value = {'Item': _settings(**overrides)}


@pytest.fixture
def ops_settings(tables: AlertTables) -> AlertTables:
    """Stored settings notifying only ops@example.com."""
    _store_settings(tables, notification_emails=['ops@example.com'])
    return tables


class TestAlertHistory:
    def test_returns_open_alerts_newest_first_through_status_index(self, alert_api, tables) -> None:
        tables.alerts.query.return_value = {'Items': [
            {'id': 'new', 'status': 'open', 'created_at': '2026-10-02T10:00:00Z'},
            {'id': 'old', 'status': 'open', 'created_at': '2026-10-01T10:00:00Z'},
        ]}

        status, body = _call(alert_api, 'GET', '/api/alerts', query={'status': 'open', 'limit': '1'})

        assert status == 200
        assert body == {'items': [
            {'id': 'new', 'status': 'open', 'created_at': '2026-10-02T10:00:00Z'},
        ], 'count': 1}
        assert tables.alerts.query.call_args.kwargs['IndexName'] == 'StatusCreatedIndex'
        assert tables.alerts.scan.call_count == 0

    def test_returns_exact_backend_alert_shape(self, alert_api, tables) -> None:
        expected = {
            'id': 'alert-d9c3a09f6c91aeb393b663030c383310',
            'group_id': 'group-1',
            'group_name': 'Group One',
            'execution_id': 'exec-1',
            'created_at': '2026-10-01T10:00:00Z',
            'run_timestamp': '2026-10-01T10:00:00Z',
            'status': 'open',
            'acknowledged': False,
            'ttl': 1822384800,
            'type': 'mention_rate_drop',
            'severity': 'warning',
            'previous': '64.0',
            'current': '52.0',
            'delta': '12.0',
            'threshold': '10.0',
            'entity': 'group-1',
            'message': 'Mention rate fell by 12.0 points.',
        }
        stored_numbers = {name: Decimal(expected[name]) for name in ('previous', 'current', 'delta', 'threshold')}
        tables.alerts.query.return_value = {'Items': [{**expected, **stored_numbers}]}

        status, body = _call(alert_api, 'GET', '/api/alerts')

        assert status == 200
        assert body == {'items': [expected], 'count': 1}

    def test_merges_open_and_acknowledged_alerts_newest_first(self, alert_api, tables) -> None:
        tables.alerts.query.side_effect = [
            {'Items': [{'id': 'open', 'status': 'open', 'created_at': '2026-10-01T10:00:00Z'}]},
            {'Items': [{'id': 'ack', 'status': 'acknowledged', 'created_at': '2026-10-02T10:00:00Z'}]},
        ]

        _status, body = _call(alert_api, 'GET', '/api/alerts', query={'status': 'all', 'limit': '10'})

        assert [item['id'] for item in body['items']] == ['ack', 'open']
        assert body['count'] == 2
        assert tables.alerts.query.call_count == 2

    def test_rejects_alert_limit_over_one_hundred(self, alert_api) -> None:
        status, body = _call(alert_api, 'GET', '/api/alerts', query={'limit': '101'})

        assert status == 400
        assert body['field'] == 'limit'


class TestAcknowledgeAlert:
    def test_returns_exact_acknowledgement_contract_for_admin(self, alert_api, tables) -> None:
        status, body = _acknowledge(alert_api, 'alert-1')

        assert status == 200
        assert body == {'success': True, 'id': 'alert-1', 'status': 'acknowledged'}
        assert tables.alerts.update_item.call_args.kwargs['ExpressionAttributeValues'][':acknowledged'] is True

    def test_denies_acknowledgement_for_non_admin_without_writing(self, alert_api, tables) -> None:
        status, _body = _acknowledge(alert_api, 'alert-1', _USER)

        assert status == 403
        assert tables.alerts.update_item.call_count == 0

    def test_returns_not_found_when_alert_does_not_exist(self, alert_api, tables) -> None:
        tables.alerts.update_item.side_effect = conditional_check_failure(message='missing')

        status, body = _acknowledge(alert_api, 'missing')

        assert status == 404
        assert body == {'error': 'Alert not found'}


class TestTestNotification:
    def test_publishes_fixed_message_once_when_detection_is_disabled(self, alert_api, tables) -> None:
        _subscribe(
            alert_api,
            _email_subscription('ops@example.com', 'arn:aws:sns:us-east-1:123:kpi-alerts:confirmed'),
            _email_subscription('pending@example.com'),
            _email_subscription('caller@example.com', 'arn:aws:sns:us-east-1:123:kpi-alerts:unconfigured'),
        )
        _store_settings(tables, enabled=False, notification_emails=['OPS@example.com', 'pending@example.com'])

        status, body = _test_notification(alert_api, {
            'Subject': 'Caller subject',
            'Message': 'Caller message',
            'notification_emails': ['caller@example.com'],
        })

        assert (status, body) == (200, {
            'success': True,
            'message': 'Test notification accepted for delivery.',
        })
        assert tables.settings.get_item.call_args_list == [call(Key={'config_id': 'default'})]
        assert alert_api.sns.publish.call_args_list == [call(
            TopicArn=_ENV['KPI_ALERTS_TOPIC_ARN'],
            Subject='Citation Analysis test notification',
            Message=(
                'This is a test notification from Citation Analysis. '
                'Email alert delivery is configured correctly.'
            ),
        )]
        assert tables.settings.put_item.call_count == 0

    def test_rejects_when_no_configured_email_has_a_confirmed_subscription(self, alert_api, ops_settings) -> None:
        _subscribe(
            alert_api,
            _email_subscription('ops@example.com'),
            _email_subscription('unconfigured@example.com', 'arn:aws:sns:us-east-1:123:kpi-alerts:unconfigured'),
            {
                'Protocol': 'sms',
                'Endpoint': 'ops@example.com',
                'SubscriptionArn': 'arn:aws:sns:us-east-1:123:kpi-alerts:sms',
            },
        )

        status, body = _test_notification(alert_api, {'notification_emails': ['unconfigured@example.com']})

        assert status == 400
        assert body == {
            'error': 'At least one configured notification email must have a confirmed subscription',
            'field': 'notification_emails',
        }
        assert alert_api.sns.publish.call_count == 0
        assert ops_settings.settings.put_item.call_count == 0

    def test_returns_sanitized_error_when_subscription_status_cannot_be_verified(self, alert_api, ops_settings) -> None:
        alert_api.sns.list_subscriptions_by_topic.side_effect = RuntimeError('private SNS detail')

        status, body = _test_notification(alert_api)

        assert status == 500
        assert body == {'error': 'An unexpected error occurred'}
        assert 'private SNS detail' not in str(body)
        assert alert_api.sns.publish.call_count == 0

    def test_returns_sanitized_error_without_persisting_when_publish_fails(self, alert_api, ops_settings) -> None:
        _subscribe(alert_api, _email_subscription('ops@example.com', 'arn:aws:sns:us-east-1:123:kpi-alerts:confirmed'))
        alert_api.sns.publish.side_effect = ClientError(
            {'Error': {'Code': 'AccessDeniedException', 'Message': 'private AWS detail'}},
            'Publish',
        )

        status, body = _test_notification(alert_api)

        assert status == 500
        assert body == {'error': 'Service temporarily unavailable'}
        assert 'private AWS detail' not in str(body)
        assert ops_settings.settings.put_item.call_count == 0


class TestAlertSettings:
    def test_returns_defaults_when_singleton_is_absent(self, alert_api, tables) -> None:
        tables.settings.get_item.return_value = {}

        status, body = _call(alert_api, 'GET', '/api/alerts/settings')

        assert status == 200
        assert body == {
            'config_id': 'default',
            'enabled': True,
            'notification_emails': [],
            'thresholds': _DEFAULT_THRESHOLDS,
            'subscription_statuses': [],
        }

    def test_returns_safe_sync_warning_when_subscription_listing_fails(self, alert_api, ops_settings) -> None:
        alert_api.sns.list_subscriptions_by_topic.side_effect = RuntimeError('private SNS detail')

        _status, body = _call(alert_api, 'GET', '/api/alerts/settings')

        assert body['subscription_statuses'] == [
            {'email': 'ops@example.com', 'status': 'unknown'},
        ]
        assert body['warnings'] == ['Subscription status could not be synchronized.']
        assert 'private SNS detail' not in str(body)

    def test_lists_confirmed_and_pending_subscriptions_across_pages(self, alert_api, tables) -> None:
        tables.settings.get_item.return_value = {'Item': {
            **_settings(notification_emails=['ops@example.com', 'team@example.com']),
            'updated_at': '2026-09-30T10:00:00Z',
        }}
        alert_api.sns.list_subscriptions_by_topic.side_effect = [
            {'Subscriptions': [_email_subscription('ops@example.com')], 'NextToken': 'page-2'},
            {'Subscriptions': [_email_subscription('team@example.com', 'arn:aws:sns:us-east-1:123:topic:confirmed')]},
        ]

        _status, body = _call(alert_api, 'GET', '/api/alerts/settings')

        assert body == {
            'config_id': 'default',
            'enabled': True,
            'notification_emails': ['ops@example.com', 'team@example.com'],
            'thresholds': _DEFAULT_THRESHOLDS,
            'updated_at': '2026-09-30T10:00:00Z',
            'subscription_statuses': [
                {'email': 'ops@example.com', 'status': 'pending_confirmation'},
                {'email': 'team@example.com', 'status': 'confirmed'},
            ],
        }
        assert 'arn:' not in str(body)
        assert alert_api.sns.list_subscriptions_by_topic.call_count == 2
        assert alert_api.sns.list_subscriptions_by_topic.call_args_list[1].kwargs['NextToken'] == 'page-2'

    def test_reconciles_deduplicated_email_subscriptions_for_admin(self, alert_api) -> None:
        _subscribe(
            alert_api,
            _email_subscription('removed@example.com', 'arn:aws:sns:us-east-1:123:topic:removed'),
            _email_subscription('kept@example.com'),
        )
        body = _settings_request(notification_emails=[
            ' KEPT@example.com ',
            'new@example.com',
            'new@example.com',
        ])

        status, response = _put_settings(alert_api, body)

        assert status == 200
        assert response['notification_emails'] == ['kept@example.com', 'new@example.com']
        assert alert_api.sns.unsubscribe.call_args.kwargs['SubscriptionArn'].endswith(':removed')
        assert alert_api.sns.subscribe.call_args.kwargs['Endpoint'] == 'new@example.com'

    def test_persists_flat_settings_and_returns_exact_nested_settings(self, alert_api, tables) -> None:
        updated_at = '2026-10-01T10:00:00Z'
        thresholds = {
            'mention_rate_drop': 12.5,
            'position_loss': 2.25,
            'competitor_top_n': 10,
            'improvement_after_content_change': 7.5,
        }
        request = _settings_request(enabled=False, notification_emails=[' Owner@Example.com '], **thresholds)

        with patch.object(alert_api, 'get_timestamp', return_value=updated_at):
            status, response = _put_settings(alert_api, request)

        assert status == 200
        assert response == {
            'config_id': 'default',
            'enabled': False,
            'notification_emails': ['owner@example.com'],
            'thresholds': thresholds,
            'updated_at': updated_at,
            'subscription_statuses': [{
                'email': 'owner@example.com',
                'status': 'pending_confirmation',
            }],
        }
        assert tables.settings.put_item.call_args.kwargs['Item'] == {
            'config_id': 'default',
            'enabled': False,
            'notification_emails': ['owner@example.com'],
            'mention_rate_drop': Decimal('12.5'),
            'position_loss': Decimal('2.25'),
            'competitor_top_n': 10,
            'improvement_after_content_change': Decimal('7.5'),
            'updated_at': updated_at,
        }

    def test_reports_pending_removed_subscription_as_sync_warning(self, alert_api) -> None:
        _subscribe(alert_api, _email_subscription('removed@example.com'))

        _status, response = _put_settings(alert_api, _settings_request())

        assert response['warnings'] == [
            'Pending confirmation for removed@example.com cannot be cancelled automatically.',
        ]
        assert alert_api.sns.unsubscribe.call_count == 0

    @pytest.mark.parametrize('email', ['not-an-email', 'a@localhost'])
    def test_rejects_invalid_email_without_persisting(self, alert_api, tables, email: str) -> None:
        status, body = _put_settings(alert_api, _settings_request(notification_emails=[email]))

        assert status == 400
        assert body['field'] == 'notification_emails'
        assert tables.settings.put_item.call_count == 0

    def test_rejects_flat_internal_settings_without_persisting(self, alert_api, tables) -> None:
        status, body = _put_settings(alert_api, _settings())

        assert status == 400
        assert body == {'error': 'Missing required setting: thresholds', 'field': 'thresholds'}
        assert tables.settings.put_item.call_count == 0

    @pytest.mark.parametrize(
        ('field_name', 'value', 'message'),
        [
            ('unexpected', 1, 'Unknown threshold: unexpected'),
            ('position_loss', '2.5', 'position_loss must be a finite number'),
        ],
    )
    def test_rejects_invalid_nested_threshold_without_persisting(
        self,
        alert_api,
        tables,
        field_name: str,
        value: object,
        message: str,
    ) -> None:
        request = _settings_request()
        request['thresholds'][field_name] = value

        status, body = _put_settings(alert_api, request)

        assert status == 400
        assert body == {'error': message, 'field': field_name}
        assert tables.settings.put_item.call_count == 0

    def test_denies_settings_update_for_non_admin_without_persisting(self, alert_api, tables) -> None:
        status, _body = _put_settings(alert_api, _settings_request(), _USER)

        assert status == 403
        assert tables.settings.put_item.call_count == 0


class TestContentChanges:
    def test_returns_exact_recent_marker_contract(self, alert_api, tables) -> None:
        tables.changes.query.return_value = {'Items': [{
            'group_id': 'group-1',
            'changed_at': '2026-10-01T10:00:00Z',
            'description': 'Published landing page',
            'ttl': Decimal('1822384800'),
        }]}

        status, body = _call(alert_api, 'GET', '/api/alerts/content-changes', query={'group_id': 'group-1', 'limit': '10'})

        assert status == 200
        assert body == {
            'items': [{
                'id': 'change-9a43216f26b0ec30a5155fa455915c49',
                'group_id': 'group-1',
                'changed_at': '2026-10-01T10:00:00Z',
                'description': 'Published landing page',
                'ttl': '1822384800',
            }],
            'count': 1,
        }
        assert tables.changes.query.call_args.kwargs['ScanIndexForward'] is False

    def test_writes_server_timestamped_marker_for_existing_group(self, alert_api, tables) -> None:
        tables.groups.get_item.return_value = {'Item': {'id': 'group-1'}}
        timestamp = '2026-10-01T10:00:00Z'

        with (
            patch.object(alert_api, 'get_timestamp', return_value=timestamp),
            patch.object(alert_api, 'validate_url_safe', return_value=(True, '')),
        ):
            status, body = _post_content_change(alert_api, _PUBLISHED_PAGE)

        assert status == 201
        assert body == {
            'id': deterministic_content_change_id('group-1', timestamp),
            **_PUBLISHED_PAGE,
            'changed_at': timestamp,
            'ttl': ttl_for_timestamp(timestamp),
        }
        assert tables.changes.put_item.call_args.kwargs['Item'] == body

    def test_rejects_unsafe_content_url_without_writing(self, alert_api, tables) -> None:
        with patch.object(
            alert_api,
            'validate_url_safe',
            return_value=(False, 'URL points to a restricted address'),
        ):
            status, body = _post_content_change(alert_api, {
                'group_id': 'group-1',
                'description': 'Update',
                'url': 'http://127.0.0.1/',
            })

        assert status == 400
        assert body['field'] == 'url'
        assert tables.changes.put_item.call_count == 0

    def test_rejects_marker_for_unknown_group(self, alert_api, tables) -> None:
        tables.groups.get_item.return_value = {}

        status, body = _post_content_change(alert_api, {'group_id': 'missing', 'description': 'Update'})

        assert status == 400
        assert body == {'error': 'Unknown keyword group id', 'field': 'group_id'}
        assert tables.changes.put_item.call_count == 0
