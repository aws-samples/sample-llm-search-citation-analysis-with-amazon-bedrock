"""
State-change events (TENETS.md, tenet 8): what the platform tells the default EventBridge bus when a job, a run step,
a narrative or an alert changes.

An event is thin: the ids of what changed and, where there is one, its new status. It never carries the state
itself, so every consumer reads that from the REST route (and MCP) that already serves it (tenet 4), and the
dashboard can never learn more from an event than its own read would show it.

The live-events relay (``lambda/live-events/``, ``CitationAnalysisEventsStack``) forwards each one to the AWS AppSync
Events channel the dashboard subscribes to; other consumers add an EventBridge rule. Step Functions status changes
(the analysis workflow, keyword research and the scope snapshot build) reach the bus from the service itself, and a
view job's ``view-job.finished`` from ``shared.view_job_events`` (its one producer, which the exports resume on); none
of them is published here.

Publishing is best effort. The change is already stored when it is announced, so a failed ``PutEvents`` is logged
and never fails or retries the work: the state stays readable, and a dashboard reads it when it next connects.
"""

from __future__ import annotations

import functools
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

#: Every source this platform publishes starts with it; the relay's rule matches the prefix.
SOURCE_PREFIX: Final = 'citation-analysis.'

#: EventBridge's limit for one entry is 256 KiB; a change event is ids only, so anything near this is a bug.
MAX_DETAIL_BYTES: Final = 4096


@dataclass(frozen=True)
class ChangeKind:
    """One kind of change: its EventBridge ``source`` and ``detail-type``."""

    source: str
    detail_type: str

    def __post_init__(self) -> None:
        # The relay's rule matches the prefix, so a kind outside it would never reach a dashboard.
        if not self.source.startswith(SOURCE_PREFIX):
            raise ValueError(f'change event source {self.source!r} does not start with {SOURCE_PREFIX!r}')


#: A step of an analysis run finished (``execution_id``, ``step``). The run's own status changes come from Step Functions.
RUN_STEP_FINISHED: Final = ChangeKind('citation-analysis.runs', 'run.step.finished')
#: A keyword research job changed (``job_id``): a round was planned, a step ran, the job was evaluated or ended.
RESEARCH_JOB_CHANGED: Final = ChangeKind('citation-analysis.research', 'research-job.changed')
#: A Content Studio item changed status (``content_id``, ``status``).
CONTENT_CHANGED: Final = ChangeKind('citation-analysis.content-studio', 'content.changed')
#: A ranking analysis finished (``keyword``, ``brand``, ``query_prompt_id``, ``status``).
SELF_REFLECTION_FINISHED: Final = ChangeKind('citation-analysis.insights', 'self-reflection.finished')
#: A keyword group's narrative request ended (``group_id``, ``market_id`` outside the global market, ``status``:
#: ``generated``, ``skipped`` or ``failed``), from a run's GenerateInsights step or an Admin's regenerate request.
NARRATIVE_FINISHED: Final = ChangeKind('citation-analysis.insights', 'narrative.finished')
#: The scope snapshots were built in-process (``status``); a distributed build announces itself through Step Functions.
SNAPSHOTS_BUILT: Final = ChangeKind('citation-analysis.snapshots', 'scope-snapshots.built')
#: A run raised KPI alerts (``execution_id``, ``count``).
KPI_ALERTS_RAISED: Final = ChangeKind('citation-analysis.alerts', 'kpi-alerts.raised')
#: An export changed status (``export_id``, ``status``, ``owner_sub``: only its owner's channel hears it).
EXPORT_CHANGED: Final = ChangeKind('citation-analysis.exports', 'export.changed')
#: A step of an SEO job ran (``feature``, ``id``): a rank-tracking run, local SEO job, Lighthouse run or site audit.
SEO_JOB_CHANGED: Final = ChangeKind('citation-analysis.seo', 'seo-job.changed')


#: What a publish may raise; logged, never raised into the work that changed state.
_PUBLISH_ERRORS = (BotoCoreError, ClientError, TypeError, ValueError)


@functools.cache
def _events_client() -> Any:
    return boto3.client('events')


def _entry(kind: ChangeKind, detail: Mapping[str, Any]) -> dict[str, str]:
    encoded = json.dumps(dict(detail), separators=(',', ':'), sort_keys=True, default=str)
    if len(encoded.encode('utf-8')) > MAX_DETAIL_BYTES:
        raise ValueError(f'{kind.detail_type} detail is {len(encoded)} bytes; change events carry ids only')
    return {'Source': kind.source, 'DetailType': kind.detail_type, 'Detail': encoded}


def publish_change(kind: ChangeKind, detail: Mapping[str, Any]) -> bool:
    """
    Put one ``kind`` event with ``detail`` on the default bus; whether EventBridge accepted it.

    Never raises: the change is stored before it is announced, and a lost announcement only delays a dashboard
    until its next catch-up read.
    """
    try:
        response = _events_client().put_events(Entries=[_entry(kind, detail)])
    except _PUBLISH_ERRORS:
        logger.warning('Could not publish %s', kind.detail_type, exc_info=True)
        return False
    if response.get('FailedEntryCount'):
        failure = (response.get('Entries') or [{}])[0]
        logger.warning('EventBridge refused %s: %s', kind.detail_type, failure.get('ErrorCode'))
        return False
    return True
