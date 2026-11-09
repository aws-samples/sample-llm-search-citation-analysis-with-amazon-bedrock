"""
The ``view-job.finished`` event (2.49.0): a view job tells EventBridge that it finished or failed.

``shared.view_jobs.run_view_job`` publishes it to the account's default bus
once the job's outcome is stored (the result object for ``done``, the
``failed`` status for ``failed``), so a consumer that reads the job after the
event always sees that outcome. The export state machine's rule
(``lib/citation-analysis-stack.ts``, ``ViewJobFinishedRule``) routes it to the
export worker, which resumes every export waiting on the job
(``shared.export_view_job_wait``). The live-events relay
(``CitationAnalysisEventsStack``) forwards the same event to the
``/deployment/view-jobs`` channel, so an open view waiting on the job reads
it again. It is the only producer of ``view-job.finished``.

Detail: ``{job_id, started_at, status}``. ``started_at`` names the run of the
job (a failed or dead job is started again under the same id), and
``status`` is ``done`` or ``failed``.

A failed publish is logged and does not fail the job: the waiting exports
then fall back to their timeout.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Final, Literal

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

SOURCE: Final = 'citation-analysis.view-jobs'
DETAIL_TYPE: Final = 'view-job.finished'
STATUS_DONE: Final = 'done'
STATUS_FAILED: Final = 'failed'

FinishedStatus = Literal['done', 'failed']


def finished_entry(job: str, started_at: str, status: FinishedStatus) -> dict[str, str]:
    """The ``PutEvents`` entry of job ``job``'s run ``started_at`` ending with ``status`` (default bus)."""
    return {
        'Source': SOURCE, 'DetailType': DETAIL_TYPE,
        'Detail': json.dumps({'job_id': job, 'started_at': started_at, 'status': status}, separators=(',', ':')),
    }


def publish_finished(events: Any, job: str, started_at: str, status: FinishedStatus) -> bool:
    """Publish the event; whether EventBridge took it (a refusal is logged, never raised)."""
    try:
        response = events.put_events(Entries=[finished_entry(job, started_at, status)])
    except (ClientError, BotoCoreError):
        logger.exception('View job %s: the %s event was not published', job, DETAIL_TYPE)
        return False
    if int(response.get('FailedEntryCount') or 0) > 0:
        logger.error('View job %s: EventBridge refused the %s event: %s', job, DETAIL_TYPE, response.get('Entries'))
        return False
    return True
