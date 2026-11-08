"""
Site audit API (response shapes in ``web/src/types/api/seoAudits.ts``):

- POST /api/seo/audits                        (Admin) start an audit ``{start_url, max_pages?}`` -> 202
- GET  /api/seo/audits                        recent audits and the owned sites an audit may start from
- GET  /api/seo/audits/{auditId}              status, progress and (once finished) summary and AI readiness;
                                              cheap enough to poll every few seconds
- GET  /api/seo/audits/{auditId}/issues       without ``issue_type``: the issue types found with their registry
                                              text; with it: the affected pages, paged (``limit``, ``next_token``);
                                              ``audit_running`` says the audit is still adding issues
- GET  /api/seo/audits/{auditId}/pages        without ``url``: the crawled pages, paged; with it: one page and its issues
- POST /api/seo/audits/{auditId}/cancel       (Admin) stop a queued or running audit

An audit crawls only the brand's own site: the start URL must be on one of ``first_party_domains`` (or a
subdomain). One audit runs at a time, so the site sees one polite crawler. Starting and cancelling are Admin
only because an audit is recurring crawl work on the brand's site; reading results is open to every signed-in
user. No route calls a paid API.
"""

import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from seo_http import brand_config, seo_error, seo_route

from shared.api_response import success_response
from shared.audit_issues import ISSUE_TYPES, descriptor_json, type_order
from shared.audit_urls import StartUrlError, normalize_url, start_url_for
from shared.auth import ADMIN_GROUP, get_caller_identity, require_group
from shared.decorators import json_object_body, validate
from shared.kpi_engine import owned_domains_from
from shared.site_audit import (
    ACTIVE_STATUSES,
    DEFAULT_MAX_PAGES,
    MAX_PAGES_CHOICES,
    audit_json,
    json_value,
    new_audit,
    start_execution,
    stop_execution,
)
from shared.site_audit_repository import AuditStore
from shared.utils import get_timestamp

LIST_LIMIT = 25
PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
_AUDIT_ID = re.compile(r'^[0-9a-f]{32}$')
_ISSUE_FIELDS = ('issue_type', 'page_url', 'details', 'severity', 'group')
Handler = Callable[..., dict[str, Any]]
_PAGE_HIDDEN = frozenset({'pk', 'sk', 'ttl', 'gsi1pk', 'gsi1sk', 'internal_links'})

START_SCHEMA: dict[str, dict[str, Any]] = {
    'start_url': {'required': True, 'type': str, 'min_length': 1, 'max_length': 2048},
    'max_pages': {'type': int, 'choices': list(MAX_PAGES_CHOICES), 'default': DEFAULT_MAX_PAGES},
}
PAGING_SCHEMA: dict[str, dict[str, Any]] = {
    'limit': {'type': int, 'min': 1, 'max': PAGE_SIZE_MAX, 'default': PAGE_SIZE_DEFAULT},
    'next_token': {'type': str, 'max_length': 2048},
}
ISSUES_SCHEMA: dict[str, dict[str, Any]] = {
    'issue_type': {'type': str, 'choices': sorted(ISSUE_TYPES)},
    **PAGING_SCHEMA,
}
PAGES_SCHEMA: dict[str, dict[str, Any]] = {
    'url': {'type': str, 'max_length': 2048},
    **PAGING_SCHEMA,
}


def _audit_id(event: dict[str, Any]) -> str | None:
    """The ``{auditId}`` segment of the request path, when it is a well-formed audit id."""
    params = event.get('pathParameters') or {}
    candidate = params.get('auditId')
    if not candidate:
        segments = [part for part in str(event.get('path', '')).split('/') if part]
        index = segments.index('audits') if 'audits' in segments else -1
        candidate = segments[index + 1] if 0 <= index < len(segments) - 1 else None
    return candidate if isinstance(candidate, str) and _AUDIT_ID.match(candidate) else None


@dataclass(frozen=True)
class FoundAudit:
    """The audit a request path names."""

    store: AuditStore
    audit_id: str
    audit: dict[str, Any]


def with_audit(func: Handler) -> Handler:
    """Inject the audit the path names as ``found``; a malformed or unknown id answers 404 ``NOT_FOUND``."""
    @wraps(func)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        audit_id = _audit_id(event)
        store = AuditStore()
        audit = store.get_audit(audit_id) if audit_id else None
        if audit is None or audit_id is None:
            return seo_error(404, 'NOT_FOUND', 'Audit not found', event)
        return func(event, context, *args, found=FoundAudit(store, audit_id, audit), **kwargs)

    return wrapper


def _owned_sites() -> list[str]:
    return owned_domains_from(brand_config())


def _issue_json(item: dict[str, Any]) -> dict[str, Any]:
    return {name: json_value(item.get(name)) for name in _ISSUE_FIELDS}


def _page_json(item: dict[str, Any]) -> dict[str, Any]:
    return {key: json_value(value) for key, value in item.items() if key not in _PAGE_HIDDEN}


# ---------------------------------------------------------------------------
# Start, list, detail, cancel
# ---------------------------------------------------------------------------

