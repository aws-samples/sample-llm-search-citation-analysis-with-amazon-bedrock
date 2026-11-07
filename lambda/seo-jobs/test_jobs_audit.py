"""Steps of the site-audit state machine (``jobs_audit.py``)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module
from testing.site_audit_fixtures import (
    AUDIT_ID,
    OWNED,
    SITE,
    FakeSite,
    MemoryAuditStore,
    html_page,
    html_response,
    new_audit_item,
    robots_bucket,
    serving,
    text_response,
)

JOBS_DIR = Path(__file__).resolve().parent


@pytest.fixture
def jobs() -> Iterator[tuple[ModuleType, MemoryAuditStore]]:
    module = load_handler_module(str(JOBS_DIR), 'jobs_audit.py', 'jobs_audit_under_test')
    store = MemoryAuditStore()
    site = FakeSite({
        f'{SITE}/robots.txt': text_response('User-agent: *\nAllow: /\n'),
        f'{SITE}/': html_response(html_page()),
    })
    with patch.multiple(module, AuditStore=MagicMock(return_value=store), owned_domains=MagicMock(return_value=OWNED)), \
            serving(site), robots_bucket():
        yield module, store


def test_start_runs_discovery_and_moves_the_audit_to_crawl(jobs):
    module, store = jobs
    store.create_audit({**new_audit_item(), 'status': 'queued'})

    result = module.STEPS['audit.start']({'audit_id': AUDIT_ID})

    assert (result, store.audits[AUDIT_ID]['phase'], store.audits[AUDIT_ID]['status']) == (
        {'audit_id': AUDIT_ID, 'chunk_no': 0, 'done': False, 'wait_seconds': 0}, 'crawl', 'running',
    )


def test_every_step_ends_without_work_when_the_audit_was_cancelled(jobs):
    module, store = jobs
    store.create_audit({**new_audit_item(), 'status': 'cancelled'})

    results = [module.STEPS[name]({'audit_id': AUDIT_ID})['done'] for name in ('audit.start', 'audit.crawl', 'audit.finalize')]

    assert (results, store.pages_by_url) == ([True, True, True], {})


def test_crawl_and_finalize_complete_the_audit(jobs):
    module, store = jobs
    store.create_audit({**new_audit_item(), 'status': 'queued'})
    module.STEPS['audit.start']({'audit_id': AUDIT_ID})
    crawl = module.STEPS['audit.crawl']({'audit_id': AUDIT_ID, 'chunk_no': 0})
    module.STEPS['audit.finalize']({'audit_id': AUDIT_ID})

    assert (crawl['done'], store.audits[AUDIT_ID]['status'], store.audits[AUDIT_ID]['pages_crawled']) == (
        True, 'completed', 1,
    )


def test_fail_records_the_error_code_and_phase(jobs):
    module, store = jobs
    store.create_audit({**new_audit_item(), 'phase': 'crawl'})

    module.STEPS['audit.fail']({'audit_id': AUDIT_ID, 'error': {'Error': 'States.Timeout', 'Cause': 'x' * 400}})
    audit = store.audits[AUDIT_ID]

    assert (audit['status'], audit['error_code'], audit['failed_phase'], len(audit['error_detail'])) == (
        'failed', 'step_timeout', 'crawl', 300,
    )


def test_a_step_for_an_unknown_audit_raises(jobs):
    module, _store = jobs

    with pytest.raises(module.AuditNotFoundError):
        module.STEPS['audit.crawl']({'audit_id': 'missing'})


def test_steps_return_only_small_state(jobs):
    module, store = jobs
    store.create_audit({**new_audit_item(), 'status': 'queued'})

    assert set(module.STEPS['audit.start']({'audit_id': AUDIT_ID})) == {'audit_id', 'chunk_no', 'done', 'wait_seconds'}
