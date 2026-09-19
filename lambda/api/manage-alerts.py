"""Authenticated KPI alerts, settings, and content-change marker API."""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import (
    api_handler,
    cors_preflight,
    parse_json_body,
    route_handler,
    validate,
)
from shared.kpi_alerts import (
    decimal_item,
    deterministic_content_change_id,
    resolve_settings,
    ttl_for_timestamp,
    validate_settings,
)
from shared.url_validator import validate_url_safe
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ALERTS_TABLE = os.environ['DYNAMODB_TABLE_KPI_ALERTS']
SETTINGS_TABLE = os.environ['DYNAMODB_TABLE_ALERT_SETTINGS']
CONTENT_CHANGES_TABLE = os.environ['DYNAMODB_TABLE_CONTENT_CHANGES']
KEYWORD_GROUPS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORD_GROUPS']
ALERTS_TOPIC_ARN = os.environ['KPI_ALERTS_TOPIC_ARN']

_MAX_DESCRIPTION_LENGTH = 200
_MAX_URL_LENGTH = 2048
_CONFIRMED_ARN_PREFIX = 'arn:'

dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')


def _conditional_failure(exc: ClientError) -> bool:
    return exc.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def _query_alert_status(status: str, limit: int) -> list[dict[str, Any]]:
    response = dynamodb.Table(ALERTS_TABLE).query(
        IndexName='StatusCreatedIndex',
        KeyConditionExpression=Key('status').eq(status),
        ScanIndexForward=False,
        Limit=limit,
    )
    return response.get('Items', [])


@validate({
    'status': {
        'type': str,
        'choices': ['open', 'acknowledged', 'all'],
        'default': 'open',
    },
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 50},
})
def _list_alerts(
    event: dict[str, Any],
    context: Any,
    status: str,
    limit: int,
) -> dict[str, Any]:
    """GET /api/alerts — newest alerts through the status GSI only."""
    statuses = ('open', 'acknowledged') if status == 'all' else (status,)
    items = [
        item
        for selected_status in statuses
        for item in _query_alert_status(selected_status, limit)
    ]
    items.sort(key=lambda item: str(item.get('created_at', '')), reverse=True)
    selected = items[:limit]
    return success_response({'items': selected, 'count': len(selected)}, event)


def _alert_id(event: dict[str, Any]) -> str | None:
    value = (event.get('pathParameters') or {}).get('id')
    return value.strip() if isinstance(value, str) and value.strip() else None


