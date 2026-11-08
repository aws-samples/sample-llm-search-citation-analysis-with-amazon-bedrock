"""``/api/seo/backlinks/...`` (``seo-backlinks.py``): validation, cache, spam rule, budget, history and snapshots."""

from __future__ import annotations

import json
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from shared.dataforseo_backlinks import HISTORY_USD, SUMMARY_USD, TablePage, backlinks_usd
from shared.dataforseo_client import DataForSeoError
from testing.backlinks_fixtures import SUMMARY_ROW, FakeSnapshotsTable
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event

backlinks_module = handler_fixture(SEO_DIR, 'seo-backlinks.py', 'seo_backlinks_under_test', env=SEO_ENV)

TRENDS = [{'date': '2026-09-01', 'backlinks': 10, 'referring_domains': 2, 'rank': 30}]
NEW_LOST = [{'date': '2026-09-01', 'new_backlinks': 1, 'lost_backlinks': 0, 'new_referring_domains': 1,
             'lost_referring_domains': 0}]
LINK = {'domain_from': 'blog.example.org', 'spam_score': None}
STATE_MACHINE_ARN = 'arn:aws:states:eu-west-1:123456789012:stateMachine:CitationAnalysis-SeoBacklinkSnapshots'


class Call:
    """One request through ``seo-backlinks.py`` with DataForSEO, the snapshots table and Step Functions stubbed."""

    def __init__(self, module, boundary, method, path, body=None, *, groups='Users', cached=None,
                 history: object = (TRENDS, NEW_LOST, 0.037), page: TablePage | None = None, running=None) -> None:
        boundary.get_cached.return_value = cached
        self.put_cached = boundary.put_cached
        self.summary = MagicMock(return_value=(dict(SUMMARY_ROW), 0.024))
        self.history = MagicMock(side_effect=history if isinstance(history, Exception) else None,
                                 return_value=history)
        self.table = MagicMock(return_value=page or TablePage(rows=[LINK], total_count=120, cost_usd=0.0258))
        self.subfolder = MagicMock(return_value=(900, 70, 0.048))
        self.snapshots = FakeSnapshotsTable()
        self.states = MagicMock()
        self.states.list_executions.return_value = {'executions': running or []}
        with patch.multiple(
            module, fetch_summary=self.summary, fetch_history=self.history, fetch_table=self.table,
            subfolder_totals=self.subfolder, snapshots_table=MagicMock(return_value=self.snapshots),
            step_functions=MagicMock(return_value=self.states), utc_today=MagicMock(return_value=date(2026, 10, 2)),
        ), patch.dict('os.environ', {module.STATE_MACHINE_ENV: STATE_MACHINE_ARN}):
            event = seo_event(method, path, body=body, groups=groups)
            self.status, self.body = parse_response(module.handler(event, {}))

    @property
    def sent_query(self):
        return self.table.call_args.args[1]


@pytest.fixture
def call(backlinks_module, seo_boundary):
    return lambda method, path, body=None, **stubs: Call(backlinks_module, seo_boundary, method, path, body, **stubs)


@pytest.fixture
def overview(call):
    return lambda body, **stubs: call('POST', '/api/seo/backlinks/overview', body, **stubs)


@pytest.fixture
def rows(call):
    return lambda body, **stubs: call('POST', '/api/seo/backlinks/rows', body, **stubs)


