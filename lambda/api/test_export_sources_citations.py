"""Export sources S12-S15 (citations, URL breakdown, crawl history, searches): every row of the view, in its order, exact resume.

Citations, URL breakdown and searches run against a generated tenant (the
citation rollup built, so ``scope=all`` is served from it); crawl history
against a paged fake route (the tenant crawls nothing).
"""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import pytest

from shared.export_source_citations import CITATIONS, CRAWL_HISTORY, SEARCHES, URL_BREAKDOWN
from shared.export_source_routes import RouteSource
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, PagedRoute, all_rows, resumes_from_every_row, row_values
from testing.full_list_fixtures import TenantRoutes, over_tenant, short_paged
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_SHORT = 7


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


def _rows(tenant: EndToEndTenant, source: RouteSource, params: dict[str, str], *, live: bool = False, page: int = _SHORT) -> list[tuple[str, tuple[Any, ...]]]:
    return row_values(all_rows(over_tenant(short_paged(source, page), TenantRoutes(tenant, live=live)), params))


def _answer(tenant: EndToEndTenant, handler: str, path: str, query: dict[str, str]) -> dict[str, Any]:
    status, body = tenant.call(handler, path, query)
    assert status == 200, body
    return body


@pytest.mark.parametrize('params', [{'scope': 'all'}, {'group_id': group_id(0), 'sort': 'domain', 'order': 'asc'}, {'market_id': market_id(0)}], ids=str)
def test_citations_equal_one_uncut_page_of_the_view(tenant, params):
    assert _rows(tenant, CITATIONS, params) == _rows(tenant, CITATIONS, params, page=1000)


def test_citations_hold_every_url_the_filters_match(tenant):
    params = {'scope': 'all', 'url_contains': 'www'}
    matched = _answer(tenant, 'get-citations.py', '/api/citations', params)['matched_urls']

    assert (matched > 2 * _SHORT, len(_rows(tenant, CITATIONS, params))) == (True, matched)


def test_citations_list_the_keywords_citing_each_url(tenant):
    first = _rows(tenant, CITATIONS, {'keyword': keyword_text(1)})[0][1]

    assert keyword_text(1) in str(first[5]).split('; ')


def _cited_url(tenant: EndToEndTenant) -> str:
    return _answer(tenant, 'get-citations.py', '/api/citations', {'scope': 'all'})['top_urls'][0]['url']


def test_url_breakdown_holds_every_entry_newest_first(tenant):
    url = _cited_url(tenant)
    total = _answer(tenant, 'get-url-breakdown.py', '/api/url-breakdown', {'url': url})['total_citations']

    rows = _rows(tenant, URL_BREAKDOWN, {'url': url}, page=3)

    assert (len(rows), [values[2] for _sheet, values in rows] == sorted((values[2] for _sheet, values in rows), reverse=True)) == (total, True)


def test_url_breakdown_of_a_market_keeps_only_its_keywords(tenant):
    url = _cited_url(tenant)
    market = _answer(tenant, 'get-url-breakdown.py', '/api/url-breakdown', {'url': url, 'market_id': market_id(0)})

    assert len(_rows(tenant, URL_BREAKDOWN, {'url': url, 'market_id': market_id(0)}, page=3)) == market['total_citations']


def test_searches_follow_every_page_across_engines(tenant):
    params = {'keyword_contains': keyword_text(1)[:12], 'provider': 'openai'}
    oracle = _rows(tenant, SEARCHES, params, page=500)

    assert (len(oracle) > _SHORT, _rows(tenant, SEARCHES, params)) == (True, oracle)


def test_searches_of_one_keyword_are_only_that_keywords(tenant):
    rows = _rows(tenant, SEARCHES, {'keyword': keyword_text(1)})

    assert {values[1] for _sheet, values in rows} == {keyword_text(1)}


def test_searches_resume_after_every_row_with_exactly_the_remaining_rows(tenant):
    params = {'keyword': keyword_text(1)}
    source = over_tenant(short_paged(SEARCHES, _SHORT), TenantRoutes(tenant))
    assert resumes_from_every_row(source, params, _SHORT)


def _crawls(count: int) -> list[dict[str, Any]]:
    return [
        # ``crawled_at`` is the table's sort key: one crawl per URL and instant, newest first.
        {'normalized_url': 'https://example.com/a', 'crawled_at': f'2026-11-06T09:{59 - index // 60 % 60:02}:{59 - index % 60:02}.{9999 - index:04}Z', 'status': 'success', 'metadata': {'content_length': index}}
        for index in range(count)
    ]


@pytest.mark.parametrize(('source', 'params'), [
    (SEARCHES, {}),
    (URL_BREAKDOWN, None),
])
def test_every_row_of_a_moving_list_carries_a_unique_identity(tenant, source, params):
    query = {'url': _cited_url(tenant)} if params is None else params
    rows = all_rows(over_tenant(short_paged(source, _SHORT), TenantRoutes(tenant)), query)
    identities = [json.dumps(row.cursor.get('last')) for row in rows]

    assert (len(rows) > 0, len(set(identities)), 'null' in identities) == (True, len(rows), False)


def test_crawl_history_lists_every_crawl_without_the_page_text():
    route = PagedRoute(_crawls(1_234))
    source = replace(CRAWL_HISTORY, invoker=route)

    rows = all_rows(source, {'url': 'https://example.com/a'})

    assert (len(rows), route.requests[0].query['include_content'], route.requests[0].query['include_history']) == (1_234, 'false', 'true')


def test_crawl_history_reads_the_content_length_from_the_metadata():
    source = replace(CRAWL_HISTORY, invoker=PagedRoute(_crawls(3)))

    assert [row.values[-1] for row in all_rows(source, {'url': 'https://example.com/a'})] == [0, 1, 2]


@pytest.mark.parametrize(('source', 'message'), [
    (URL_BREAKDOWN, 'The url-breakdown export needs: url'),
    (CRAWL_HISTORY, 'The crawl-history export needs: url'),
])
def test_a_one_url_export_needs_the_url(source, message):
    assert source.validate({}, USER) == message


def test_citations_take_the_views_filters():
    params = {'group_id': 'g1', 'market_id': 'es-es', 'sort': 'domain', 'order': 'asc', 'url_contains': 'x', 'min_citations': '2', 'content_type': 'video'}

    assert CITATIONS.validate(params, USER) is None
