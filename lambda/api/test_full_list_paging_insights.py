"""``GET /api/reports/insights`` full lists (2.45.0 wave 5): every owned page, prompt-by-engine keyword and competitor caveat reason, paged.

The answer lists the first rows of each list (``shared.insights_pages``,
shortened here so the tenant's lists take several pages) with
``<list>_next_token``; ``view=owned_pages`` / ``view=prompt_engine`` pages the
rest (``view=caveat_reasons``: the answer lists no reason, the pages every one). The oracle is the live view with one page as long as the list.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import Any

import pytest

from shared import insights_pages
from shared.export_source_reports import REPORT_INSIGHTS
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, all_rows, resumes_from_every_row, row_values
from testing.full_list_fixtures import (
    TenantRoutes,
    answered_page,
    drain,
    oracle_values,
    over_tenant,
    patched,
    without_build,
)
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-reports-insights.py', '/api/reports/insights'
_SCOPES = {
    'scope=all': {'scope': 'all'},
    'large group': {'group_id': group_id(0)},
    'market': {'market_id': market_id(0)},
    'one keyword': {'keyword': keyword_text(1)},
}
_LISTS = {'owned_pages': ('owned_pages', 'pages'), 'prompt_engine': ('prompt_engine', 'keywords'), 'caveat_reasons': ('caveat_reasons', 'reasons')}
_SHORT = {
    'PAGED_FACTS': {
        'owned_pages': ('owned_pages', 'pages', 1), 'prompt_engine': ('prompt_engine', 'keywords', 4), 'caveat_reasons': ('caveat_reasons', 'reasons', 0),
    },
    'FACTS_PAGE': 5,
}


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


_ask = partial(answered_page, handler=_HANDLER, path=_PATH)


def _whole(tenant: EndToEndTenant, scope: Mapping[str, str], view: str) -> list[Any]:
    fact, items = _LISTS[view]
    with patched(insights_pages, FACTS_PAGE=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'view': view})
    assert (status, body['facts'][fact]['next_token']) == (200, None)
    return body['facts'][fact][items]


def _paged(tenant: EndToEndTenant, scope: Mapping[str, str], view: str) -> list[Any]:
    fact, items = _LISTS[view]
    with patched(insights_pages, **_SHORT):
        first = _ask(tenant, scope)['facts'][fact]
        token = first[f'{items}_next_token']
        rest = drain(lambda following: _ask(tenant, {**scope, 'view': view}, following or token)['facts'][fact], items) if token else []
    return first[items] + rest


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize('view', list(_LISTS))
def test_the_first_rows_then_their_token_reach_the_whole_list(tenant, scope, view):
    assert _paged(tenant, _SCOPES[scope], view) == _whole(tenant, _SCOPES[scope], view)


@pytest.mark.parametrize(('view', 'past'), [('owned_pages', 1), ('prompt_engine', 4 + 2 * 5)])
def test_the_scope_all_list_is_longer_than_the_short_first_rows_and_pages(tenant, view, past):
    assert len(_whole(tenant, {'scope': 'all'}, view)) > past


def test_a_view_job_answer_token_pages_the_rest_of_its_list(tenant):
    with without_build(tenant):
        rows = _paged(tenant, {'scope': 'all'}, 'prompt_engine')

    assert rows == _whole(tenant, {'scope': 'all'}, 'prompt_engine')


def test_the_answer_keeps_todays_first_fifty_keywords_and_counts_the_rest(tenant):
    facts = _ask(tenant, {'scope': 'all'})['facts']['prompt_engine']
    whole = _whole(tenant, {'scope': 'all'}, 'prompt_engine')

    assert (facts['keywords'], facts['omitted'], facts['keywords_total']) == (whole[:50], max(len(whole) - 50, 0), len(whole))


# --- the export source ---------------------------------------------------------------

_UNCAPPED = ((insights_pages, {'FACTS_PAGE': 10**9}),)
_SHORT_PAGES = ((insights_pages, {'FACTS_PAGE': 5}),)


def _oracle(tenant: EndToEndTenant, params: dict[str, str]) -> list[tuple[str, tuple]]:
    routes = TenantRoutes(tenant, live=True, patches=_UNCAPPED)
    return [row for route_list in REPORT_INSIGHTS.lists for row in oracle_values(routes, route_list, params)]


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_source_rows_equal_the_uncapped_facts(tenant, scope):
    source = over_tenant(REPORT_INSIGHTS, TenantRoutes(tenant, patches=_SHORT_PAGES))

    assert row_values(all_rows(source, _SCOPES[scope])) == _oracle(tenant, _SCOPES[scope])


def test_the_source_resumes_after_every_row_with_exactly_the_remaining_rows(tenant):
    params = {'group_id': group_id(0)}
    source = over_tenant(REPORT_INSIGHTS, TenantRoutes(tenant, patches=_SHORT_PAGES))
    assert resumes_from_every_row(source, params)


def test_the_source_takes_the_views_scope_and_days():
    assert REPORT_INSIGHTS.validate({'group_id': 'g1', 'market_id': 'es-es', 'days': '30'}, USER) is None