class TestOverview:
    def test_answers_the_summary_and_history_of_a_domain(self, overview):
        answer = overview({'target': 'Example.com'})

        assert (answer.status, answer.body['summary'], answer.body['trends'], answer.body['new_lost_trends']) == (
            200, SUMMARY_ROW, TRENDS, NEW_LOST,
        )

    def test_describes_the_resolved_target_and_its_price(self, overview):
        answer = overview({'target': 'https://www.example.com/'})

        assert {key: answer.body[key] for key in ('target', 'scope', 'cached', 'estimated_cost_usd')} == {
            'target': 'example.com', 'scope': 'subdomains', 'cached': False,
            'estimated_cost_usd': round(SUMMARY_USD + HISTORY_USD, 6),
        }

    def test_asks_history_for_the_hostname_only(self, overview):
        answer = overview({'target': 'example.com', 'scope': 'domain'})

        assert (answer.history.call_args.args, answer.body['history_includes_subdomains']) == (
            ('example.com', date(2026, 10, 2)), True,
        )

    def test_buys_no_history_for_an_exact_page(self, overview):
        answer = overview({'target': 'example.com/pricing', 'scope': 'exact_url'})

        assert (answer.history.call_count, answer.body['history_available'], answer.body['trends']) == (0, False, [])

    def test_counts_a_subfolder_from_its_links_without_a_summary_or_history(self, overview):
        answer = overview({'target': 'example.com/blog'})

        assert (answer.body['summary'], answer.summary.call_count, answer.history.call_count) == (
            {'backlinks': 900, 'referring_domains': 70}, 0, 0,
        )

    def test_caches_the_overview_for_6_hours_under_every_target_input(self, overview):
        answer = overview({'target': 'example.com', 'scope': 'domain'})

        namespace, version, params, _payload, ttl = answer.put_cached.call_args.args
        assert (namespace, version, params, ttl) == ('backlinks-overview', 1, {
            'target': 'example.com', 'scope': 'domain', 'path': '', 'include_subdomains': False,
        }, 21_600)

    def test_answers_from_cache_without_calling_dataforseo(self, overview):
        cached = {'summary': SUMMARY_ROW, 'trends': TRENDS, 'new_lost_trends': [], 'fetched_at': '2026-10-01T00:00:00Z'}

        answer = overview({'target': 'example.com'}, cached=cached)

        assert (answer.body['cached'], answer.body['estimated_cost_usd'], answer.summary.call_count) == (True, 0.0, 0)

    def test_keeps_the_paid_summary_when_the_history_call_fails(self, overview):
        answer = overview({'target': 'example.com'}, history=DataForSeoError('UPSTREAM_UNAVAILABLE', 'down'))

        assert (answer.status, answer.body['summary'], answer.body['history_failed'], answer.put_cached.call_args.args[4]) \
            == (200, SUMMARY_ROW, True, 900)

    @pytest.mark.parametrize('target', ['my_site.com', 'example.com/a?b=1'])
    def test_refuses_an_unusable_target_before_any_paid_call(self, overview, target):
        answer = overview({'target': target, 'scope': 'exact_url'})

        assert (answer.status, answer.body['code'], answer.body['field'], answer.summary.call_count) == (
            400, 'VALIDATION_ERROR', 'target', 0,
        )


