"""
Live-events relay (``CitationAnalysis-LiveEventsRelay``): forwards one EventBridge event to its AWS AppSync Events
channel (``live_channel_routes``), so an open dashboard is told a job changed instead of polling for it.

Invoked by the ``CitationAnalysisEventsStack`` rules: the platform's own change events (``citation-analysis.*``) and
the Step Functions status changes of the state machines in ``STATE_MACHINE_TOPICS``. It publishes over the Event
API's HTTP endpoint, signed with its role (``appsync:EventPublish`` on the two namespaces, nothing else). A refused
publish raises, so Lambda retries the asynchronous invocation (twice within the hour, ``CitationAnalysisEventsStack``)
before it drops the event; an event no channel hears is dropped at once.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from functools import cache
from typing import Any

import boto3
import urllib3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from live_channel_routes import ChannelMessage, channel_message

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Seconds for one publish; a relay invocation does one.
PUBLISH_TIMEOUT_SECONDS = 5.0


class RelayPublishError(RuntimeError):
    """AppSync Events did not accept the event; raised so the invocation is retried."""


@cache
def _http() -> urllib3.PoolManager:
    return urllib3.PoolManager(timeout=urllib3.Timeout(total=PUBLISH_TIMEOUT_SECONDS), retries=False)


@cache
def _state_machine_topics() -> dict[str, str]:
    parsed = json.loads(os.environ.get('STATE_MACHINE_TOPICS') or '{}')
    return {str(name): str(topic) for name, topic in parsed.items()} if isinstance(parsed, dict) else {}


def _event_url(domain: str) -> str:
    return f'https://{domain}/event'


def signed_publish_request(domain: str, region: str, routed: ChannelMessage, credentials: Any) -> AWSRequest:
    """The SigV4-signed ``POST https://<domain>/event`` that publishes ``routed`` as one event."""
    body = json.dumps({'channel': routed.channel, 'events': [json.dumps(routed.message, separators=(',', ':'))]})
    request = AWSRequest(
        method='POST', url=_event_url(domain), data=body.encode('utf-8'),
        headers={'content-type': 'application/json', 'host': domain},
    )
    SigV4Auth(credentials, 'appsync', region).add_auth(request)
    return request


def _publish(routed: ChannelMessage) -> None:
    domain = os.environ['EVENTS_HTTP_DOMAIN']
    region = os.environ['AWS_REGION']
    credentials = boto3.Session().get_credentials()
    if credentials is None:
        raise RelayPublishError('no credentials to sign the publish with')
    request = signed_publish_request(domain, region, routed, credentials.get_frozen_credentials())
    response = _http().request('POST', _event_url(domain), body=request.body, headers=dict(request.headers.items()))
    answer = json.loads(response.data or b'{}') if response.status == 200 else {}
    if response.status != 200 or answer.get('failed'):
        raise RelayPublishError(f'AppSync Events answered {response.status} for {routed.channel}')


def handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Publish ``event`` to its channel; what was done (``published`` with the channel, or ``dropped``)."""
    routed = channel_message(event, _state_machine_topics())
    if routed is None:
        logger.info('No channel for %s / %s', event.get('source'), event.get('detail-type'))
        return {'status': 'dropped'}
    _publish(routed)
    logger.info('Published %s to %s', routed.message.get('type'), routed.channel)
    return {'status': 'published', 'channel': routed.channel}