@require_group(ADMIN_GROUP)
def _acknowledge_alert(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /api/alerts/{id}/acknowledge — mark one existing alert."""
    alert_id = _alert_id(event)
    if alert_id is None or len(alert_id) > 128:
        return validation_error('Alert id is required and must be at most 128 characters', event, 'id')
    try:
        dynamodb.Table(ALERTS_TABLE).update_item(
            Key={'id': alert_id},
            UpdateExpression='SET #status = :status, acknowledged = :acknowledged, acknowledged_at = :acknowledged_at',
            ConditionExpression='attribute_exists(id)',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'acknowledged',
                ':acknowledged': True,
                ':acknowledged_at': get_timestamp(),
            },
        )
    except ClientError as exc:
        if _conditional_failure(exc):
            return not_found_response('Alert', event)
        raise
    return success_response({
        'success': True,
        'id': alert_id,
        'status': 'acknowledged',
    }, event)


def _list_email_subscriptions() -> tuple[list[dict[str, Any]] | None, str | None]:
    subscriptions: list[dict[str, Any]] = []
    params: dict[str, Any] = {'TopicArn': ALERTS_TOPIC_ARN}
    try:
        while True:
            response = sns.list_subscriptions_by_topic(**params)
            subscriptions.extend(
                item
                for item in response.get('Subscriptions', [])
                if item.get('Protocol') == 'email' and isinstance(item.get('Endpoint'), str)
            )
            token = response.get('NextToken')
            if not token:
                return subscriptions, None
            params['NextToken'] = token
    except Exception:
        logger.exception('Unable to list KPI alert subscriptions')
        return None, 'Subscription status could not be synchronized.'


def _subscription_status(item: dict[str, Any]) -> dict[str, str]:
    email = str(item['Endpoint']).lower()
    subscription_arn = item.get('SubscriptionArn')
    status = (
        'confirmed'
        if isinstance(subscription_arn, str) and subscription_arn.startswith(_CONFIRMED_ARN_PREFIX)
        else 'pending_confirmation'
    )
    return {'email': email, 'status': status}


def _statuses_for(
    emails: list[str],
    subscriptions: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    if subscriptions is None:
        return [{'email': email, 'status': 'unknown'} for email in emails]

    by_email: dict[str, dict[str, str]] = {}
    for item in subscriptions:
        status = _subscription_status(item)
        email = status['email']
        current = by_email.get(email)
        if current is None or status['status'] == 'confirmed':
            by_email[email] = status
    return [
        by_email.get(email, {'email': email, 'status': 'not_subscribed'})
        for email in emails
    ]


def _settings_response(
    settings: dict[str, Any],
    subscriptions: list[dict[str, Any]] | None,
    *,
    updated_at: str | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    result = {
        'config_id': 'default',
        'enabled': settings['enabled'],
        'notification_emails': settings['notification_emails'],
        'thresholds': {
            'citation_rate_drop': settings['citation_rate_drop'],
            'position_loss': settings['position_loss'],
            'competitor_top_n': settings['competitor_top_n'],
            'improvement_after_content_change': settings['improvement_after_content_change'],
        },
        'subscription_statuses': _statuses_for(
            settings['notification_emails'],
            subscriptions,
        ),
    }
    if updated_at is not None:
        result['updated_at'] = updated_at
    if warnings:
        result['warnings'] = warnings
    return result


def _stored_settings() -> tuple[dict[str, Any], str | None]:
    response = dynamodb.Table(SETTINGS_TABLE).get_item(Key={'config_id': 'default'})
    item = response.get('Item')
    updated_at = item.get('updated_at') if isinstance(item, dict) else None
    return resolve_settings(item), updated_at if isinstance(updated_at, str) else None


def _get_settings(event: dict[str, Any], context: Any) -> dict[str, Any]:
    settings, updated_at = _stored_settings()
    subscriptions, warning = _list_email_subscriptions()
    warnings = [warning] if warning else None
    return success_response(
        _settings_response(
            settings,
            subscriptions,
            updated_at=updated_at,
            warnings=warnings,
        ),
        event,
    )


def _subscriptions_by_email(
    subscriptions: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for item in subscriptions:
        result.setdefault(str(item['Endpoint']).lower(), []).append(item)
    return result


def _unsubscribe_removed(
    desired: set[str],
    subscriptions: list[dict[str, Any]],
    warnings: list[str],
) -> None:
    for item in subscriptions:
        email = str(item['Endpoint']).lower()
        if email in desired:
            continue
        subscription_arn = item.get('SubscriptionArn')
        if not isinstance(subscription_arn, str) or not subscription_arn.startswith(_CONFIRMED_ARN_PREFIX):
            warnings.append(f'Pending confirmation for {email} cannot be cancelled automatically.')
            continue
        try:
            sns.unsubscribe(SubscriptionArn=subscription_arn)
        except Exception:
            logger.exception('Unable to unsubscribe a removed KPI alert recipient')
            warnings.append(f'Could not unsubscribe {email}.')


def _subscribe_missing(
    emails: list[str],
    by_email: dict[str, list[dict[str, Any]]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    added: list[dict[str, Any]] = []
    for email in emails:
        if email in by_email:
            continue
        try:
            sns.subscribe(
                TopicArn=ALERTS_TOPIC_ARN,
                Protocol='email',
                Endpoint=email,
                ReturnSubscriptionArn=True,
            )
            added.append({
                'Protocol': 'email',
                'Endpoint': email,
                'SubscriptionArn': 'PendingConfirmation',
            })
        except Exception:
            logger.exception('Unable to subscribe a KPI alert recipient')
            warnings.append(f'Could not request a subscription for {email}.')
    return added


def _reconcile_subscriptions(settings: dict[str, Any]) -> tuple[list[dict[str, Any]] | None, list[str]]:
    subscriptions, list_warning = _list_email_subscriptions()
    warnings = [list_warning] if list_warning else []
    if subscriptions is None:
        return None, warnings

    desired = set(settings['notification_emails'])
    by_email = _subscriptions_by_email(subscriptions)
    _unsubscribe_removed(desired, subscriptions, warnings)
    subscriptions.extend(_subscribe_missing(settings['notification_emails'], by_email, warnings))
    remaining = [
        item
        for item in subscriptions
        if str(item['Endpoint']).lower() in desired
    ]
    return remaining, warnings


def _validate_settings_update(
    body: Any,
    event: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not isinstance(body, dict):
        return None, validation_error('Request body must be a JSON object', event, 'body')

    required = {'enabled', 'notification_emails', 'thresholds'}
    missing = sorted(required - body.keys())
    if missing:
        return None, validation_error(f'Missing required setting: {missing[0]}', event, missing[0])
    unexpected = sorted(body.keys() - required)
    if unexpected:
        return None, validation_error(f'Unknown setting: {unexpected[0]}', event, unexpected[0])

    thresholds = body.get('thresholds')
    threshold_fields = {
        'citation_rate_drop',
        'position_loss',
        'competitor_top_n',
        'improvement_after_content_change',
    }
    if not isinstance(thresholds, dict):
        return None, validation_error('thresholds must be a JSON object', event, 'thresholds')
    missing_thresholds = sorted(threshold_fields - thresholds.keys())
    if missing_thresholds:
        field = missing_thresholds[0]
        return None, validation_error(f'Missing required threshold: {field}', event, field)
    unexpected_thresholds = sorted(thresholds.keys() - threshold_fields)
    if unexpected_thresholds:
        field = unexpected_thresholds[0]
        return None, validation_error(f'Unknown threshold: {field}', event, field)

    settings, error, field = validate_settings({
        'enabled': body['enabled'],
        'notification_emails': body['notification_emails'],
        **thresholds,
    })
    if error is not None or settings is None:
        return None, validation_error(error or 'Invalid settings', event, field)
    return settings, None


@require_group(ADMIN_GROUP)
@parse_json_body
def _put_settings(
    event: dict[str, Any],
    context: Any,
    body: Any,
) -> dict[str, Any]:
    settings, rejected = _validate_settings_update(body, event)
    if rejected is not None or settings is None:
        return rejected

    updated_at = get_timestamp()
    dynamodb.Table(SETTINGS_TABLE).put_item(Item=decimal_item({
        'config_id': 'default',
        **settings,
        'updated_at': updated_at,
    }))
    subscriptions, warnings = _reconcile_subscriptions(settings)
    return success_response(
        _settings_response(
            settings,
            subscriptions,
            updated_at=updated_at,
            warnings=warnings,
        ),
        event,
    )


def _content_change_response(item: dict[str, Any]) -> dict[str, Any]:
    group_id = str(item.get('group_id', ''))
    changed_at = str(item.get('changed_at', ''))
    marker = {
        'id': deterministic_content_change_id(group_id, changed_at),
        'group_id': group_id,
        'changed_at': changed_at,
        'description': str(item.get('description', '')),
        'ttl': item.get('ttl') or ttl_for_timestamp(changed_at),
    }
    if item.get('url'):
        marker['url'] = str(item['url'])
    return marker


@validate({
    'group_id': {'required': True, 'type': str, 'max_length': 64},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 50},
})
def _list_content_changes(
    event: dict[str, Any],
    context: Any,
    group_id: str,
    limit: int,
) -> dict[str, Any]:
    response = dynamodb.Table(CONTENT_CHANGES_TABLE).query(
        KeyConditionExpression=Key('group_id').eq(group_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    items = [_content_change_response(item) for item in response.get('Items', [])]
    return success_response({'items': items, 'count': len(items)}, event)


def _validate_content_change(
    body: Any,
    event: dict[str, Any],
) -> tuple[dict[str, str] | None, dict[str, Any] | None]:
    if not isinstance(body, dict):
        return None, validation_error('Request body must be a JSON object', event, 'body')
    unexpected = sorted(body.keys() - {'group_id', 'description', 'url'})
    if unexpected:
        return None, validation_error(f'Unknown field: {unexpected[0]}', event, unexpected[0])

    group_id = body.get('group_id')
    if not isinstance(group_id, str) or not group_id.strip() or len(group_id.strip()) > 64:
        return None, validation_error('group_id is required and must be at most 64 characters', event, 'group_id')
    description = body.get('description')
    if (
        not isinstance(description, str)
        or not description.strip()
        or len(description.strip()) > _MAX_DESCRIPTION_LENGTH
    ):
        return None, validation_error(
            f'description is required and must be at most {_MAX_DESCRIPTION_LENGTH} characters',
            event,
            'description',
        )

    validated = {'group_id': group_id.strip(), 'description': description.strip()}
    raw_url = body.get('url')
    if raw_url is not None:
        if not isinstance(raw_url, str) or not raw_url.strip() or len(raw_url.strip()) > _MAX_URL_LENGTH:
            return None, validation_error(f'url must be at most {_MAX_URL_LENGTH} characters', event, 'url')
        url = raw_url.strip()
        safe, reason = validate_url_safe(url)
        if not safe:
            return None, validation_error(reason, event, 'url')
        validated['url'] = url
    return validated, None


@require_group(ADMIN_GROUP)
@parse_json_body
def _create_content_change(
    event: dict[str, Any],
    context: Any,
    body: Any,
) -> dict[str, Any]:
    values, rejected = _validate_content_change(body, event)
    if rejected is not None or values is None:
        return rejected
    group_id = values['group_id']
    if not dynamodb.Table(KEYWORD_GROUPS_TABLE).get_item(Key={'id': group_id}).get('Item'):
        return validation_error('Unknown keyword group id', event, 'group_id')

    timestamp = get_timestamp()
    marker: dict[str, Any] = {
        'id': deterministic_content_change_id(group_id, timestamp),
        **values,
        'changed_at': timestamp,
        'ttl': ttl_for_timestamp(timestamp),
    }
    dynamodb.Table(CONTENT_CHANGES_TABLE).put_item(Item=marker)
    return success_response(marker, event, 201)


@api_handler
@cors_preflight
@route_handler({
    ('GET', '/settings'): _get_settings,
    ('PUT', '/settings'): _put_settings,
    ('GET', '/content-changes'): _list_content_changes,
    ('POST', '/content-changes'): _create_content_change,
    ('POST', '/acknowledge'): _acknowledge_alert,
    'GET': _list_alerts,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route KPI alert API requests."""
    pass