class TestTables:
    def test_hides_likely_spam_by_default_while_keeping_unknown_scores(self, rows):
        answer = rows({'target': 'example.com'})

        assert answer.sent_query.filters == [
            [['backlink_spam_score', '<', 40], 'or', ['backlink_spam_score', '=', None]],
        ]

    def test_sends_no_spam_rule_when_likely_spam_is_included(self, rows):
        assert rows({'target': 'example.com', 'include_spam': True}).sent_query.filters is None

    def test_pages_sorts_and_picks_the_link_mode_on_the_server(self, rows):
        answer = rows({'target': 'example.com', 'page': 3, 'page_size': 100, 'sort_field': 'rank', 'sort_order': 'asc',
                       'mode': 'as_is'})

        query = answer.sent_query
        assert (query.limit, query.offset, query.order_by, query.mode) == (100, 200, ['rank,asc'], 'as_is')

    def test_reports_more_rows_from_the_providers_total_count(self, rows):
        answer = rows({'target': 'example.com', 'page': 2},
                      page=TablePage(rows=[LINK], total_count=120, cost_usd=0.0))

        assert (answer.body['has_more'], answer.body['total_count']) == (True, 120)

    def test_reports_no_more_rows_on_the_last_page(self, rows):
        answer = rows({'target': 'example.com', 'page': 3}, page=TablePage(rows=[LINK], total_count=101, cost_usd=0.0))

        assert answer.body['has_more'] is False

    def test_reports_the_condition_budget_used_and_left(self, rows):
        answer = rows({'target': 'example.com/blog', 'filters': {'min_domain_rank': 5}})

        assert (answer.body['conditions_used'], answer.body['condition_limit']) == (7, 2)

    def test_refuses_filters_over_the_budget_with_the_count(self, rows):
        answer = rows({'target': 'example.com/blog', 'filters': {'include': 'a,b', 'min_link_rank': 1}})

        assert (answer.status, answer.body['error'], answer.table.call_count) == (
            400, 'Too many filter conditions (9 of 8 max).', 0,
        )

    def test_refuses_an_unknown_filter(self, rows):
        answer = rows({'target': 'example.com', 'filters': {'min_backlinks': 1}})

        assert (answer.status, answer.body['field']) == (400, 'filters')

    def test_refuses_a_page_size_outside_50_100_200(self, rows):
        assert rows({'target': 'example.com', 'page_size': 25}).status == 400

    def test_refuses_referring_domains_of_a_subfolder(self, call):
        answer = call('POST', '/api/seo/backlinks/referring-domains', {'target': 'example.com/blog'})

        assert (answer.status, answer.body['field'], answer.table.call_count) == (400, 'scope', 0)

    def test_filters_top_pages_of_a_subfolder_on_their_urls(self, call):
        answer = call('POST', '/api/seo/backlinks/top-pages', {'target': 'example.com/blog'})

        assert answer.sent_query.filters[0][0] == ['url', 'like', '%://example.com/blog']

    def test_caches_a_page_under_its_sort_filters_mode_and_spam_rule(self, rows):
        answer = rows({'target': 'example.com', 'filters': {'include': 'Blog'}, 'mode': 'as_is'})

        params = answer.put_cached.call_args.args[2]
        assert {key: params[key] for key in ('tab', 'order_by', 'filters', 'mode', 'hide_spam')} == {
            'tab': 'backlinks', 'order_by': ['first_seen,desc'], 'filters': {'include': 'blog'}, 'mode': 'as_is',
            'hide_spam': True,
        }

    def test_caches_an_empty_page_for_one_hour(self, rows):
        answer = rows({'target': 'example.com'}, page=TablePage(rows=[], total_count=0, cost_usd=0.0258))

        assert answer.put_cached.call_args.args[4] == 3_600

    @pytest.mark.parametrize('body', [{'target': 'example.com'}, {'target': 'example.com', 'offset': 4000, 'limit': 1000}],
                             ids=['page', 'export-chunk'])
    def test_answers_a_cached_page_or_chunk_for_free(self, rows, body):
        answer = rows(body, cached={'rows': [LINK], 'total_count': 1, 'fetched_at': 'x'})

        assert (answer.body['cached'], answer.body['estimated_cost_usd'], answer.table.call_count) == (True, 0.0, 0)


TABLE_PATHS = ['/api/seo/backlinks/rows', '/api/seo/backlinks/referring-domains', '/api/seo/backlinks/top-pages']
EXPORT_CHUNK = {'target': 'example.com', 'offset': 4000, 'limit': 1000}


@pytest.fixture(params=TABLE_PATHS)
def table(request, call):
    """A POST to each of the three tables."""
    return lambda body, **stubs: call('POST', request.param, body, **stubs)


