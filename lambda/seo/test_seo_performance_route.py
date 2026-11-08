"""``/api/seo/lighthouse`` and ``/api/seo/indexnow`` (``seo-performance.py``): owned pages only, receipts, Admin gates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import indexnow, lighthouse_runs, seo_spend_limit
from testing.dataforseo_fixtures import install_daily_limit
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.indexnow_fixtures import SAMPLE_HEX_32 as KEY
from testing.indexnow_fixtures import KeyTable, install_key_table
from testing.local_seo_fixtures import MemoryCache
from testing.performance_fixtures import install_run_cache, saved_run, stored_run
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event
from testing.site_audit_fixtures import AUDIT_ID, MemoryAuditStore, new_audit_item

performance_module = handler_fixture(SEO_DIR, 'seo-performance.py', 'seo_performance_under_test', env=SEO_ENV)
PAGE = 'https://www.example.com/'


@dataclass
class Api:
    module: Any
    memory: MemoryCache
    keys: KeyTable
    store: MemoryAuditStore
    start_execution: MagicMock
    engines: MagicMock

    def call(self, method: str, path: str, *, groups: str = 'Users', body=None):
        event = seo_event(method, f'/api/seo{path}', groups=groups, body=body)
        return parse_response(self.module.handler(event, {}))


@pytest.fixture
def api(performance_module, monkeypatch) -> Api:
    store = MemoryAuditStore()
    start = MagicMock()
    engines = MagicMock(return_value=200)
    monkeypatch.setattr(lighthouse_runs, 'start_execution', start)
    monkeypatch.setattr(indexnow, 'send', engines)
    monkeypatch.setattr(indexnow, 'check_key_file', MagicMock(return_value='found'))
    monkeypatch.setattr(performance_module, 'AuditStore', MagicMock(return_value=store))
    monkeypatch.setattr(performance_module, 'start_execution', start)
    memory, keys = install_run_cache(monkeypatch), install_key_table(monkeypatch)
    return Api(performance_module, memory, keys, store, start, engines)


@pytest.fixture
def audited(api: Api) -> Api:
    """A finished audit of the example site: the homepage, two blog posts and a blocked page."""
    api.store.create_audit({**new_audit_item(), 'status': 'completed', 'completed_at': '2026-10-02T09:00:00Z'})
    for path, fetch_class in (('/', 'ok'), ('/blog/first-great-post', 'ok'), ('/blog/second-great-post', 'ok'),
                              ('/private', 'blocked')):
        api.store.put_page(AUDIT_ID, {'url': f'https://www.example.com{path}', 'status': 200,
                                      'fetch_class': fetch_class, 'is_html': True})
    return api


class TestSingleLighthouseDailyLimit:
    """The jobs Lambda makes the billed Lighthouse call, so the router counts it before the run starts."""

    def start(self, api):
        event = seo_event('POST', '/api/seo/lighthouse', body={'url': PAGE, 'device': 'desktop'})
        return parse_response(seo_spend_limit.limited(api.module.handler)(event, {}))

    def test_counts_one_call_for_a_single_run(self, api, monkeypatch):
        limit = install_daily_limit(monkeypatch, 100)

        status, _body = self.start(api)

        assert (status, limit.counter.calls_of('admin@example.com'), api.start_execution.call_count) == (202, 1, 1)

    def test_refuses_a_run_when_paid_lookups_are_off(self, api, monkeypatch):
        limit = install_daily_limit(monkeypatch, 0)

        status, body = self.start(api)

        assert (status, body['code'], limit.counter.calls_of('admin@example.com'), api.start_execution.call_count) == (
            429, 'DAILY_LIMIT', 0, 0)


class TestSingleLighthouse:
    def test_starts_a_run_for_an_owned_page(self, api: Api):
        status, body = api.call('POST', '/lighthouse', body={'url': 'www.example.com', 'device': 'desktop'})

        assert (status, body['run']['targets'], api.start_execution.call_count) == (
            202, [{'url': PAGE, 'device': 'desktop'}], 1)

    def test_refuses_a_page_off_the_owned_domains_before_any_spend(self, api: Api):
        status, body = api.call('POST', '/lighthouse', body={'url': 'https://acme.example.org/'})

        assert (status, body['field'], api.start_execution.call_count) == (400, 'url', 0)

    def test_answers_the_run_started_for_the_same_page_within_fifteen_minutes(self, api: Api):
        _status, first = api.call('POST', '/lighthouse', body={'url': PAGE})
        status, again = api.call('POST', '/lighthouse', body={'url': PAGE})

        assert (status, again['reused'], again['run']['run_id'], api.start_execution.call_count) == (
            200, True, first['run']['run_id'], 1)

    def test_marks_the_run_failed_when_the_execution_cannot_start(self, api: Api):
        api.start_execution.side_effect = ClientError({'Error': {'Code': 'ExecutionLimitExceeded'}}, 'StartExecution')

        status, _body = api.call('POST', '/lighthouse', body={'url': PAGE})

        assert (status, api.module.recent_runs()[0]['status']) == (502, 'failed')

    def test_lists_recent_runs(self, api: Api):
        api.call('POST', '/lighthouse', body={'url': PAGE})

        _status, body = api.call('GET', '/lighthouse')
        assert [run['first_url'] for run in body['runs']] == [PAGE]

    def test_answers_one_run_by_id(self, api: Api):
        run = stored_run(api.memory, [{'url': PAGE, 'device': 'mobile'}])

        status, body = api.call('GET', f"/lighthouse/{run['run_id']}")
        assert (status, body['run']['progress']) == (200, {'done': 0, 'total': 1})

    def test_answers_404_for_an_unknown_run(self, api: Api):
        assert api.call('GET', f'/lighthouse/{"f" * 32}')[0] == 404


class TestBatchLighthouse:
    def test_the_sample_lists_the_homepage_and_one_page_per_template_with_its_price(self, audited: Api):
        _status, body = audited.call('GET', '/lighthouse/sample')

        assert (body['pages'], body['target_count'], body['estimated_cost_usd']) == (
            [PAGE, 'https://www.example.com/blog/first-great-post'], 4, 0.02)

    def test_the_sample_is_empty_without_a_finished_audit(self, api: Api):
        _status, body = api.call('GET', '/lighthouse/sample')

        assert (body['audit'], body['pages']) == (None, [])

    def test_a_batch_is_admin_only(self, audited: Api):
        status, _body = audited.call('POST', '/lighthouse/batch', body={'audit_id': AUDIT_ID})

        assert (status, audited.start_execution.call_count) == (403, 0)

    def test_a_batch_measures_each_sample_page_on_both_devices(self, audited: Api):
        status, body = audited.call('POST', '/lighthouse/batch', groups='Admin', body={'audit_id': AUDIT_ID})

        devices = [target['device'] for target in body['run']['targets']]
        assert (status, devices) == (202, ['mobile', 'desktop', 'mobile', 'desktop'])

    def test_a_batch_of_an_unfinished_audit_answers_404(self, api: Api):
        api.store.create_audit(new_audit_item())

        assert api.call('POST', '/lighthouse/batch', groups='Admin', body={'audit_id': AUDIT_ID})[0] == 404


class TestIndexNowSetup:
    def test_lists_each_owned_domain_without_a_key_at_first(self, api: Api):
        _status, body = api.call('GET', '/indexnow')

        assert body['sites'] == [{'domain': 'example.com', 'key': None, 'key_files': []}]

    def test_creating_a_key_is_admin_only(self, api: Api):
        assert api.call('POST', '/indexnow/key', body={'domain': 'example.com'})[0] == 403

    def test_an_admin_creates_the_key_and_gets_where_to_host_it(self, api: Api):
        status, body = api.call('POST', '/indexnow/key', groups='Admin', body={'domain': 'example.com'})

        key = body['site']['key']
        assert (status, [entry['url'] for entry in body['site']['key_files']]) == (
            201, [f'https://example.com/{key}.txt', f'https://www.example.com/{key}.txt'])

    def test_refuses_a_key_for_a_domain_the_brand_does_not_own(self, api: Api):
        status, body = api.call('POST', '/indexnow/key', groups='Admin', body={'domain': 'acme.example.org'})

        assert (status, body['field']) == (400, 'domain')

    def test_checks_the_key_file_on_the_domain_and_its_www_host(self, api: Api):
        api.keys.items['indexnow-key#example.com'] = {'cache_key': 'indexnow-key#example.com', 'key': KEY}

        _status, body = api.call('POST', '/indexnow/check', body={'domain': 'example.com'})
        assert [(host['host'], host['status']) for host in body['hosts']] == [
            ('example.com', 'found'), ('www.example.com', 'found')]

    def test_check_without_a_key_answers_404(self, api: Api):
        assert api.call('POST', '/indexnow/check', body={'domain': 'example.com'})[0] == 404


class TestIndexNowSubmit:
    @pytest.fixture
    def keyed(self, api: Api) -> Api:
        api.keys.items['indexnow-key#example.com'] = {'cache_key': 'indexnow-key#example.com', 'key': KEY}
        return api

    def test_submitting_is_admin_only(self, keyed: Api):
        status, _body = keyed.call('POST', '/indexnow/submit', body={'urls': [PAGE]})

        assert (status, keyed.engines.call_count) == (403, 0)

    def test_submits_owned_urls_and_counts_the_skipped_ones(self, keyed: Api):
        _status, body = keyed.call('POST', '/indexnow/submit', groups='Admin',
                                   body={'urls': [PAGE, 'https://acme.example.org/']})

        submission = body['submission']
        assert (submission['url_count'], submission['skipped_count'], submission['hosts'][0]['status']) == (
            1, 1, 'submitted')

    def test_records_the_submission_in_the_history(self, keyed: Api):
        keyed.call('POST', '/indexnow/submit', groups='Admin', body={'urls': [PAGE]})

        _status, body = keyed.call('GET', '/indexnow')
        assert [entry['url_count'] for entry in body['history']] == [1]

    def test_submits_the_cleanly_loaded_pages_of_the_latest_audit(self, keyed: Api, audited: Api):
        _status, body = audited.call('POST', '/indexnow/submit', groups='Admin', body={'source': 'audit'})

        assert body['submission']['url_count'] == 3

    def test_refuses_more_than_ten_thousand_urls(self, keyed: Api):
        urls = [f'https://www.example.com/p{index}' for index in range(10_001)]

        status, body = keyed.call('POST', '/indexnow/submit', groups='Admin', body={'urls': urls})
        assert (status, body['field'], keyed.engines.call_count) == (400, 'urls', 0)

    def test_refuses_an_empty_url_list(self, keyed: Api):
        assert keyed.call('POST', '/indexnow/submit', groups='Admin', body={'urls': ['  ']})[0] == 400


def test_a_started_run_is_stored_as_queued(api: Api):
    _status, body = api.call('POST', '/lighthouse', body={'url': PAGE})

    assert saved_run(api.memory, body['run']['run_id'])['status'] == 'queued'
