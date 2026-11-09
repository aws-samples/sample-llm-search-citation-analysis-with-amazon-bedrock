"""
Steps of the site-audit state machine (``CitationAnalysis-SiteAudit``), dispatched by ``seo-jobs.py``.

- ``audit.start``: discovery (start URL, robots.txt, sitemaps, seeds); the audit becomes ``running``.
- ``audit.crawl``: one crawl chunk (``shared.site_audit_crawl``).
- ``audit.finalize``: cross-page and site-level checks, summary; the audit becomes ``completed``.
- ``audit.fail``: record why the execution failed (``failed``, with the phase it was in).

Imported by ``seo-jobs.py``; ``shared.*`` resolves from the Lambda layer (``/opt/python``). Every step reads the
audit first and does nothing to an audit that is no longer active (cancelled from the dashboard): it answers
``done`` so the state machine ends. Each step returns only ``{audit_id, chunk_no, done, wait_seconds}`` (Step
Functions caps state at 256 KiB). No step calls a paid API.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import Any

import boto3

from shared.env_vars import resolve_table_env
from shared.kpi_engine import owned_domains_from
from shared.site_audit import ACTIVE_STATUSES, MAX_ERROR_DETAIL_CHARS, error_code
from shared.site_audit_crawl import crawl_chunk
from shared.site_audit_discovery import discover, new_fetcher
from shared.site_audit_finalize import finalize
from shared.site_audit_repository import AuditStore
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

BRAND_CONFIG_TABLE_ENV = 'DYNAMODB_TABLE_BRAND_CONFIG'
RUNNING = ('running',)

AuditStep = Callable[[dict[str, Any], AuditStore, str, dict[str, Any]], dict[str, Any]]


class AuditNotFoundError(KeyError):
    """The step names an audit that does not exist."""


def _state(audit_id: str, *, chunk_no: int = 0, done: bool = False, wait_seconds: int = 0) -> dict[str, Any]:
    return {'audit_id': audit_id, 'chunk_no': chunk_no, 'done': done, 'wait_seconds': wait_seconds}


def _load(event: dict[str, Any]) -> tuple[AuditStore, str, dict[str, Any]]:
    audit_id = str(event.get('audit_id') or '')
    store = AuditStore()
    audit = store.get_audit(audit_id) if audit_id else None
    if audit is None:
        raise AuditNotFoundError(audit_id)
    return store, audit_id, audit


def audit_step(statuses: tuple[str, ...]) -> Callable[[AuditStep], Callable[[dict[str, Any]], dict[str, Any]]]:
    """Run the step with the event's audit while its status is one of ``statuses``; otherwise answer ``done``."""
    def decorator(step: AuditStep) -> Callable[[dict[str, Any]], dict[str, Any]]:
        @wraps(step)
        def wrapper(event: dict[str, Any]) -> dict[str, Any]:
            store, audit_id, audit = _load(event)
            if audit.get('status') not in statuses:
                return _state(audit_id, done=True)
            return step(event, store, audit_id, audit)

        return wrapper

    return decorator


def owned_domains() -> list[str]:
    """The brand's own domains (``first_party_domains`` of BrandConfig ``default``)."""
    table = boto3.resource('dynamodb').Table(resolve_table_env(BRAND_CONFIG_TABLE_ENV))
    return owned_domains_from(table.get_item(Key={'config_id': 'default'}).get('Item') or {})


@audit_step(ACTIVE_STATUSES)
def start_step(_event: dict[str, Any], store: AuditStore, audit_id: str, audit: dict[str, Any]) -> dict[str, Any]:
    store.update_audit(audit_id, {'status': 'running', 'phase': 'discovery'}, only_if_status=ACTIVE_STATUSES)
    changes = discover(store, audit, owned_domains(), new_fetcher(audit, deadline=None))
    applied = store.update_audit(audit_id, {**changes, 'phase': 'crawl'}, only_if_status=RUNNING)
    return _state(audit_id, done=not applied or bool(changes['stop_reason']))


@audit_step(RUNNING)
def crawl_step(event: dict[str, Any], store: AuditStore, audit_id: str, audit: dict[str, Any]) -> dict[str, Any]:
    result = crawl_chunk(store, audit, int(event.get('chunk_no') or 0))
    applied = store.update_audit(audit_id, result['changes'], only_if_status=RUNNING)
    state = result['state']
    return {**state, 'done': bool(state['done']) or not applied}


@audit_step(RUNNING)
def finalize_step(_event: dict[str, Any], store: AuditStore, audit_id: str, audit: dict[str, Any]) -> dict[str, Any]:
    store.update_audit(audit_id, {'phase': 'finalize'}, only_if_status=RUNNING)
    changes = finalize(store, audit, new_fetcher(audit, deadline=None), completed_at=get_timestamp())
    store.update_audit(audit_id, changes, only_if_status=RUNNING)
    return _state(audit_id, done=True)


@audit_step(ACTIVE_STATUSES)
def fail_step(event: dict[str, Any], store: AuditStore, audit_id: str, audit: dict[str, Any]) -> dict[str, Any]:
    """Mark the audit failed with the Step Functions error the state machine caught."""
    raw_error = event.get('error')
    error: dict[str, Any] = raw_error if isinstance(raw_error, dict) else {}
    name = str(error.get('Error') or 'unknown')
    detail = str(error.get('Cause') or name)[:MAX_ERROR_DETAIL_CHARS]
    logger.warning('audit %s failed in phase %s: %s', audit_id, audit.get('phase'), name)
    store.update_audit(audit_id, {
        'status': 'failed', 'error_code': error_code(name), 'error_detail': detail,
        'failed_phase': str(audit.get('phase') or ''), 'completed_at': get_timestamp(),
    }, only_if_status=ACTIVE_STATUSES)
    return _state(audit_id, done=True)


STEPS = {
    'audit.start': start_step,
    'audit.crawl': crawl_step,
    'audit.finalize': finalize_step,
    'audit.fail': fail_step,
}
