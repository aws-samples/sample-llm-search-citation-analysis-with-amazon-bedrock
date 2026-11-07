"""Local SEO job steps (state machine ``CitationAnalysis-SeoLocalJob``): post queued tasks once, then collect them.

- ``local.post``: posts the job's DataForSEO tasks (one reviews or updates task, or one Maps task per grid point)
  at priority 2. Skipped when the job already holds task ids (a timed-out job collected again), so a task is
  never bought twice. A failed post marks the job ``failed``; the state machine never retries this step,
  because DataForSEO bills a task when it is posted.
- ``local.collect``: one free ``task_get`` per pending task, storing each result as it arrives so the dashboard
  shows progress. The job is ``completed`` when nothing is pending, ``failed`` when every grid point failed (its
  receipt is then ignored, so a retry posts fresh tasks), and ``timed_out`` after ``MAX_COLLECT_ATTEMPTS``.
- ``local.fail``: marks the job ``failed`` when a step itself crashed, so the dashboard stops polling.

Every step returns ``{job_id, done, attempt}`` only; results live in the job item.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from shared import dataforseo_business_tasks as business_tasks
from shared import dataforseo_local_serp as local_serp
from shared.dataforseo_business import BusinessIdentifier, Near
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_tasks import TaskOutcome
from shared.local_rank_grid import grid_points
from shared.local_seo_jobs import TERMINAL_STATUSES, compact_grid_items, fail_job, load_job, save_job

logger = logging.getLogger(__name__)

MAX_COLLECT_ATTEMPTS = 40
"""With the state machine's 10 s wait: about 7 to 10 minutes; priority-2 tasks usually settle within 40 s."""
COLLECT_CONCURRENCY = 8
POST_FAILED_MESSAGE = 'DataForSEO did not accept the tasks'
TASK_FAILED_MESSAGE = 'DataForSEO could not complete the task'
GRID_FAILED_MESSAGE = 'Every grid search failed at DataForSEO'
STEP_FAILED_MESSAGE = 'The job stopped unexpectedly'


class MissingJobError(LookupError):
    """The event names a job the cache does not hold (expired or never written)."""


def _job(event: dict[str, Any]) -> dict[str, Any]:
    job_id = event.get('job_id')
    job = load_job(job_id) if isinstance(job_id, str) else None
    if job is None:
        raise MissingJobError(f'local SEO job {job_id!r} not found')
    return job


def _answer(job: dict[str, Any], attempt: int) -> dict[str, Any]:
    return {'job_id': job['job_id'], 'done': job['status'] in TERMINAL_STATUSES, 'attempt': attempt}


def _business_task(request: dict[str, Any]) -> business_tasks.BusinessTask:
    near = request.get('near')
    return business_tasks.BusinessTask(
        identifier=BusinessIdentifier(**request['identifier']),
        near=Near(**near) if isinstance(near, dict) else None,
        location_code=request['location_code'],
        language_code=request['language_code'],
        depth=request['depth'],
    )


def _post_business(job: dict[str, Any]) -> None:
    task = _business_task(job['request'])
    if job['kind'] == 'reviews':
        task_id, cost = business_tasks.post_reviews(task, job['request'].get('sort_by', 'newest'))
    else:
        task_id, cost = business_tasks.post_updates(task)
    job.update(tasks={business_tasks.TASK_TAG: task_id}, pending=[business_tasks.TASK_TAG], cost_usd=cost)


def _post_grid(job: dict[str, Any]) -> None:
    request = job['request']
    center = request['center']
    points = grid_points(center['latitude'], center['longitude'], request['grid_size'], request['spacing_km'])
    bodies = local_serp.grid_task_bodies(request['keyword'], [(point.latitude, point.longitude) for point in points],
                                         request['zoom'], request['device'], request['language_code'], request['depth'])
    posted = local_serp.post_grid_tasks(bodies)
    job['cost_usd'] = posted.cost_usd
    if not posted.accepted:
        raise DataForSeoError('INTERNAL_ERROR', POST_FAILED_MESSAGE, cost_usd=posted.cost_usd)
    job['tasks'] = dict(posted.accepted)
    job['pending'] = sorted(posted.accepted, key=int)
    job['results'] = {'points': {tag: {'status': 'failed', 'message': message}
                                 for tag, message in posted.rejected.items()}}


