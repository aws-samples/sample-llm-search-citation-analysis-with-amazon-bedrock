"""Export sources S4, S7, S8 (trends) against a generated tenant: every row of the uncapped view, exact resume.

The oracle is one live answer of ``/api/trends`` with every list in one page
(``LIST_PAGE`` and ``KEYWORD_TRENDS_PAGE`` raised).
"""

from __future__ import annotations

import pytest

from shared import artifact_latest, artifact_trends
from shared.export_source_routes import RouteSource
from shared.export_source_trends import BRAND_TRENDS, KEYWORD_TRENDS, TREND_PERIODS
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, all_rows, resumed_from_every_row, row_values
from testing.full_list_fixtures import TenantRoutes, oracle_values, over_tenant
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_SCOPES = {
    'scope=all': {'scope': 'all'},
    'large group': {'group_id': group_id(0)},
    'market': {'market_id': market_id(0)},
    'one keyword': {'keyword': keyword_text(1)},
}
_SOURCES = {source.view: source for source in (TREND_PERIODS, KEYWORD_TRENDS, BRAND_TRENDS)}
_UNCAPPED = ((artifact_latest, {'LIST_PAGE': 10**9}), (artifact_trends, {'KEYWORD_TRENDS_PAGE': 10**9}))
_SHORT_PAGES = ((artifact_latest, {'LIST_PAGE': 17}), (artifact_trends, {'KEYWORD_TRENDS_PAGE': 7}))


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


def _oracle(tenant: EndToEndTenant, source: RouteSource, params: dict[str, str]) -> list[tuple[str, tuple]]:
    routes = TenantRoutes(tenant, live=True, patches=_UNCAPPED)
    return [row for route_list in source.lists for row in oracle_values(routes, route_list, params)]


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize('view', list(_SOURCES))
def test_rows_equal_the_uncapped_view(tenant, view, scope):
    source = over_tenant(_SOURCES[view], TenantRoutes(tenant, patches=_SHORT_PAGES))

    assert row_values(all_rows(source, _SCOPES[scope])) == _oracle(tenant, _SOURCES[view], _SCOPES[scope])


@pytest.mark.parametrize('view', ['keyword-trends', 'brand-trends'])
def test_the_scope_all_list_is_longer_than_a_short_page(tenant, view):
    assert len(_oracle(tenant, _SOURCES[view], {'scope': 'all'})) > 2 * 17


def test_the_window_params_reach_the_route(tenant):
    params = {'scope': 'all', 'period': 'week', 'days': '7'}
    source = over_tenant(TREND_PERIODS, TenantRoutes(tenant, patches=_SHORT_PAGES))

    assert row_values(all_rows(source, params)) == _oracle(tenant, TREND_PERIODS, params)


@pytest.mark.parametrize('view', list(_SOURCES))
def test_resuming_after_every_row_yields_exactly_the_remaining_rows(tenant, view):
    source = over_tenant(_SOURCES[view], TenantRoutes(tenant, patches=_SHORT_PAGES))
    params = {'group_id': group_id(1), 'days': '7'}
    rows = all_rows(source, params)

    resumed = {index: row_values(rest) for index, rest in resumed_from_every_row(source, params, rows)}

    assert resumed == {index: row_values(rows[index + 1:]) for index in range(len(rows))}


@pytest.mark.parametrize('view', list(_SOURCES))
def test_validate_accepts_the_views_scope_and_window_params(view):
    assert _SOURCES[view].validate({'scope': 'all', 'market_id': 'es-es', 'period': 'week', 'days': '90'}, USER) is None


def test_validate_rejects_a_param_the_route_does_not_take():
    assert TREND_PERIODS.validate({'scope': 'all', 'query_prompt_id': 'p1'}, USER) == 'Unknown parameter for the trend-periods export: query_prompt_id'
