"""Export sources S17, S18, S19 (action views) against a generated tenant: every row of the uncapped view, exact resume.

The oracle is one live answer of the route with ``limit`` past the list; the
sources page with 7 items a page so the cursor crosses pages.
"""

from __future__ import annotations

import pytest

from shared import action_list_builders
from shared.export_source_actions import CITATION_GAPS, GAP_KEYWORD_SUMMARIES, PROMPT_INSIGHTS, RECOMMENDATIONS
from shared.export_source_routes import RouteSource
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, all_rows, resumes_from_every_row, row_values
from testing.full_list_fixtures import TenantRoutes, oracle_values, over_tenant, short_paged
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_SCOPES = {
    'scope=all': {'scope': 'all'},
    'large group': {'group_id': group_id(0)},
    'market': {'market_id': market_id(0)},
    'one keyword': {'keyword': keyword_text(17)},
}
_SOURCES = {source.view: source for source in (PROMPT_INSIGHTS, RECOMMENDATIONS, GAP_KEYWORD_SUMMARIES, CITATION_GAPS)}
_UNCAPPED = ((action_list_builders, {'GAPS_PAGE': 10**9}),)
_SHORT_PAGES = ((action_list_builders, {'GAPS_PAGE': 7}),)
_WHOLE = {'limit': '100'}
_PAGE = 7


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


def _oracle(tenant: EndToEndTenant, source: RouteSource, params: dict[str, str]) -> list[tuple[str, tuple]]:
    routes = TenantRoutes(tenant, live=True, patches=_UNCAPPED)
    return [row for route_list in source.lists for row in oracle_values(routes, route_list, {**params, **_WHOLE})]


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize('view', list(_SOURCES))
def test_rows_equal_the_uncapped_view(tenant, view, scope):
    source = over_tenant(short_paged(_SOURCES[view], _PAGE), TenantRoutes(tenant, patches=_SHORT_PAGES))

    assert row_values(all_rows(source, _SCOPES[scope])) == _oracle(tenant, _SOURCES[view], _SCOPES[scope])


@pytest.mark.parametrize('view', ['prompt-insights', 'gap-keyword-summaries', 'citation-gaps'])
def test_the_scope_all_list_is_longer_than_a_short_page(tenant, view):
    assert len(_oracle(tenant, _SOURCES[view], {'scope': 'all'})) > 3 * _PAGE


@pytest.mark.parametrize('view', list(_SOURCES))
def test_resuming_after_every_row_yields_exactly_the_remaining_rows(tenant, view):
    source = over_tenant(short_paged(_SOURCES[view], _PAGE), TenantRoutes(tenant, patches=_SHORT_PAGES))
    params = {'group_id': group_id(0)}
    assert resumes_from_every_row(source, params)


def test_prompt_insights_writes_one_sheet_per_tab():
    assert [sheet.name for sheet in PROMPT_INSIGHTS.sheets] == ['Winning', 'Losing', 'Opportunities']


def test_recommendations_refuse_use_llm():
    assert RECOMMENDATIONS.validate({'scope': 'all', 'use_llm': 'true'}, USER) == 'Unknown parameter for the recommendations export: use_llm'


@pytest.mark.parametrize('view', list(_SOURCES))
def test_validate_accepts_the_views_scope_params(view):
    assert _SOURCES[view].validate({'group_id': 'g1', 'market_id': 'es-es'}, USER) is None
