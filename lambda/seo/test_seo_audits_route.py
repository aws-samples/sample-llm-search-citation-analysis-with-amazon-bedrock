"""``/api/seo/audits`` (``seo-audits.py``): start, list, detail, issues, pages, cancel."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from shared.audit_issues import Issue
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event
from testing.site_audit_fixtures import AUDIT_ID, STARTED_AT, MemoryAuditStore, new_audit_item

audits_module = handler_fixture(SEO_DIR, 'seo-audits.py', 'seo_audits_under_test', env=SEO_ENV)
BASE = '/api/seo/audits'
PAGE_URL = 'https://www.example.com/a'


@dataclass
class Api:
    module: ModuleType
    store: MemoryAuditStore
    start_execution: MagicMock
    stop_execution: MagicMock

    def call(self, method: str, path: str = BASE, *, groups: str = 'Users', body=None, query=None):
        event = seo_event(method, path, groups=groups, body=body, query=query)
        return parse_response(self.module.handler(event, {}))


@pytest.fixture
def api(audits_module) -> Iterator[Api]:
    store = MemoryAuditStore()
    start = MagicMock(return_value='arn:aws:states:eu-west-1:000000000000:execution:CitationAnalysis-SiteAudit:x')
    stop = MagicMock()
    with patch.multiple(audits_module, AuditStore=MagicMock(return_value=store), start_execution=start,
                        stop_execution=stop):
        yield Api(audits_module, store, start, stop)


@pytest.fixture
def finished(api: Api) -> Api:
    """An audit with one crawled page and two issues on it."""
    audit = {**new_audit_item(), 'status': 'completed', 'execution_arn': 'arn:x',
             'summary': {'issue_types': [{'issue_type': 'missing-title', 'issues': 1, 'pages': 1},
                                         {'issue_type': 'llms-txt-missing', 'issues': 1, 'pages': 1}]}}
    api.store.create_audit(audit)
    api.store.put_page(AUDIT_ID, {'url': PAGE_URL, 'status': 200, 'internal_links': ['x'], 'title': ''})
    api.store.put_issues(AUDIT_ID, [Issue('missing-title', PAGE_URL), Issue('llms-txt-missing', PAGE_URL)])
    return api


def test_admin_starts_an_audit_of_an_owned_site(api: Api):
    status, body = api.call('POST', groups='Admin', body={'start_url': 'www.example.com', 'max_pages': 100})

    assert (status, body['audit']['start_url'], body['audit']['max_pages'], api.start_execution.call_count) == (
        202, 'https://www.example.com/', 100, 1,
    )


def test_starting_is_refused_to_a_user_who_is_not_an_admin(api: Api):
    status, body = api.call('POST', groups='Users', body={'start_url': 'www.example.com'})

    assert (status, body['code'], api.start_execution.call_count) == (403, 'FORBIDDEN', 0)


def test_starting_is_refused_for_a_site_the_brand_does_not_own(api: Api):
    status, body = api.call('POST', groups='Admin', body={'start_url': 'https://acme.example.org/'})

    assert (status, body['code'], body['field']) == (400, 'VALIDATION_ERROR', 'start_url')


def test_max_pages_outside_the_choices_is_refused(api: Api):
    status, body = api.call('POST', groups='Admin', body={'start_url': 'www.example.com', 'max_pages': 50})

    assert (status, body['field']) == (400, 'max_pages')


def test_a_second_audit_is_refused_while_one_is_running(api: Api):
    api.store.create_audit(new_audit_item())
    status, body = api.call('POST', groups='Admin', body={'start_url': 'www.example.com'})

    assert (status, body['code']) == (409, 'AUDIT_RUNNING')


def test_list_answers_recent_audits_and_the_owned_sites(finished: Api):
    status, body = finished.call('GET')

    assert (status, [audit['audit_id'] for audit in body['audits']], body['sites'], body['max_pages_choices']) == (
        200, [AUDIT_ID], ['example.com'], [100, 500, 2000],
    )


def test_detail_answers_the_audit_with_its_summary(finished: Api):
    status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}')

    assert (status, body['audit']['status'], body['audit']['started_at']) == (200, 'completed', STARTED_AT)


def test_detail_of_an_unknown_audit_is_not_found(api: Api):
    status, body = api.call('GET', f'{BASE}/{"f" * 32}')

    assert (status, body['code']) == (404, 'NOT_FOUND')


def test_detail_of_a_malformed_id_is_not_found(api: Api):
    assert api.call('GET', f'{BASE}/not-an-id')[0] == 404


def test_issue_types_come_with_their_registry_text_critical_first(finished: Api):
    _status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/issues')

    assert [(entry['issue_type'], entry['severity']) for entry in body['issue_types']] == [
        ('missing-title', 'critical'), ('llms-txt-missing', 'info'),
    ]


def test_issues_of_one_type_list_the_affected_pages(finished: Api):
    _status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/issues', query={'issue_type': 'missing-title'})

    assert ([item['page_url'] for item in body['items']], body['issue']['title'], body['next_token']) == (
        [PAGE_URL], 'Missing title tag', None,
    )


def test_issue_types_of_a_finished_audit_say_the_audit_is_not_running(finished: Api):
    _status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/issues')

    assert body['audit_running'] is False


def test_issue_types_of_a_running_audit_say_the_audit_is_running(api: Api):
    api.store.create_audit(new_audit_item())

    _status, body = api.call('GET', f'{BASE}/{AUDIT_ID}/issues')

    assert (body['issue_types'], body['audit_running']) == ([], True)


def test_affected_pages_of_a_running_audit_say_the_audit_is_running(api: Api):
    api.store.create_audit(new_audit_item())

    _status, body = api.call('GET', f'{BASE}/{AUDIT_ID}/issues', query={'issue_type': 'missing-title'})

    assert body['audit_running'] is True


def test_an_unknown_issue_type_is_refused(finished: Api):
    status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/issues', query={'issue_type': 'nope'})

    assert (status, body['field']) == (400, 'issue_type')


def test_page_detail_answers_the_page_and_its_issues_without_the_link_list(finished: Api):
    _status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/pages', query={'url': PAGE_URL})

    assert ('internal_links' in body['page'], [issue['issue_type'] for issue in body['issues']]) == (
        False, ['missing-title', 'llms-txt-missing'],
    )


def test_page_list_is_paged_with_a_next_token(finished: Api):
    finished.store.put_page(AUDIT_ID, {'url': f'{PAGE_URL}/b', 'status': 404})
    _status, body = finished.call('GET', f'{BASE}/{AUDIT_ID}/pages', query={'limit': '1'})

    assert ([page['url'] for page in body['pages']], body['next_token']) == ([PAGE_URL], '1')


def test_admin_cancels_a_running_audit_and_its_execution_stops(api: Api):
    api.store.create_audit({**new_audit_item(), 'execution_arn': 'arn:x'})
    status, body = api.call('POST', f'{BASE}/{AUDIT_ID}/cancel', groups='Admin')

    assert (status, body['audit']['status'], api.stop_execution.call_args.args) == (200, 'cancelled', ('arn:x',))


def test_cancelling_a_finished_audit_is_a_conflict(finished: Api):
    status, body = finished.call('POST', f'{BASE}/{AUDIT_ID}/cancel', groups='Admin')

    assert (status, body['code']) == (409, 'NOT_RUNNING')


def test_cancelling_is_refused_to_a_user_who_is_not_an_admin(finished: Api):
    assert finished.call('POST', f'{BASE}/{AUDIT_ID}/cancel', groups='Users')[0] == 403
