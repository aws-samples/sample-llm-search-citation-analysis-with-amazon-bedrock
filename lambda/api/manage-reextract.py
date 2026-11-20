"""
Re-extract stored answers (2.55.0) — ``/api/reextract`` on the config-mgmt router, Admin only.

- ``POST /api/reextract/estimate``: how many stored answers the filters cover and the Bedrock cost
  (``shared.reextract``, ``shared.bedrock_pricing``). Read only; ``truncated`` when the request deadline cut the count.
- ``POST /api/reextract``: start a job with the filters (202 ``{job}``); 409 ``{error, job}`` while another job is
  active (one per deployment); 400 when the filters cover no answer.
- ``GET /api/reextract``: the newest job and whether it is active; ``GET /api/reextract/{id}``: one job.
- ``POST /api/reextract/{id}/stop``: ask a running job to stop (it reads ``stopping``, then ``stopped``).

The job runs on ``CitationAnalysis-ReextractWorker`` (``lambda/search/reextract_worker.py``), invoked
asynchronously. Every answer it rewrites keeps its previous brands in ``brands_history`` (D1).
"""

from __future__ import annotations

import json
import os
from typing import Any

import boto3

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, get_caller_claims, get_caller_identity, require_group
from shared.bedrock_pricing import extraction_cost_usd
from shared.brand_names import BRANDS_VERSION
from shared.decorators import RouteNotHandledError, api_handler, cors_preflight, json_object_body, route_handler
from shared.keyword_groups import load_existing_group_ids
from shared.models import ModelRole, get_model_id
from shared.reextract import (
    AnswerCount,
    InvalidFiltersError,
    ReextractFilters,
    count_answers,
    filters_from_body,
    load_scoped_keywords,
)
from shared.reextract_jobs import ReextractJobs, job_view, new_job_item, reextract_jobs_table_name
from shared.request_deadline import current_deadline
from shared.scope_params import keywords_table_name
from shared.search_results import search_results_table_name
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async

WORKER_FUNCTION = os.environ['REEXTRACT_WORKER_FUNCTION_NAME']
GROUPS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORD_GROUPS']
#: The longest job id the routes accept (``rx-`` and 16 hex digits).
_MAX_JOB_ID_LENGTH = 32

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')


def _jobs() -> ReextractJobs:
    return ReextractJobs(dynamodb.Table(reextract_jobs_table_name()))


def _filters(event: dict[str, Any], body: dict[str, Any]) -> ReextractFilters | dict[str, Any]:
    """The body's filters, or the 400 answer naming the bad field (an unknown group included)."""
    try:
        filters = filters_from_body(body)
    except InvalidFiltersError as error:
        return validation_error(str(error), event, error.field)
    missing = set(filters.group_ids) - load_existing_group_ids(dynamodb.Table(GROUPS_TABLE), list(filters.group_ids))
    if missing:
        return validation_error(f'Unknown keyword group: {min(missing)}', event, 'group_ids')
    return filters


def _count(filters: ReextractFilters) -> AnswerCount:
    keywords = load_scoped_keywords(filters, dynamodb.Table(keywords_table_name()))
    return count_answers(dynamodb.Table(search_results_table_name()), keywords, filters, current_deadline())


def _estimate_body(filters: ReextractFilters, count: AnswerCount) -> dict[str, Any]:
    model = get_model_id(ModelRole.EXTRACTION)
    return {
        'answers': count.answers, 'answers_current': count.answers_current, 'keywords': count.keywords,
        'estimated_cost_usd': extraction_cost_usd(count.answers, model), 'model': model,
        'brands_version': BRANDS_VERSION, 'truncated': count.truncated, 'filters': filters.as_dict(),
    }


@require_group(ADMIN_GROUP)
@json_object_body
def _estimate(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    """POST /api/reextract/estimate — the answers the filters cover and their Bedrock cost."""
    filters = _filters(event, body)
    if not isinstance(filters, ReextractFilters):
        return filters
    return success_response(_estimate_body(filters, _count(filters)), event)


def _caller(event: dict[str, Any]) -> str:
    email = get_caller_claims(event).get('email')
    return email.strip() if isinstance(email, str) and email.strip() else (get_caller_identity(event) or '')


@require_group(ADMIN_GROUP)
@json_object_body
def _start(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    """POST /api/reextract — start a job (202), unless one is active (409) or nothing matches (400)."""
    filters = _filters(event, body)
    if not isinstance(filters, ReextractFilters):
        return filters
    jobs = _jobs()
    active, is_active = jobs.current()
    if is_active and active is not None:
        return api_response(409, {'error': 'A re-extract is already running', 'job': job_view(active)}, event)
    estimate = _estimate_body(filters, _count(filters))
    if not estimate['answers']:
        return validation_error('Nothing to re-extract: no stored answer matches the filters', event, 'filters')
    item = new_job_item(
        filters.as_dict(), _caller(event), answers=estimate['answers'], keywords=estimate['keywords'],
        cost=estimate['estimated_cost_usd'], brands_version=BRANDS_VERSION, model=estimate['model'],
    )
    job, running = jobs.start(item)
    if job is None:
        return api_response(409, {'error': 'A re-extract is already running', 'job': job_view(running or item)}, event)
    try:
        invoke_self_async(
            WORKER_FUNCTION, json.dumps({'job_id': job['job_id'], 'step': 0}).encode(),
            description='brand re-extract', lambda_client=lambda_client,
        )
    except SelfInvokeDispatchError:
        jobs.save(job['job_id'], 0, {'status': 'failed', 'error': 'The worker could not be started'})
        jobs.release(job['job_id'])
        return api_response(503, {'error': 'Could not start the re-extract'}, event)
    return success_response({'job': job_view(job)}, event, status_code=202)


def _job_id(event: dict[str, Any]) -> str | None:
    value = (event.get('pathParameters') or {}).get('id')
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > _MAX_JOB_ID_LENGTH:
        return None
    return value.strip()


@require_group(ADMIN_GROUP)
def _read(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /api/reextract — the newest job and whether it is active; GET /api/reextract/{id} — that job."""
    jobs = _jobs()
    if (event.get('pathParameters') or {}).get('id') is None:
        job, active = jobs.current()
        return success_response({'job': None if job is None else job_view(job), 'active': active}, event)
    job_id = _job_id(event)
    found = None if job_id is None else jobs.get(job_id)
    if found is None:
        return not_found_response('Re-extract job', event)
    return success_response({'job': job_view(found)}, event)


@require_group(ADMIN_GROUP)
def _stop(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /api/reextract/{id}/stop — ask a running job to stop; a job that is not running answers as it is."""
    job_id = _job_id(event)
    job = None if job_id is None else _jobs().request_stop(job_id)
    if job is None:
        return not_found_response('Re-extract job', event)
    return success_response({'job': job_view(job)}, event)


@api_handler
@cors_preflight
@route_handler({
    ('POST', '/estimate'): _estimate,
    ('POST', '/stop'): _stop,
    'POST': _start,
    'GET': _read,
})
def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    """Never reached: ``route_handler`` answers every method (see the module docstring)."""
    raise RouteNotHandledError(__name__)
