"""API contract tests for KPI alerts, settings, and content markers."""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest
from botocore.exceptions import ClientError

from shared.kpi_alerts import (
    DEFAULT_ALERT_SETTINGS,
    deterministic_content_change_id,
    ttl_for_timestamp,
)
from testing.dynamodb_stubs import fake_dynamodb_resource
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
_ADMIN = {'cognito:groups': 'Admin', 'email': 'admin@example.com'}
_USER = {'cognito:groups': 'Users', 'email': 'reader@example.com'}

alert_api = handler_fixture(
    _API_DIR,
    'manage-alerts.py',
    'manage_alerts_under_test',
    env=_ENV,
)


def _settings(**overrides: object) -> dict:
    return {**DEFAULT_ALERT_SETTINGS, **overrides}


def _settings_request(**overrides: object) -> dict:
    settings = _settings(**overrides)
    return {
        'enabled': settings['enabled'],
        'notification_emails': settings['notification_emails'],
        'thresholds': {
            'citation_rate_drop': settings['citation_rate_drop'],
            'position_loss': settings['position_loss'],
            'competitor_top_n': settings['competitor_top_n'],
            'improvement_after_content_change': settings['improvement_after_content_change'],
        },
    }


def _event(
    method: str,
    path: str,
    *,
    body: object | None = None,
    query: dict[str, str] | None = None,
    claims: dict[str, str] | None = None,
    alert_id: str | None = None,
) -> dict:
    return api_gateway_event(
        method,
        path,
        body=body,
        query=query,
        claims=claims,
        path_params={'id': alert_id} if alert_id is not None else None,
        resource=path,
    )


def _settings_update(body: object, claims: dict[str, str] = _ADMIN) -> dict:
    return _event(
        'PUT',
        '/api/alerts/settings',
        body=body,
        claims=claims,
    )


def _email_subscription(email: str, arn: str = 'PendingConfirmation') -> dict[str, str]:
    return {'Protocol': 'email', 'Endpoint': email, 'SubscriptionArn': arn}


def _settings_backend(alert_api: Any, subscriptions: list[dict[str, str]]) -> MagicMock:
    settings = MagicMock()
    alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
    alert_api.sns = MagicMock()
    alert_api.sns.list_subscriptions_by_topic.return_value = {
        'Subscriptions': subscriptions,
    }
    return settings


class TestAlertHistory:
    def test_returns_open_alerts_newest_first_through_status_index(self, alert_api) -> None:
        alerts = MagicMock()
        alerts.query.return_value = {'Items': [
            {'id': 'new', 'status': 'open', 'created_at': '2026-10-02T10:00:00Z'},
            {'id': 'old', 'status': 'open', 'created_at': '2026-10-01T10:00:00Z'},
        ]}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts',
            query={'status': 'open', 'limit': '1'},
        ), None))

        assert status == 200
        assert body == {'items': [
            {'id': 'new', 'status': 'open', 'created_at': '2026-10-02T10:00:00Z'},
        ], 'count': 1}
        assert alerts.query.call_args.kwargs['IndexName'] == 'StatusCreatedIndex'
        assert alerts.scan.call_count == 0

    def test_returns_exact_backend_alert_shape(self, alert_api) -> None:
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
            'type': 'citation_rate_drop',
            'severity': 'warning',
            'previous': '64.0',
            'current': '52.0',
            'delta': '12.0',
            'threshold': '10.0',
            'entity': 'group-1',
            'message': 'Citation coverage fell by 12.0 percentage points.',
        }
        alerts = MagicMock()
        alerts.query.return_value = {'Items': [{
            **expected,
            'previous': Decimal('64.0'),
            'current': Decimal('52.0'),
            'delta': Decimal('12.0'),
            'threshold': Decimal('10.0'),
        }]}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts',
        ), None))

        assert status == 200
        assert body == {'items': [expected], 'count': 1}

    def test_merges_open_and_acknowledged_alerts_newest_first(self, alert_api) -> None:
        alerts = MagicMock()
        alerts.query.side_effect = [
            {'Items': [{'id': 'open', 'status': 'open', 'created_at': '2026-10-01T10:00:00Z'}]},
            {'Items': [{'id': 'ack', 'status': 'acknowledged', 'created_at': '2026-10-02T10:00:00Z'}]},
        ]
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        _status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts',
            query={'status': 'all', 'limit': '10'},
        ), None))

        assert [item['id'] for item in body['items']] == ['ack', 'open']
        assert body['count'] == 2
        assert alerts.query.call_count == 2

    def test_rejects_alert_limit_over_one_hundred(self, alert_api) -> None:
        status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts',
            query={'limit': '101'},
        ), None))

        assert status == 400
        assert body['field'] == 'limit'


