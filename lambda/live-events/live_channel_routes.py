"""
Which AWS AppSync Events channel hears which EventBridge event, and what it is told.

Two channel namespaces (``CitationAnalysisEventsStack``):

- ``/deployment/<topic>``: state every signed-in user of the deployment may read through the REST API (runs,
  research jobs, Content Studio, ranking analyses, narratives, view jobs, snapshots, KPI alerts, SEO jobs). Any
  Cognito user of the deployment's user pool may subscribe.
- ``/user/<sub>/<topic>``: state only its owner may read (exports). The namespace's ``onSubscribe`` handler refuses
  a subscription whose second segment is not the caller's own Cognito ``sub``, so a user hears only their own.

A message is the event's ``detail-type`` as ``type`` plus the ids and status the route names, never anything else
from the event: the client reads the state itself from its REST route, so a channel tells a user no more than a
read would. A route is chosen by the event's source and detail-type only; a producer cannot pick a channel.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

DEPLOYMENT_NAMESPACE: Final = 'deployment'
USER_NAMESPACE: Final = 'user'

#: A channel segment AppSync Events accepts (letters, digits and inner dashes, at most 50); a Cognito sub is one.
_SEGMENT = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?')
#: A copied field longer than this is dropped: ids and statuses are short.
MAX_FIELD_LENGTH: Final = 512

STEP_FUNCTIONS_SOURCE: Final = 'aws.states'
STEP_FUNCTIONS_STATUS_CHANGE: Final = 'Step Functions Execution Status Change'


@dataclass(frozen=True)
class ChannelRoute:
    """The topic an event goes to, the detail fields copied into the message, and whether it is its owner's only."""

    topic: str
    fields: tuple[str, ...]
    owner_only: bool = False


#: Events this platform publishes (``shared.change_events``, and the workflow's keyword step), by source and detail-type.
ROUTES: Final[Mapping[tuple[str, str], ChannelRoute]] = {
    ('citation-analysis.runs', 'run.step.finished'): ChannelRoute('runs', ('execution_id', 'step')),
    ('citation-analysis.runs', 'run.keyword.finished'): ChannelRoute('runs', ('status',)),
    ('citation-analysis.research', 'research-job.changed'): ChannelRoute('research', ('job_id',)),
    ('citation-analysis.content-studio', 'content.changed'): ChannelRoute('content-studio', ('content_id', 'status')),
    ('citation-analysis.insights', 'self-reflection.finished'): ChannelRoute(
        'insights', ('keyword', 'brand', 'query_prompt_id', 'status')
    ),
    ('citation-analysis.insights', 'narrative.finished'): ChannelRoute('insights', ('group_id', 'market_id', 'status')),
    ('citation-analysis.views', 'view-job.finished'): ChannelRoute('view-jobs', ('job_id', 'status')),
    ('citation-analysis.snapshots', 'scope-snapshots.built'): ChannelRoute('snapshots', ('status',)),
    ('citation-analysis.alerts', 'kpi-alerts.raised'): ChannelRoute('alerts', ('execution_id', 'count')),
    ('citation-analysis.exports', 'export.changed'): ChannelRoute('exports', ('export_id', 'status'), owner_only=True),
    ('citation-analysis.seo', 'seo-job.changed'): ChannelRoute('seo', ('feature', 'id')),
}

#: The ``type`` of a Step Functions status change as the channel tells it.
EXECUTION_STATUS_TYPE: Final = 'execution.status'


@dataclass(frozen=True)
class ChannelMessage:
    channel: str
    message: dict[str, Any]


def is_channel_segment(value: Any) -> bool:
    return isinstance(value, str) and _SEGMENT.fullmatch(value) is not None


def _copied(detail: Mapping[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    copied: dict[str, Any] = {}
    for field in fields:
        value = detail.get(field)
        if isinstance(value, bool) or not isinstance(value, str | int | float):
            continue
        if isinstance(value, str) and len(value) > MAX_FIELD_LENGTH:
            continue
        copied[field] = value
    return copied


def _own_event(event: Mapping[str, Any], route: ChannelRoute, detail: Mapping[str, Any]) -> ChannelMessage | None:
    message = {'type': event['detail-type'], **_copied(detail, route.fields)}
    if not route.owner_only:
        return ChannelMessage(f'/{DEPLOYMENT_NAMESPACE}/{route.topic}', message)
    owner = detail.get('owner_sub')
    # No valid owner: nobody may hear it (fail closed), never the deployment channel.
    if not is_channel_segment(owner):
        return None
    return ChannelMessage(f'/{USER_NAMESPACE}/{owner}/{route.topic}', message)


def _input_job_id(detail: Mapping[str, Any]) -> str | None:
    """The ``job_id`` of the execution's input (a keyword research execution), when the event carries the input."""
    raw = detail.get('input')
    if not isinstance(raw, str):
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    job = parsed.get('job_id') if isinstance(parsed, dict) else None
    return job if isinstance(job, str) and len(job) <= MAX_FIELD_LENGTH else None


def _execution_event(detail: Mapping[str, Any], topics: Mapping[str, str]) -> ChannelMessage | None:
    arn = detail.get('stateMachineArn')
    name = arn.rsplit(':', 1)[-1] if isinstance(arn, str) else None
    topic = topics.get(name) if name else None
    if topic is None:
        return None
    message = {
        'type': EXECUTION_STATUS_TYPE, 'state_machine': name,
        **_copied(detail, ('executionArn', 'name', 'status')),
    }
    job = _input_job_id(detail)
    if job is not None:
        message['job_id'] = job
    return ChannelMessage(f'/{DEPLOYMENT_NAMESPACE}/{topic}', message)


def channel_message(event: Mapping[str, Any], state_machine_topics: Mapping[str, str]) -> ChannelMessage | None:
    """
    The channel and message for one EventBridge ``event``; ``None`` when no channel hears it.

    ``state_machine_topics`` maps a state machine name to the deployment topic its status changes go to.
    """
    detail = event.get('detail')
    source, detail_type = event.get('source'), event.get('detail-type')
    if not isinstance(detail, Mapping):
        return None
    if source == STEP_FUNCTIONS_SOURCE and detail_type == STEP_FUNCTIONS_STATUS_CHANGE:
        return _execution_event(detail, state_machine_topics)
    route = ROUTES.get((source, detail_type)) if isinstance(source, str) and isinstance(detail_type, str) else None
    return None if route is None else _own_event(event, route, detail)
