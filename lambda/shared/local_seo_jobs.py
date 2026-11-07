"""Local SEO jobs: queued reviews, profile updates and rank grids, stored in ``CitationAnalysis-SeoCache``.

A job is one item (namespace ``local-job``) keyed by its id::

    {job_id, kind: 'reviews' | 'updates' | 'grid', status, created_at, updated_at, runs, request,
     estimated_cost_usd, cost_usd, tasks: {tag: task_id}, pending: [tag], results, error_code, error}

``status`` is ``queued`` (created, not yet posted), ``collecting`` (posted, results arriving), ``completed``,
``failed`` or ``timed_out`` (DataForSEO still holds the tasks; collecting them again is free). The router creates
the job and starts its state machine; the jobs Lambda posts the tasks once and collects them.

A receipt (namespace ``local-receipt``, 1 h) maps a request to its job, so asking for the same reviews or the same
grid again within the hour collects the tasks already bought instead of buying them again. A failed job's
receipt is ignored, so a retry after a total failure posts fresh tasks. A grid's receipt leaves out the target
business: the target only decides which result is "yours", so ranks are computed when the job is read.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from shared.dataforseo_local_serp import BusinessTarget, result_items
from shared.local_rank_grid import grid_points, grid_summary, point_result, unresolved_point
from shared.seo_cache import get_cached, put_cached
from shared.utils import get_timestamp

JOB_NAMESPACE = 'local-job'
JOB_VERSION = 1
JOB_TTL_SECONDS = 7 * 86_400
RECEIPT_NAMESPACE = 'local-receipt'
RECEIPT_VERSION = 1
RECEIPT_TTL_SECONDS = 3_600

KINDS = ('reviews', 'updates', 'grid')
TERMINAL_STATUSES = frozenset({'completed', 'failed', 'timed_out'})


def new_job(kind: str, request: Mapping[str, Any], estimated_cost_usd: float) -> dict[str, Any]:
    now = get_timestamp()
    return {
        'job_id': uuid.uuid4().hex,
        'kind': kind,
        'status': 'queued',
        'created_at': now,
        'updated_at': now,
        'runs': 0,
        'request': dict(request),
        'estimated_cost_usd': estimated_cost_usd,
        'cost_usd': None,
        'tasks': {},
        'pending': [],
        'results': {},
        'error_code': None,
        'error': None,
    }


def load_job(job_id: str) -> dict[str, Any] | None:
    job = get_cached(JOB_NAMESPACE, JOB_VERSION, {'job_id': job_id})
    return job if isinstance(job, dict) and job.get('job_id') == job_id else None


def save_job(job: dict[str, Any]) -> None:
    job['updated_at'] = get_timestamp()
    put_cached(JOB_NAMESPACE, JOB_VERSION, {'job_id': job['job_id']}, job, JOB_TTL_SECONDS)


def fail_job(job: dict[str, Any], code: str, message: str) -> None:
    job.update(status='failed', error_code=code, error=message, pending=[])
    save_job(job)


def receipt_params(kind: str, request: Mapping[str, Any]) -> dict[str, Any]:
    return {'kind': kind, **{key: value for key, value in request.items() if key != 'target'}}


def receipt_job(kind: str, request: Mapping[str, Any]) -> dict[str, Any] | None:
    """The job an equal request started within the hour, unless it failed."""
    receipt = get_cached(RECEIPT_NAMESPACE, RECEIPT_VERSION, receipt_params(kind, request))
    job_id = receipt.get('job_id') if isinstance(receipt, dict) else None
    job = load_job(job_id) if isinstance(job_id, str) else None
    return job if job is not None and job.get('status') != 'failed' else None


def put_receipt(kind: str, request: Mapping[str, Any], job_id: str) -> None:
    put_cached(RECEIPT_NAMESPACE, RECEIPT_VERSION, receipt_params(kind, request), {'job_id': job_id},
               RECEIPT_TTL_SECONDS)


def grid_target(value: object) -> BusinessTarget:
    target = value if isinstance(value, Mapping) else {}
    domains = target.get('domains')
    return BusinessTarget(
        cid=target.get('cid') or None,
        place_id=target.get('place_id') or None,
        domains=tuple(domain for domain in domains if isinstance(domain, str)) if isinstance(domains, list) else (),
        name=target.get('name') or None,
    )


def grid_view(job: Mapping[str, Any], target: BusinessTarget) -> dict[str, Any]:
    """Every point of the grid (ranked for ``target``) and the grid summary."""
    request = job['request']
    center = request['center']
    collected = job.get('results', {}).get('points', {})
    points = []
    for point in grid_points(center['latitude'], center['longitude'], request['grid_size'], request['spacing_km']):
        stored = collected.get(str(point.index))
        if stored is None:
            status = 'pending' if job['status'] in {'queued', 'collecting'} else 'failed'
            points.append(unresolved_point(point, status))
        elif stored.get('status') == 'failed':
            points.append(unresolved_point(point, 'failed', stored.get('message')))
        else:
            points.append(point_result(point, stored.get('results', []), target))
    return {'points': points, 'summary': grid_summary(points)}


def compact_grid_items(result: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """The fields of each Maps result that ranking and the grid view read."""
    keys = ('rank_absolute', 'rank_group', 'title', 'cid', 'place_id', 'domain')
    return [{key: item.get(key) for key in keys} for item in result_items(result)]


def _progress(job: Mapping[str, Any]) -> dict[str, int]:
    if job['kind'] == 'grid':
        total = job['request']['grid_size'] ** 2
        return {'ready': len(job.get('results', {}).get('points', {})), 'total': total}
    return {'ready': 1 if job['status'] == 'completed' else 0, 'total': 1}


def job_view(job: Mapping[str, Any], target: BusinessTarget | None = None) -> dict[str, Any]:
    """The API form of a job; a grid is ranked for ``target`` (default: the target it was started with)."""
    if job['kind'] == 'grid':
        result: dict[str, Any] | None = grid_view(job, target or grid_target(job['request'].get('target')))
    else:
        result = job.get('results') or None
    return {
        'job_id': job['job_id'],
        'kind': job['kind'],
        'status': job['status'],
        'created_at': job['created_at'],
        'updated_at': job['updated_at'],
        'request': {key: value for key, value in job['request'].items() if key != 'target'},
        'estimated_cost_usd': job['estimated_cost_usd'],
        'progress': _progress(job),
        'result': result,
        'error_code': job.get('error_code'),
        'error': job.get('error'),
    }


__all__ = [
    'KINDS',
    'TERMINAL_STATUSES',
    'compact_grid_items',
    'fail_job',
    'grid_target',
    'job_view',
    'load_job',
    'new_job',
    'put_receipt',
    'receipt_job',
    'save_job',
]