class TestAcknowledgeAlert:
    def test_returns_exact_acknowledgement_contract_for_admin(self, alert_api) -> None:
        alerts = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/alert-1/acknowledge',
            claims=_ADMIN,
            alert_id='alert-1',
        ), None))

        assert status == 200
        assert body == {'success': True, 'id': 'alert-1', 'status': 'acknowledged'}
        assert alerts.update_item.call_args.kwargs['ExpressionAttributeValues'][':acknowledged'] is True

    def test_denies_acknowledgement_for_non_admin_without_writing(self, alert_api) -> None:
        alerts = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        status, _body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/alert-1/acknowledge',
            claims=_USER,
            alert_id='alert-1',
        ), None))

        assert status == 403
        assert alerts.update_item.call_count == 0

    def test_returns_not_found_when_alert_does_not_exist(self, alert_api) -> None:
        alerts = MagicMock()
        alerts.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ConditionalCheckFailedException', 'Message': 'missing'}},
            'UpdateItem',
        )
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'alerts': alerts})

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/missing/acknowledge',
            claims=_ADMIN,
            alert_id='missing',
        ), None))

        assert status == 404
        assert body == {'error': 'Alert not found'}


class TestTestNotification:
    def test_publishes_fixed_message_once_when_detection_is_disabled(self, alert_api) -> None:
        settings = _settings_backend(alert_api, [
            _email_subscription(
                'ops@example.com',
                'arn:aws:sns:us-east-1:123:kpi-alerts:confirmed',
            ),
            _email_subscription('pending@example.com'),
            _email_subscription(
                'caller@example.com',
                'arn:aws:sns:us-east-1:123:kpi-alerts:unconfigured',
            ),
        ])
        settings.get_item.return_value = {'Item': _settings(
            enabled=False,
            notification_emails=['OPS@example.com', 'pending@example.com'],
        )}

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/test-notification',
            claims=_ADMIN,
            body={
                'Subject': 'Caller subject',
                'Message': 'Caller message',
                'notification_emails': ['caller@example.com'],
            },
        ), None))

        assert (status, body) == (200, {
            'success': True,
            'message': 'Test notification accepted for delivery.',
        })
        assert settings.get_item.call_args_list == [call(Key={'config_id': 'default'})]
        assert alert_api.sns.publish.call_args_list == [call(
            TopicArn=_ENV['KPI_ALERTS_TOPIC_ARN'],
            Subject='Citation Analysis test notification',
            Message=(
                'This is a test notification from Citation Analysis. '
                'Email alert delivery is configured correctly.'
            ),
        )]
        assert settings.put_item.call_count == 0

    def test_rejects_when_no_configured_email_has_a_confirmed_subscription(
        self,
        alert_api,
    ) -> None:
        settings = _settings_backend(alert_api, [
            _email_subscription('ops@example.com'),
            _email_subscription(
                'unconfigured@example.com',
                'arn:aws:sns:us-east-1:123:kpi-alerts:unconfigured',
            ),
            {
                'Protocol': 'sms',
                'Endpoint': 'ops@example.com',
                'SubscriptionArn': 'arn:aws:sns:us-east-1:123:kpi-alerts:sms',
            },
        ])
        settings.get_item.return_value = {'Item': _settings(
            notification_emails=['ops@example.com'],
        )}

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/test-notification',
            claims=_ADMIN,
            body={'notification_emails': ['unconfigured@example.com']},
        ), None))

        assert status == 400
        assert body == {
            'error': 'At least one configured notification email must have a confirmed subscription',
            'field': 'notification_emails',
        }
        assert alert_api.sns.publish.call_count == 0
        assert settings.put_item.call_count == 0

    def test_returns_sanitized_error_when_subscription_status_cannot_be_verified(
        self,
        alert_api,
    ) -> None:
        settings = _settings_backend(alert_api, [])
        settings.get_item.return_value = {'Item': _settings(
            notification_emails=['ops@example.com'],
        )}
        alert_api.sns.list_subscriptions_by_topic.side_effect = RuntimeError('private SNS detail')

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/test-notification',
            claims=_ADMIN,
        ), None))

        assert status == 500
        assert body == {'error': 'An unexpected error occurred'}
        assert 'private SNS detail' not in str(body)
        assert alert_api.sns.publish.call_count == 0

    def test_returns_sanitized_error_without_persisting_when_publish_fails(
        self,
        alert_api,
    ) -> None:
        settings = _settings_backend(alert_api, [
            _email_subscription(
                'ops@example.com',
                'arn:aws:sns:us-east-1:123:kpi-alerts:confirmed',
            ),
        ])
        settings.get_item.return_value = {'Item': _settings(
            notification_emails=['ops@example.com'],
        )}
        alert_api.sns.publish.side_effect = ClientError(
            {'Error': {'Code': 'AccessDeniedException', 'Message': 'private AWS detail'}},
            'Publish',
        )

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/test-notification',
            claims=_ADMIN,
        ), None))

        assert status == 500
        assert body == {'error': 'Service temporarily unavailable'}
        assert 'private AWS detail' not in str(body)
        assert settings.put_item.call_count == 0