@require_group(ADMIN_GROUP)
@json_object_body
@validate(START_SCHEMA)
def start_audit(event: dict[str, Any], _context: Any, *, start_url: str, max_pages: int, **_kwargs: Any) -> dict[str, Any]:
    try:
        url = start_url_for(start_url, _owned_sites())
    except StartUrlError as error:
        return seo_error(400, 'VALIDATION_ERROR', str(error), event, 'start_url')
    store = AuditStore()
    if any(audit.get('status') in ACTIVE_STATUSES for audit in store.list_audits(LIST_LIMIT)):
        return seo_error(409, 'AUDIT_RUNNING', 'An audit is already running; wait for it or cancel it', event)
    audit = new_audit(url, max_pages, get_caller_identity(event) or 'unknown', get_timestamp())
    store.create_audit(audit)
    try:
        execution_arn = start_execution(audit['audit_id'])
    except Exception:
        store.update_audit(audit['audit_id'], {'status': 'failed', 'error_code': 'start_failed', 'failed_phase': 'discovery'})
        raise
    store.update_audit(audit['audit_id'], {'execution_arn': execution_arn})
    return success_response({'audit': audit_json(audit, with_summary=False)}, event, 202)


def list_audits(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    audits = AuditStore().list_audits(LIST_LIMIT)
    return success_response({
        'audits': [audit_json(audit, with_summary=False) for audit in audits],
        'sites': _owned_sites(),
        'max_pages_choices': list(MAX_PAGES_CHOICES),
    }, event)


@with_audit
def audit_detail(event: dict[str, Any], _context: Any, *, found: FoundAudit, **_kwargs: Any) -> dict[str, Any]:
    return success_response({'audit': audit_json(found.audit, with_summary=True)}, event)


def get_audit(event: dict[str, Any], context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """``GET /audits`` (list) or ``GET /audits/{auditId}`` (one audit)."""
    segments = [part for part in str(event.get('path', '')).split('/') if part]
    if segments and segments[-1] == 'audits':
        return list_audits(event, context)
    return audit_detail(event, context)


@require_group(ADMIN_GROUP)
@with_audit
def cancel_audit(event: dict[str, Any], _context: Any, *, found: FoundAudit, **_kwargs: Any) -> dict[str, Any]:
    store, audit_id, audit = found.store, found.audit_id, found.audit
    if not store.update_audit(audit_id, {'status': 'cancelled', 'completed_at': get_timestamp()},
                              only_if_status=ACTIVE_STATUSES):
        return seo_error(409, 'NOT_RUNNING', 'The audit is not running', event)
    execution_arn = audit.get('execution_arn')
    if isinstance(execution_arn, str) and execution_arn:
        stop_execution(execution_arn)
    return success_response({'audit': audit_json({**audit, 'status': 'cancelled'}, with_summary=False)}, event)


# ---------------------------------------------------------------------------
# Issues and pages
# ---------------------------------------------------------------------------

def _issue_types(audit: dict[str, Any]) -> list[dict[str, Any]]:
    raw = audit.get('summary')
    summary: dict[str, Any] = raw if isinstance(raw, dict) else {}
    counts = {str(entry.get('issue_type')): entry for entry in summary.get('issue_types') or []}
    found = sorted((issue_type for issue_type in counts if issue_type in ISSUE_TYPES), key=type_order)
    return [
        {**descriptor_json(issue_type), 'issues': json_value(counts[issue_type].get('issues')),
         'pages': json_value(counts[issue_type].get('pages'))}
        for issue_type in found
    ]


@validate(ISSUES_SCHEMA)
@with_audit
def get_issues(event: dict[str, Any], _context: Any, *, found: FoundAudit, **params: Any) -> dict[str, Any]:
    """Without ``issue_type``: the types found; with it: one page of the affected pages."""
    audit_id, issue_type = found.audit_id, params['issue_type']
    running = found.audit.get('status') in ACTIVE_STATUSES
    if issue_type is None:
        return success_response({'audit_id': audit_id, 'issue_types': _issue_types(found.audit),
                                 'audit_running': running}, event)
    items, token = found.store.issues_of_type(audit_id, issue_type, params['limit'], params['next_token'])
    return success_response({
        'audit_id': audit_id, 'issue': descriptor_json(issue_type), 'audit_running': running,
        'items': [_issue_json(item) for item in items], 'next_token': token,
    }, event)


def _page_detail(store: AuditStore, audit_id: str, url: str, event: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_url(url)
    item = store.page(audit_id, normalized) if normalized else None
    if item is None or normalized is None:
        return seo_error(404, 'NOT_FOUND', 'Page not found in this audit', event, 'url')
    issues = sorted(
        (issue for issue in store.issues(audit_id)
         if issue.get('page_url') == normalized and issue.get('issue_type') in ISSUE_TYPES),
        key=lambda issue: type_order(str(issue['issue_type'])),
    )
    return success_response({
        'audit_id': audit_id, 'page': _page_json(item),
        'issues': [{**_issue_json(issue), 'title': ISSUE_TYPES[str(issue['issue_type'])].title} for issue in issues],
    }, event)


@validate(PAGES_SCHEMA)
@with_audit
def get_pages(event: dict[str, Any], _context: Any, *, found: FoundAudit, **params: Any) -> dict[str, Any]:
    """Without ``url``: one page of the crawled pages; with it: that page and its issues."""
    store, audit_id = found.store, found.audit_id
    if params['url']:
        return _page_detail(store, audit_id, params['url'], event)
    items, token = store.page_batch(audit_id, params['limit'], params['next_token'])
    return success_response({
        'audit_id': audit_id, 'pages': [_page_json(item) for item in items], 'next_token': token,
    }, event)


handler = seo_route({
    ('POST', '/cancel'): cancel_audit,
    ('GET', '/issues'): get_issues,
    ('GET', '/pages'): get_pages,
    'POST': start_audit,
    'GET': get_audit,
})
