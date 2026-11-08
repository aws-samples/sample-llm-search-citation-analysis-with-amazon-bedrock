"""
Page performance API (response shapes in ``web/src/types/api/seoPerformance.ts``):

- POST /api/seo/lighthouse                 measure one page ``{url, device}`` (billed; 202, a run to poll)
- GET  /api/seo/lighthouse                 the 20 newest runs
- GET  /api/seo/lighthouse/{runId}         one run: progress and each page's scores, metrics and failed audits
- GET  /api/seo/lighthouse/sample          the pages a batch would measure (latest finished audit) and its price
- POST /api/seo/lighthouse/batch           (Admin) measure that sample ``{audit_id}`` on mobile and desktop
- GET  /api/seo/indexnow                   each owned domain's key and where to host it; the 20 newest submissions
- POST /api/seo/indexnow/key               (Admin) create the domain's key ``{domain}``
- POST /api/seo/indexnow/check             check the key file on the domain and its ``www.`` host ``{domain}``
- POST /api/seo/indexnow/submit            (Admin) submit ``{urls}`` or ``{source: 'audit'}`` to IndexNow

Lighthouse only measures the brand's own pages (``first_party_domains`` or a subdomain). A Lighthouse run
takes up to a minute, so the router only starts it (state machine ``CitationAnalysis-SeoLighthouse``); asking
again for the same page and device, or the same batch, within 15 minutes answers the run already started.
Batches and every IndexNow write are Admin only; IndexNow itself is free.
"""

import logging
import re
import sys
from collections.abc import Callable
from functools import wraps
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from seo_http import brand_config, seo_error, seo_route

from shared import indexnow, indexnow_store
from shared.api_response import success_response
from shared.audit_urls import host_of, is_crawlable, normalize_url
from shared.auth import ADMIN_GROUP, get_caller_identity, require_group
from shared.dataforseo_lighthouse import DEVICES, LIGHTHOUSE_LIVE_USD
from shared.decorators import json_object_body, validate
from shared.kpi_engine import is_owned_domain, normalize_domain, owned_domains_from
from shared.lighthouse_runs import (
    estimated_cost,
    fail_run,
    load_run,
    new_run,
    put_receipt,
    receipt_run,
    recent_runs,
    remember_run,
    run_view,
    save_run,
    start_execution,
)
from shared.lighthouse_sample import MAX_SAMPLE_PAGES, is_measurable, select_sample
from shared.site_audit_repository import AuditStore
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

AUDIT_LIST_LIMIT = 25
START_FAILED_MESSAGE = 'The Lighthouse run could not start; nothing was charged'
Handler = Callable[..., dict[str, Any]]
_HEX_ID = re.compile(r'^[0-9a-f]{32}$')

SINGLE_SCHEMA: dict[str, dict[str, Any]] = {
    'url': {'required': True, 'type': str, 'min_length': 1, 'max_length': 2048},
    'device': {'type': str, 'choices': list(DEVICES), 'default': 'mobile'},
}
BATCH_SCHEMA: dict[str, dict[str, Any]] = {
    'audit_id': {'required': True, 'type': str, 'min_length': 32, 'max_length': 32},
}
DOMAIN_SCHEMA: dict[str, dict[str, Any]] = {
    'domain': {'required': True, 'type': str, 'min_length': 1, 'max_length': 253},
}
SUBMIT_SCHEMA: dict[str, dict[str, Any]] = {
    'source': {'type': str, 'choices': ['paste', 'audit'], 'default': 'paste'},
}


def _owned() -> list[str]:
    return owned_domains_from(brand_config())


def _caller(event: dict[str, Any]) -> str:
    return get_caller_identity(event) or 'unknown'


def _completed_audit(store: AuditStore, audit_id: str | None = None) -> dict[str, Any] | None:
    """The newest finished audit, or the named one when it finished."""
    if audit_id is not None:
        audit = store.get_audit(audit_id)
        return audit if audit is not None and audit.get('status') == 'completed' else None
    return next((audit for audit in store.list_audits(AUDIT_LIST_LIMIT) if audit.get('status') == 'completed'), None)


def _audit_header(audit: dict[str, Any]) -> dict[str, Any]:
    return {key: audit.get(key) for key in ('audit_id', 'start_url', 'completed_at', 'pages_crawled')}


# ---------------------------------------------------------------------------
# Lighthouse
# ---------------------------------------------------------------------------