class TestAlertSettings:
    def test_returns_defaults_when_singleton_is_absent(self, alert_api) -> None:
        settings = MagicMock()
        settings.get_item.return_value = {}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
        alert_api.sns = MagicMock()
        alert_api.sns.list_subscriptions_by_topic.return_value = {'Subscriptions': []}

        status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts/settings',
        ), None))

        assert status == 200
        assert body == {
            'config_id': 'default',
            'enabled': True,
            'notification_emails': [],
            'thresholds': {
                'citation_rate_drop': 10.0,
                'position_loss': 1.0,
                'competitor_top_n': 3,
                'improvement_after_content_change': 5.0,
            },
            'subscription_statuses': [],
        }

    def test_returns_safe_sync_warning_when_subscription_listing_fails(self, alert_api) -> None:
        settings = MagicMock()
        settings.get_item.return_value = {'Item': _settings(
            notification_emails=['ops@example.com'],
        )}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
        alert_api.sns = MagicMock()
        alert_api.sns.list_subscriptions_by_topic.side_effect = RuntimeError('private SNS detail')

        _status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts/settings',
        ), None))

        assert body['subscription_statuses'] == [
            {'email': 'ops@example.com', 'status': 'unknown'},
        ]
        assert body['warnings'] == ['Subscription status could not be synchronized.']
        assert 'private SNS detail' not in str(body)

    def test_lists_confirmed_and_pending_subscriptions_across_pages(self, alert_api) -> None:
        settings = MagicMock()
        settings.get_item.return_value = {'Item': {
            **_settings(notification_emails=['ops@example.com', 'team@example.com']),
            'updated_at': '2026-09-30T10:00:00Z',
        }}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
        alert_api.sns = MagicMock()
        alert_api.sns.list_subscriptions_by_topic.side_effect = [
            {
                'Subscriptions': [{
                    'Protocol': 'email',
                    'Endpoint': 'ops@example.com',
                    'SubscriptionArn': 'PendingConfirmation',
                }],
                'NextToken': 'page-2',
            },
            {'Subscriptions': [{
                'Protocol': 'email',
                'Endpoint': 'team@example.com',
                'SubscriptionArn': 'arn:aws:sns:us-east-1:123:topic:confirmed',
            }]},
        ]

        _status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts/settings',
        ), None))

        assert body == {
            'config_id': 'default',
            'enabled': True,
            'notification_emails': ['ops@example.com', 'team@example.com'],
            'thresholds': {
                'citation_rate_drop': 10.0,
                'position_loss': 1.0,
                'competitor_top_n': 3,
                'improvement_after_content_change': 5.0,
            },
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
        _settings_backend(alert_api, [
            _email_subscription(
                'removed@example.com',
                'arn:aws:sns:us-east-1:123:topic:removed',
            ),
            _email_subscription('kept@example.com'),
        ])
        body = _settings_request(notification_emails=[
            ' KEPT@example.com ',
            'new@example.com',
            'new@example.com',
        ])

        status, response = parse_response(alert_api.handler(
            _settings_update(body),
            None,
        ))

        assert status == 200
        assert response['notification_emails'] == ['kept@example.com', 'new@example.com']
        assert alert_api.sns.unsubscribe.call_args.kwargs['SubscriptionArn'].endswith(':removed')
        assert alert_api.sns.subscribe.call_args.kwargs['Endpoint'] == 'new@example.com'

    def test_persists_flat_settings_and_returns_exact_nested_settings(self, alert_api) -> None:
        settings_table = _settings_backend(alert_api, [])
        updated_at = '2026-10-01T10:00:00Z'
        request = _settings_request(
            enabled=False,
            notification_emails=[' Owner@Example.com '],
            citation_rate_drop=12.5,
            position_loss=2.25,
            competitor_top_n=10,
            improvement_after_content_change=7.5,
        )

        with patch.object(alert_api, 'get_timestamp', return_value=updated_at):
            status, response = parse_response(alert_api.handler(
                _settings_update(request),
                None,
            ))

        assert status == 200
        assert response == {
            'config_id': 'default',
            'enabled': False,
            'notification_emails': ['owner@example.com'],
            'thresholds': {
                'citation_rate_drop': 12.5,
                'position_loss': 2.25,
                'competitor_top_n': 10,
                'improvement_after_content_change': 7.5,
            },
            'updated_at': updated_at,
            'subscription_statuses': [{
                'email': 'owner@example.com',
                'status': 'pending_confirmation',
            }],
        }
        assert settings_table.put_item.call_args.kwargs['Item'] == {
            'config_id': 'default',
            'enabled': False,
            'notification_emails': ['owner@example.com'],
            'citation_rate_drop': Decimal('12.5'),
            'position_loss': Decimal('2.25'),
            'competitor_top_n': 10,
            'improvement_after_content_change': Decimal('7.5'),
            'updated_at': updated_at,
        }

    def test_reports_pending_removed_subscription_as_sync_warning(self, alert_api) -> None:
        _settings_backend(alert_api, [
            _email_subscription('removed@example.com'),
        ])

        _status, response = parse_response(alert_api.handler(
            _settings_update(_settings_request()),
            None,
        ))

        assert response['warnings'] == [
            'Pending confirmation for removed@example.com cannot be cancelled automatically.',
        ]
        assert alert_api.sns.unsubscribe.call_count == 0

    @pytest.mark.parametrize('email', ['not-an-email', 'a@localhost'])
    def test_rejects_invalid_email_without_persisting(self, alert_api, email: str) -> None:
        settings = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
        alert_api.sns = MagicMock()

        status, body = parse_response(alert_api.handler(
            _settings_update(_settings_request(notification_emails=[email])),
            None,
        ))

        assert status == 400
        assert body['field'] == 'notification_emails'
        assert settings.put_item.call_count == 0

    def test_rejects_flat_internal_settings_without_persisting(self, alert_api) -> None:
        settings = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})

        status, body = parse_response(alert_api.handler(
            _settings_update(_settings()),
            None,
        ))

        assert status == 400
        assert body == {'error': 'Missing required setting: thresholds', 'field': 'thresholds'}
        assert settings.put_item.call_count == 0

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
        field_name: str,
        value: object,
        message: str,
    ) -> None:
        settings = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})
        request = _settings_request()
        request['thresholds'][field_name] = value

        status, body = parse_response(alert_api.handler(
            _settings_update(request),
            None,
        ))

        assert status == 400
        assert body == {'error': message, 'field': field_name}
        assert settings.put_item.call_count == 0

    def test_denies_settings_update_for_non_admin_without_persisting(self, alert_api) -> None:
        settings = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'settings': settings})

        status, _body = parse_response(alert_api.handler(
            _settings_update(_settings_request(), _USER),
            None,
        ))

        assert status == 403
        assert settings.put_item.call_count == 0