def post_step(event: dict[str, Any]) -> dict[str, Any]:
    """Post the job's tasks unless it already has them."""
    job = _job(event)
    if job['tasks'] or job['status'] in TERMINAL_STATUSES - {'timed_out'}:
        return _answer(job, 0)
    try:
        (_post_grid if job['kind'] == 'grid' else _post_business)(job)
    except DataForSeoError as error:
        logger.warning('local job %s post failed: code=%s cost_usd=%s', job['job_id'], error.code, error.cost_usd)
        job['cost_usd'] = error.cost_usd if error.cost_usd is not None else job.get('cost_usd')
        fail_job(job, error.code, POST_FAILED_MESSAGE)
        return _answer(job, 0)
    job['status'] = 'collecting'
    save_job(job)
    return _answer(job, 0)


def _collector(kind: str) -> Callable[[str], TaskOutcome]:
    if kind == 'grid':
        return local_serp.collect_grid_task
    return business_tasks.collect_reviews if kind == 'reviews' else business_tasks.collect_updates


def _outcome(collect: Callable[[str], TaskOutcome], task_id: str) -> TaskOutcome:
    """The task's outcome; a failed (free) ``task_get`` leaves it pending for the next attempt."""
    try:
        return collect(task_id)
    except DataForSeoError as error:
        logger.warning('local job task_get failed: code=%s', error.code)
        return TaskOutcome(status='pending', result=None, message=None)


def _store_business(job: dict[str, Any], outcome: TaskOutcome) -> None:
    if outcome.status == 'failed':
        fail_job(job, 'UPSTREAM_UNAVAILABLE', TASK_FAILED_MESSAGE)
        return
    reader = business_tasks.reviews_result if job['kind'] == 'reviews' else business_tasks.updates_result
    job['results'] = reader(outcome.result)


def _store_grid(job: dict[str, Any], tag: str, outcome: TaskOutcome) -> None:
    points = job['results'].setdefault('points', {})
    if outcome.status == 'failed':
        points[tag] = {'status': 'failed', 'message': outcome.message or TASK_FAILED_MESSAGE}
    else:
        points[tag] = {'status': 'ready', 'results': compact_grid_items(outcome.result)}


def _finish(job: dict[str, Any], attempt: int) -> None:
    if job['status'] == 'failed':
        return
    if job['pending']:
        if attempt >= MAX_COLLECT_ATTEMPTS:
            job['status'] = 'timed_out'
        save_job(job)
        return
    points = job['results'].get('points', {}) if job['kind'] == 'grid' else {}
    if job['kind'] == 'grid' and all(point['status'] == 'failed' for point in points.values()):
        fail_job(job, 'UPSTREAM_UNAVAILABLE', GRID_FAILED_MESSAGE)
        return
    job['status'] = 'completed'
    save_job(job)


def collect_step(event: dict[str, Any]) -> dict[str, Any]:
    """Collect every pending task once; store what arrived."""
    job = _job(event)
    attempt = int(event.get('attempt') or 0) + 1
    if job['status'] in TERMINAL_STATUSES:
        return _answer(job, attempt)
    collect = _collector(job['kind'])
    pending = list(job['pending'])
    with ThreadPoolExecutor(max_workers=COLLECT_CONCURRENCY) as pool:
        outcomes = list(pool.map(lambda tag: _outcome(collect, job['tasks'][tag]), pending))
    still_pending = []
    for tag, outcome in zip(pending, outcomes, strict=True):
        if outcome.status == 'pending':
            still_pending.append(tag)
        elif job['kind'] == 'grid':
            _store_grid(job, tag, outcome)
        else:
            _store_business(job, outcome)
    if job['status'] != 'failed':
        job['pending'] = still_pending
    _finish(job, attempt)
    return _answer(job, attempt)


def fail_step(event: dict[str, Any]) -> dict[str, Any]:
    """Mark the job failed after a step crashed (a finished job keeps its status)."""
    job = _job(event)
    if job['status'] not in TERMINAL_STATUSES:
        fail_job(job, 'INTERNAL_ERROR', STEP_FAILED_MESSAGE)
    return _answer(job, 0)


STEPS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    'local.post': post_step,
    'local.collect': collect_step,
    'local.fail': fail_step,
}

__all__ = ['STEPS']
