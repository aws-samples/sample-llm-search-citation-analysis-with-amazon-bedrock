"""Lighthouse runs: one job measuring one or more (URL, device) targets, stored in ``CitationAnalysis-SeoCache``.

A run is one cache item (namespace ``lighthouse-run``, 30 days)::

    {run_id, kind: 'single' | 'batch', status, created_at, updated_at, started_by, audit_id,
     targets: [{url, device}], results: [result | None], estimated_cost_usd, cost_usd, error}

``status`` is ``queued`` (created, execution starting), ``running``, ``completed`` or ``failed`` (the execution
could not start, or a step crashed). ``results[i]`` is the outcome of ``targets[i]``: the compact summary of
``shared.lighthouse_report`` plus ``status: 'completed'`` and the S3 key of the full report
(``seo/lighthouse/<run id>-<index>.json`` in the raw-responses bucket), or ``status: 'failed'`` with a message.

Paying twice is prevented by receipts (namespace ``lighthouse-receipt``, 15 minutes): asking again for the same
URL and device, or for the same audit's sample, answers the run already started unless it failed. The 20 newest
runs are listed in one item (namespace ``lighthouse-recent``); two runs started in the same instant may drop
one of them from that list, never from storage.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Mapping, Sequence
from functools import cache
from typing import Any

import boto3

from shared.dataforseo_lighthouse import LIGHTHOUSE_LIVE_USD
from shared.seo_cache import get_cached, put_cached
from shared.utils import get_timestamp

RUN_NAMESPACE = 'lighthouse-run'
RUN_VERSION = 1
RUN_TTL_SECONDS = 30 * 86_400
RECEIPT_NAMESPACE = 'lighthouse-receipt'
RECEIPT_VERSION = 1
RECEIPT_TTL_SECONDS = 15 * 60
RECENT_NAMESPACE = 'lighthouse-recent'
RECENT_VERSION = 1
RECENT_LIMIT = 20
RAW_BUCKET_ENV = 'RAW_RESPONSES_BUCKET'
RAW_PREFIX = 'seo/lighthouse/'
STATE_MACHINE_ENV = 'SEO_LIGHTHOUSE_STATE_MACHINE_ARN'
TERMINAL_STATUSES = frozenset({'completed', 'failed'})
_HEADER_FIELDS = ('run_id', 'kind', 'status', 'created_at', 'started_by', 'audit_id', 'estimated_cost_usd')


def estimated_cost(target_count: int) -> float:
    return round(target_count * LIGHTHOUSE_LIVE_USD, 4)


def new_run(kind: str, targets: Sequence[Mapping[str, str]], started_by: str, audit_id: str | None = None) -> dict[str, Any]:
    created_at = get_timestamp()
    return {
        'run_id': uuid.uuid4().hex, 'kind': kind, 'status': 'queued', 'started_by': started_by,
        'audit_id': audit_id, 'created_at': created_at, 'updated_at': created_at,
        'targets': [{'url': target['url'], 'device': target['device']} for target in targets],
        'results': [None for _ in targets],
        'estimated_cost_usd': estimated_cost(len(targets)),
        'cost_usd': 0.0,
        'error': None,
    }


def load_run(run_id: str) -> dict[str, Any] | None:
    run = get_cached(RUN_NAMESPACE, RUN_VERSION, {'run_id': run_id})
    return run if isinstance(run, dict) and run.get('run_id') == run_id else None


def save_run(run: dict[str, Any]) -> None:
    run['updated_at'] = get_timestamp()
    put_cached(RUN_NAMESPACE, RUN_VERSION, {'run_id': run['run_id']}, run, RUN_TTL_SECONDS)


def fail_run(run: dict[str, Any], message: str) -> None:
    run.update(status='failed', error=message)
    save_run(run)


def receipt_run(params: Mapping[str, Any]) -> dict[str, Any] | None:
    """The run an equal request started within the last 15 minutes, unless it failed."""
    receipt = get_cached(RECEIPT_NAMESPACE, RECEIPT_VERSION, params)
    run_id = receipt.get('run_id') if isinstance(receipt, dict) else None
    run = load_run(run_id) if isinstance(run_id, str) else None
    return run if run is not None and run.get('status') != 'failed' else None


def put_receipt(params: Mapping[str, Any], run_id: str) -> None:
    put_cached(RECEIPT_NAMESPACE, RECEIPT_VERSION, params, {'run_id': run_id}, RECEIPT_TTL_SECONDS)


def run_header(run: Mapping[str, Any]) -> dict[str, Any]:
    """What the run list shows of a run: its ids, status, price and first target."""
    targets = run.get('targets') or []
    return {
        **{field: run.get(field) for field in _HEADER_FIELDS},
        'target_count': len(targets),
        'first_url': targets[0]['url'] if targets else None,
    }


def recent_runs() -> list[dict[str, Any]]:
    stored = get_cached(RECENT_NAMESPACE, RECENT_VERSION, {})
    runs = stored.get('runs') if isinstance(stored, dict) else None
    return [run for run in runs if isinstance(run, dict)] if isinstance(runs, list) else []


def remember_run(run: Mapping[str, Any]) -> None:
    """Put ``run`` first in the list of recent runs (replacing its older entry)."""
    others = [header for header in recent_runs() if header.get('run_id') != run['run_id']]
    runs = [run_header(run), *others][:RECENT_LIMIT]
    put_cached(RECENT_NAMESPACE, RECENT_VERSION, {}, {'runs': runs}, RUN_TTL_SECONDS)


def run_view(run: Mapping[str, Any]) -> dict[str, Any]:
    """The API form of a run (the S3 keys of the full reports stay internal)."""
    results = [
        None if result is None else {key: value for key, value in result.items() if key != 'raw_key'}
        for result in run.get('results') or []
    ]
    done = sum(1 for result in results if result is not None and result.get('status') in TERMINAL_STATUSES)
    return {
        **run_header(run),
        'updated_at': run.get('updated_at'),
        'targets': run.get('targets') or [],
        'results': results,
        'progress': {'done': done, 'total': len(results)},
        'cost_usd': run.get('cost_usd'),
        'error': run.get('error'),
    }


def raw_key(run_id: str, index: int) -> str:
    return f'{RAW_PREFIX}{run_id}-{index}.json'


@cache
def _s3() -> Any:
    return boto3.client('s3')


def save_report(run_id: str, index: int, report: Mapping[str, Any]) -> str:
    """Keep the full Lighthouse report in S3; returns its key."""
    key = raw_key(run_id, index)
    _s3().put_object(
        Bucket=os.environ[RAW_BUCKET_ENV], Key=key, Body=json.dumps(report).encode('utf-8'),
        ContentType='application/json',
    )
    return key


@cache
def _stepfunctions() -> Any:
    return boto3.client('stepfunctions')


def start_execution(run: dict[str, Any]) -> None:
    """Start the run's state machine (input: the run id only); raises when it cannot start."""
    _stepfunctions().start_execution(
        stateMachineArn=os.environ[STATE_MACHINE_ENV], name=f"lighthouse-{run['run_id']}",
        input=json.dumps({'run_id': run['run_id']}),
    )