class TestContentChanges:
    def test_returns_exact_recent_marker_contract(self, alert_api) -> None:
        changes = MagicMock()
        changes.query.return_value = {'Items': [{
            'group_id': 'group-1',
            'changed_at': '2026-10-01T10:00:00Z',
            'description': 'Published landing page',
            'ttl': Decimal('1822384800'),
        }]}
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'changes': changes})

        status, body = parse_response(alert_api.handler(_event(
            'GET',
            '/api/alerts/content-changes',
            query={'group_id': 'group-1', 'limit': '10'},
        ), None))

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
        assert changes.query.call_args.kwargs['ScanIndexForward'] is False

    def test_writes_server_timestamped_marker_for_existing_group(self, alert_api) -> None:
        groups = MagicMock()
        groups.get_item.return_value = {'Item': {'id': 'group-1'}}
        changes = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={
            'groups': groups,
            'changes': changes,
        })
        timestamp = '2026-10-01T10:00:00Z'

        with (
            patch.object(alert_api, 'get_timestamp', return_value=timestamp),
            patch.object(alert_api, 'validate_url_safe', return_value=(True, '')),
        ):
            status, body = parse_response(alert_api.handler(_event(
                'POST',
                '/api/alerts/content-changes',
                body={
                    'group_id': 'group-1',
                    'description': 'Published landing page',
                    'url': 'https://example.com/page',
                },
                claims=_ADMIN,
            ), None))

        assert status == 201
        assert body == {
            'id': deterministic_content_change_id('group-1', timestamp),
            'group_id': 'group-1',
            'description': 'Published landing page',
            'url': 'https://example.com/page',
            'changed_at': timestamp,
            'ttl': ttl_for_timestamp(timestamp),
        }
        assert changes.put_item.call_args.kwargs['Item'] == body

    def test_rejects_unsafe_content_url_without_writing(self, alert_api) -> None:
        changes = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={'changes': changes})

        with patch.object(
            alert_api,
            'validate_url_safe',
            return_value=(False, 'URL points to a restricted address'),
        ):
            status, body = parse_response(alert_api.handler(_event(
                'POST',
                '/api/alerts/content-changes',
                body={
                    'group_id': 'group-1',
                    'description': 'Update',
                    'url': 'http://127.0.0.1/',
                },
                claims=_ADMIN,
            ), None))

        assert status == 400
        assert body['field'] == 'url'
        assert changes.put_item.call_count == 0

    def test_rejects_marker_for_unknown_group(self, alert_api) -> None:
        groups = MagicMock()
        groups.get_item.return_value = {}
        changes = MagicMock()
        alert_api.dynamodb = fake_dynamodb_resource(by_name={
            'groups': groups,
            'changes': changes,
        })

        status, body = parse_response(alert_api.handler(_event(
            'POST',
            '/api/alerts/content-changes',
            body={'group_id': 'missing', 'description': 'Update'},
            claims=_ADMIN,
        ), None))

        assert status == 400
        assert body == {'error': 'Unknown keyword group id', 'field': 'group_id'}
        assert changes.put_item.call_count == 0
