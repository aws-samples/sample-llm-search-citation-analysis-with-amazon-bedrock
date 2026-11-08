"""Lighthouse run steps (state machine ``CitationAnalysis-SeoLighthouse``), dispatched by ``seo-jobs.py``.

- ``lighthouse.measure``: measures the run's next unmeasured target (one billed DataForSEO Lighthouse call),
  keeps the full report in S3 and its compact summary in the run, and answers whether targets remain. A
  target that already has a result is never measured again, so a step re-run after a crash cannot buy the
  same report twice; the state machine never retries this step either. A refused or failed call is recorded
  on that target (with its cost when DataForSEO billed it) and the run goes on with the next one.
- ``lighthouse.fail``: marks the run ``failed`` when a step itself crashed, so the dashboard stops polling.

Targets are measured one at a time: a report is parsed whole in memory (up to 10 MB of JSON), and one at a
time keeps the step well inside the function's memory. Every step returns ``{run_id, done}`` only.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_lighthouse import ChargedReportError, run_lighthouse
from shared.lighthouse_runs import TERMINAL_STATUSES, fail_run, load_run, remember_run, save_report, save_run
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

CALL_FAILED_MESSAGE = 'DataForSEO could not run Lighthouse on this page'
STEP_FAILED_MESSAGE = 'The Lighthouse run stopped unexpectedly'
#: What each refusal code tells the user; other codes read ``CALL_FAILED_MESSAGE``.
ERROR_MESSAGES = {
    'NOT_CONFIGURED': 'DataForSEO is not configured: add its login in Settings > AI Providers',
    'AUTH_FAILED': 'DataForSEO rejected the login',
    'BILLING_ISSUE': 'The DataForSEO account balance is too low',
    'RATE_LIMITED': 'DataForSEO rate limit reached; run this page again later',
}


class MissingRunError(LookupError):
    """The event names a run the cache does not hold (expired or never written)."""


def _run(event: dict[str, Any]) -> dict[str, Any]:
    run_id = event.get('run_id')
    run = load_run(run_id) if isinstance(run_id, str) else None
    if run is None:
        raise MissingRunError(f'Lighthouse run {run_id!r} not found')
    return run


def _failed(target: dict[str, str], message: str, cost_usd: float | None) -> dict[str, Any]:
    return {**target, 'status': 'failed', 'error': message, 'cost_usd': cost_usd, 'fetched_at': get_timestamp()}


def measure_target(run_id: str, index: int, target: dict[str, str]) -> dict[str, Any]:
    """The result of one target: its summary (and the S3 key of its report) or why it failed."""
    try:
        measured = run_lighthouse(target['url'], 'mobile' if target['device'] == 'mobile' else 'desktop')
    except DataForSeoError as error:
        logger.warning('lighthouse %s target %s refused: %s', run_id, index, error.code)
        return _failed(target, ERROR_MESSAGES.get(error.code, CALL_FAILED_MESSAGE), error.cost_usd)
    except ChargedReportError as error:
        logger.warning('lighthouse %s target %s returned no usable report', run_id, index)
        return _failed(target, str(error), error.cost_usd)
    key = save_report(run_id, index, measured.report)
    return {
        **target, **measured.summary, 'status': 'completed', 'task_id': measured.task_id,
        'cost_usd': measured.cost_usd, 'fetched_at': get_timestamp(), 'raw_key': key,
    }


def measure_step(event: dict[str, Any]) -> dict[str, Any]:
    run = _run(event)
    if run['status'] in TERMINAL_STATUSES:
        return {'run_id': run['run_id'], 'done': True}
    results: list[Any] = run['results']
    pending = [index for index, result in enumerate(results) if result is None]
    if pending:
        index = pending[0]
        target = run['targets'][index]
        # Claimed before the paid call: a crash after it leaves the claim, never a target to buy again.
        results[index] = {**target, 'status': 'measuring'}
        run['status'] = 'running'
        save_run(run)
        result = measure_target(run['run_id'], index, target)
        results[index] = result
        run['cost_usd'] = round(float(run.get('cost_usd') or 0.0) + float(result.get('cost_usd') or 0.0), 4)
    done = len(pending) <= 1
    if done:
        run['status'] = 'completed'
    save_run(run)
    if done:
        remember_run(run)
    return {'run_id': run['run_id'], 'done': done}


def fail_step(event: dict[str, Any]) -> dict[str, Any]:
    run = _run(event)
    if run['status'] not in TERMINAL_STATUSES:
        error = event.get('error')
        name = error.get('Error') if isinstance(error, dict) else None
        logger.warning('lighthouse %s failed: %s', run['run_id'], name)
        run['results'] = [
            {**result, 'status': 'failed', 'error': f'{STEP_FAILED_MESSAGE}; the page may still have been charged'}
            if isinstance(result, dict) and result.get('status') == 'measuring' else result
            for result in run['results']
        ]
        fail_run(run, STEP_FAILED_MESSAGE)
        remember_run(run)
    return {'run_id': run['run_id'], 'done': True}


STEPS = {
    'lighthouse.measure': measure_step,
    'lighthouse.fail': fail_step,
}