def _owned_page(raw: str) -> str | None:
    text = raw.strip()
    url = normalize_url(text if '://' in text else f'https://{text}')
    if url is None or not is_crawlable(url):
        return None
    return url if is_owned_domain(normalize_domain(host_of(url)) or '', _owned()) else None


def _reuse_or_start(event: dict[str, Any], receipt: dict[str, Any], build: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The run an equal request started within 15 minutes, else a new run (``build``) started now."""
    reused = receipt_run(receipt)
    if reused is not None:
        return success_response({'run': run_view(reused), 'reused': True}, event)
    run = build()
    save_run(run)
    put_receipt(receipt, run['run_id'])
    remember_run(run)
    try:
        start_execution(run)
    except (ClientError, BotoCoreError, KeyError) as error:
        logger.warning('lighthouse run %s could not start: %s', run['run_id'], type(error).__name__)
        fail_run(run, START_FAILED_MESSAGE)
        remember_run(run)
        return seo_error(502, 'INTERNAL_ERROR', START_FAILED_MESSAGE, event)
    return success_response({'run': run_view(run), 'reused': False}, event, 202)


@json_object_body
@validate(SINGLE_SCHEMA)
def start_single(event: dict[str, Any], _context: Any, *, url: str, device: str, **_kwargs: Any) -> dict[str, Any]:
    page = _owned_page(url)
    if page is None:
        return seo_error(400, 'VALIDATION_ERROR', "url must be a public page on one of the brand's own domains",
                         event, 'url')
    return _reuse_or_start(event, {'kind': 'single', 'url': page, 'device': device},
                           lambda: new_run('single', [{'url': page, 'device': device}], _caller(event)))


def _sample(audit: dict[str, Any], store: AuditStore) -> list[str]:
    return select_sample(store.pages(audit['audit_id']), str(audit.get('start_url') or ''), MAX_SAMPLE_PAGES)


def get_sample(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    store = AuditStore()
    audit = _completed_audit(store)
    pages = _sample(audit, store) if audit is not None else []
    targets = len(pages) * len(DEVICES)
    return success_response({
        'audit': _audit_header(audit) if audit is not None else None, 'pages': pages, 'devices': list(DEVICES),
        'target_count': targets, 'estimated_cost_usd': estimated_cost(targets), 'price_per_run_usd': LIGHTHOUSE_LIVE_USD,
    }, event)


@require_group(ADMIN_GROUP)
@json_object_body
@validate(BATCH_SCHEMA)
def start_batch(event: dict[str, Any], _context: Any, *, audit_id: str, **_kwargs: Any) -> dict[str, Any]:
    store = AuditStore()
    audit = _completed_audit(store, audit_id) if _HEX_ID.match(audit_id) else None
    if audit is None:
        return seo_error(404, 'NOT_FOUND', 'No finished audit with this id', event, 'audit_id')
    pages = _sample(audit, store)
    if not pages:
        return seo_error(400, 'VALIDATION_ERROR', 'The audit has no page that loaded cleanly to measure', event, 'audit_id')
    targets = [{'url': page, 'device': device} for page in pages for device in DEVICES]
    return _reuse_or_start(event, {'kind': 'batch', 'audit_id': audit_id},
                           lambda: new_run('batch', targets, _caller(event), audit_id))


def get_lighthouse(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """``GET /lighthouse`` (recent runs) or ``GET /lighthouse/{runId}`` (one run)."""
    segments = [part for part in str(event.get('path', '')).split('/') if part]
    if segments and segments[-1] == 'lighthouse':
        return success_response({'runs': recent_runs()}, event)
    run_id = (event.get('pathParameters') or {}).get('run_id') or segments[-1]
    run = load_run(run_id) if isinstance(run_id, str) and _HEX_ID.match(run_id) else None
    if run is None:
        return seo_error(404, 'NOT_FOUND', 'Lighthouse run not found', event)
    return success_response({'run': run_view(run)}, event)


# ---------------------------------------------------------------------------
# IndexNow
# ---------------------------------------------------------------------------

def _site(domain: str, key: str | None) -> dict[str, Any]:
    hosts = [domain, f'www.{domain}']
    return {
        'domain': domain, 'key': key,
        'key_files': [{'host': host, 'url': indexnow.key_file_url(host, key)} for host in hosts] if key else [],
    }


def get_indexnow(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    domains = _owned()
    keys = indexnow_store.site_keys(domains)
    return success_response({
        'sites': [_site(domain, keys.get(domain)) for domain in domains],
        'history': indexnow_store.history(), 'max_urls': indexnow.MAX_URLS,
    }, event)


def owned_domain_body(func: Handler) -> Handler:
    """Validate the body's ``domain`` as one of the brand's own domains and inject it as ``owned``."""
    @json_object_body
    @validate(DOMAIN_SCHEMA)
    @wraps(func)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, domain: str, **kwargs: Any) -> dict[str, Any]:
        owned = normalize_domain(domain)
        if owned is None or owned not in _owned():
            return seo_error(400, 'VALIDATION_ERROR', "domain must be one of the brand's own domains", event, 'domain')
        return func(event, context, *args, owned=owned, **kwargs)

    return wrapper


@require_group(ADMIN_GROUP)
@owned_domain_body
def create_key(event: dict[str, Any], _context: Any, *, owned: str, **_kwargs: Any) -> dict[str, Any]:
    key, created = indexnow_store.ensure_key(owned, _caller(event))
    return success_response({'site': _site(owned, key), 'created': created}, event, 201 if created else 200)


@owned_domain_body
def check_key(event: dict[str, Any], _context: Any, *, owned: str, **_kwargs: Any) -> dict[str, Any]:
    key = indexnow_store.site_key(owned)
    if key is None:
        return seo_error(404, 'NOT_FOUND', 'Create the IndexNow key for this domain first', event, 'domain')
    hosts = []
    for host in (owned, f'www.{owned}'):
        status = indexnow.check_key_file(host, key)
        hosts.append({'host': host, 'url': indexnow.key_file_url(host, key), 'status': status,
                      'problem': indexnow.key_file_problem(status, host)})
    return success_response({'domain': owned, 'hosts': hosts}, event)


def _audit_urls() -> list[str] | None:
    store = AuditStore()
    audit = _completed_audit(store)
    if audit is None:
        return None
    pages = (page for page in store.pages(audit['audit_id']) if is_measurable(page))
    return list(dict.fromkeys(str(page['url']) for page in pages))[:indexnow.MAX_URLS]


def _pasted_urls(value: object) -> tuple[list[str] | None, str | None]:
    if not isinstance(value, list) or not all(isinstance(entry, str) for entry in value):
        return None, 'urls must be an array of strings'
    urls = [entry.strip() for entry in value if entry.strip()]
    if not urls:
        return None, 'urls must contain at least one URL'
    if len(urls) > indexnow.MAX_URLS:
        return None, f'urls accepts at most {indexnow.MAX_URLS} URLs'
    return urls, None


@require_group(ADMIN_GROUP)
@json_object_body
@validate(SUBMIT_SCHEMA)
def submit_urls(event: dict[str, Any], _context: Any, *, body: dict[str, Any], source: str, **_kwargs: Any) -> dict[str, Any]:
    if source == 'audit':
        urls = _audit_urls()
        if not urls:
            return seo_error(400, 'VALIDATION_ERROR', 'No finished audit with pages to submit', event, 'source')
    else:
        urls, error = _pasted_urls(body.get('urls'))
        if urls is None:
            return seo_error(400, 'VALIDATION_ERROR', error or 'urls is invalid', event, 'urls')
    domains = _owned()
    groups = indexnow.group_urls(urls, domains)
    hosts = indexnow.submit(groups, indexnow_store.site_keys(domains))
    submission = {
        'submitted_at': get_timestamp(), 'submitted_by': _caller(event), 'source': source,
        'url_count': sum(len(hosted) for hosted in groups.by_host.values()), 'skipped_count': len(groups.skipped),
        'skipped_examples': groups.skipped[:5], 'hosts': hosts,
    }
    indexnow_store.record_submission(submission)
    return success_response({'submission': submission}, event)


handler = seo_route({
    ('GET', '/lighthouse/sample'): get_sample,
    ('POST', '/lighthouse/batch'): start_batch,
    ('POST', '/lighthouse'): start_single,
    ('GET', '/lighthouse'): get_lighthouse,
    ('POST', '/indexnow/key'): create_key,
    ('POST', '/indexnow/check'): check_key,
    ('POST', '/indexnow/submit'): submit_urls,
    ('GET', '/indexnow'): get_indexnow,
})
