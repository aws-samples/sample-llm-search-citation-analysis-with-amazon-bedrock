"""
Site audits: the audit record, its state machine, and the API view of an audit.

An audit crawls the brand's own site (a start URL on one of ``first_party_domains``) with plain HTTP fetches
(no JavaScript rendering, no paid API) and records SEO and AI-readiness issues. It runs as the state machine
``CitationAnalysis-SiteAudit`` (env ``SITE_AUDIT_STATE_MACHINE_ARN``), whose input is the audit id only:
Step Functions keeps execution input in its history, so nothing else travels there.

Statuses: ``queued`` (created, execution starting), ``running``, ``completed``, ``failed``, ``cancelled``.
Phases: ``discovery``, ``crawl``, ``finalize``, ``done``. A failure records a code from a closed vocabulary
(``error_code``), a detail cut to 300 characters and the phase it happened in.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import boto3

from shared.dynamo_decimal import to_int

STATE_MACHINE_ENV = 'SITE_AUDIT_STATE_MACHINE_ARN'
MAX_PAGES_CHOICES = (100, 500, 2000)
DEFAULT_MAX_PAGES = 500
ACTIVE_STATUSES = ('queued', 'running')
MAX_ERROR_DETAIL_CHARS = 300
_AUDIT_FIELDS = (
    'audit_id', 'start_url', 'origin', 'status', 'phase', 'max_pages', 'pages_crawled', 'pages_total',
    'discovered', 'sitemap_urls', 'started_by', 'started_at', 'completed_at', 'error_code', 'error_detail',
    'failed_phase', 'stop_reason', 'robots_status', 'crawl_complete',
)


def new_audit(start_url: str, max_pages: int, started_by: str, started_at: str) -> dict[str, Any]:
    """The record of a new audit, before its execution starts."""
    return {
        'audit_id': uuid.uuid4().hex,
        'start_url': start_url,
        'origin': '',
        'status': 'queued',
        'phase': 'discovery',
        'max_pages': max_pages,
        'pages_crawled': 0,
        'pages_total': 0,
        'discovered': 0,
        'started_by': started_by,
        'started_at': started_at,
        'stop_reason': '',
    }


def start_execution(audit_id: str) -> str:
    """Start the audit's state machine; returns the execution ARN."""
    response = boto3.client('stepfunctions').start_execution(
        stateMachineArn=os.environ[STATE_MACHINE_ENV], name=f'audit-{audit_id}', input=json.dumps({'audit_id': audit_id}),
    )
    return str(response['executionArn'])


def stop_execution(execution_arn: str) -> None:
    boto3.client('stepfunctions').stop_execution(executionArn=execution_arn, cause='Cancelled from the dashboard')


def error_code(error: str) -> str:
    """The closed-vocabulary code (step_timeout, out_of_memory, execution_failed, unknown) of an error name."""
    if error == 'States.Timeout' or error.endswith('TimeoutError'):
        return 'step_timeout'
    if 'MemoryError' in error or error == 'Runtime.OutOfMemory':
        return 'out_of_memory'
    if error.startswith(('States.', 'Lambda.')):
        return 'execution_failed'
    return 'unknown'


def json_value(value: Any) -> Any:
    """``value`` with DynamoDB numbers made JSON numbers (every stored number is an integer)."""
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set):
        return [json_value(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    return to_int(value)


def audit_json(item: dict[str, Any], *, with_summary: bool) -> dict[str, Any]:
    """The API view of an audit item (``summary`` and ``ai_readiness`` only on the detail route)."""
    body = {name: json_value(item.get(name)) for name in _AUDIT_FIELDS}
    if with_summary:
        body['summary'] = json_value(item.get('summary'))
        body['ai_readiness'] = json_value(item.get('ai_readiness'))
    return body