class TestExportChunks:
    def test_sends_offset_and_limit_to_dataforseo_instead_of_the_page(self, table):
        query = table({**EXPORT_CHUNK, 'page': 2, 'page_size': 200}).sent_query

        assert (query.offset, query.limit) == (4000, 1000)

    def test_prices_a_fresh_chunk_at_one_request_of_its_rows(self, table):
        answer = table(EXPORT_CHUNK)

        assert answer.body['estimated_cost_usd'] == backlinks_usd(1000)

    def test_caches_a_chunk_under_its_offset_and_limit_without_the_page(self, table):
        params = table(EXPORT_CHUNK).put_cached.call_args.args[2]

        assert ({key: params.get(key) for key in ('offset', 'limit', 'page', 'page_size')}) == {
            'offset': 4000, 'limit': 1000, 'page': None, 'page_size': None,
        }

    def test_keys_two_chunks_apart(self, table):
        first = table(EXPORT_CHUNK).put_cached.call_args.args[2]
        second = table({**EXPORT_CHUNK, 'limit': 500}).put_cached.call_args.args[2]

        assert first != second

    def test_keeps_the_page_cache_key_of_a_page(self, table):
        params = table({'target': 'example.com', 'page': 3, 'page_size': 100}).put_cached.call_args.args[2]

        assert ((params['page'], params['page_size']), 'limit' in params) == ((3, 100), False)

    def test_echoes_the_chunk_window_beside_the_default_page(self, table):
        body = table(EXPORT_CHUNK).body

        assert (body['offset'], body['limit'], body['page'], body['page_size']) == (4000, 1000, 1, 50)

    def test_echoes_a_null_window_on_a_page(self, table):
        body = table({'target': 'example.com'}).body

        assert (body['offset'], body['limit']) == (None, None)

    def test_reports_more_rows_after_the_chunk_from_the_total(self, table):
        answer = table(EXPORT_CHUNK, page=TablePage(rows=[LINK] * 1000, total_count=5001, cost_usd=0.0))

        assert answer.body['has_more'] is True

    def test_reports_no_more_rows_when_the_chunk_reaches_the_total(self, table):
        answer = table(EXPORT_CHUNK, page=TablePage(rows=[LINK] * 1000, total_count=5000, cost_usd=0.0))

        assert answer.body['has_more'] is False

    def test_carries_the_backlinks_export_prices(self, table):
        assert table({'target': 'example.com'}).body['export'] == {
            'max_rows': 10_000, 'rows_per_request': 1000, 'request_usd': 0.024, 'row_usd': 0.000036,
        }

    @pytest.mark.parametrize(('overrides', 'field'), [
        pytest.param({'offset': 9001}, 'limit', id='ends-past-row-10000'),
        pytest.param({'limit': 1001}, 'limit', id='limit-over-1000'),
        pytest.param({'offset': 10_000}, 'offset', id='offset-over-9999'),
        pytest.param({'limit': False}, 'limit', id='limit-boolean'),
        pytest.param({'limit': 99.5}, 'limit', id='limit-fractional'),
    ])
    def test_refuses_a_bad_window_before_any_paid_call(self, table, overrides, field):
        answer = table({**EXPORT_CHUNK, **overrides})

        assert (answer.status, answer.body['code'], answer.body['field'], answer.table.call_count) == (
            400, 'VALIDATION_ERROR', field, 0,
        )


class TestSnapshots:
    def test_lists_every_tracked_domain_with_its_snapshots(self, call):
        answer = call('GET', '/api/seo/backlinks/snapshots')

        assert [(entry['domain'], entry['role'], entry['competitor'], entry['snapshots']) for entry in answer.body['domains']] \
            == [('example.com', 'owned', None, []), ('acme.example.org', 'competitor', 'Acme', [])]

    def test_prices_a_run_at_one_summary_per_domain(self, call):
        answer = call('GET', '/api/seo/backlinks/snapshots')

        assert answer.body['estimated_run_cost_usd'] == round(2 * SUMMARY_USD, 6)

    def test_refuses_snapshot_now_to_a_non_admin(self, call):
        answer = call('POST', '/api/seo/backlinks/snapshots', {})

        assert (answer.status, answer.body['code'], answer.states.start_execution.call_count) == (403, 'FORBIDDEN', 0)

    def test_starts_one_snapshot_run_for_an_admin(self, call):
        answer = call('POST', '/api/seo/backlinks/snapshots', {}, groups='Admin')

        started = answer.states.start_execution.call_args.kwargs
        assert (answer.status, started['stateMachineArn'], json.loads(started['input'])['step']) == (
            202, STATE_MACHINE_ARN, 'backlinks.snapshot_all',
        )

    def test_refuses_a_second_run_while_one_is_running(self, call):
        answer = call('POST', '/api/seo/backlinks/snapshots', {}, groups='Admin', running=[{'name': 'manual-1'}])

        assert (answer.status, answer.body['code'], answer.states.start_execution.call_count) == (409, 'ALREADY_RUNNING', 0)

