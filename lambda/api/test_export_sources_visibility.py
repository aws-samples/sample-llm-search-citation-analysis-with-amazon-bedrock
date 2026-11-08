"""Export sources S2, S5, S6, S9 (Visibility) against a generated tenant: every row of the uncapped view, exact resume.

The tenant's ``scope=all``, large group and markets are served from the
snapshot; one keyword is read live. The oracle is one live answer of the
same route with every list in one page (``LIST_PAGE`` raised).
"""

from __future__ import annotations

import pytest

from shared import artifact_latest
from shared.export_source_routes import RouteSource
from shared.export_source_visibility import BRAND_LEADERBOARD, ENGINES, KEYWORD_VISIBILITY, SOURCES
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
_SOURCES = {source.view: source for source in (BRAND_LEADERBOARD, SOURCES, KEYWORD_VISIBILITY, ENGINES)}
_UNCAPPED = ((artifact_latest, {'LIST_PAGE': 10**9}),)
#: Pages short enough that every list here takes several (the cursor crosses pages).
_SHORT_PAGES = ((artifact_latest, {'LIST_PAGE': 17, 'KEYWORDS_PAGE': 7}),)


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

    rows = all_rows(source, _SCOPES[scope])

    assert row_values(rows) == _oracle(tenant, _SOURCES[view], _SCOPES[scope])


@pytest.mark.parametrize('view', ['brand-leaderboard', 'sources', 'keyword-visibility'])
def test_the_scope_all_list_is_longer_than_a_short_page(tenant, view):
    assert len(_oracle(tenant, _SOURCES[view], {'scope': 'all'})) > 2 * 17


def test_the_brand_filter_and_persona_narrow_the_leaderboard(tenant):
    params = {'scope': 'all', 'brand': 'hotel', 'query_prompt_id': 'persona-01'}
    source = over_tenant(BRAND_LEADERBOARD, TenantRoutes(tenant, patches=_SHORT_PAGES))

    assert row_values(all_rows(source, params)) == _oracle(tenant, BRAND_LEADERBOARD, params)


#: The resume test's params: a long tail cut to about fifty brands keeps it fast (every row is resumed from).
_RESUME_PARAMS = {'brand-leaderboard': {'group_id': group_id(0), 'brand': 'Hostal 001'}}
#: Rows each resumed export holds at least: past one short page where the list is paged, every engine where it is one answer.
_RESUME_ROWS = {'brand-leaderboard': 17, 'sources': 17, 'keyword-visibility': 7, 'engines': 3}


@pytest.mark.parametrize('view', list(_SOURCES))
def test_resuming_after_every_row_yields_exactly_the_remaining_rows(tenant, view):
    source = over_tenant(_SOURCES[view], TenantRoutes(tenant, patches=_SHORT_PAGES))
    params = _RESUME_PARAMS.get(view, {'group_id': group_id(0)})
    rows = all_rows(source, params)

    resumed = {index: row_values(rest) for index, rest in resumed_from_every_row(source, params, rows)}

    assert (len(rows) > _RESUME_ROWS[view], resumed) == (True, {index: row_values(rows[index + 1:]) for index in range(len(rows))})


@pytest.mark.parametrize('view', list(_SOURCES))
def test_validate_accepts_the_views_scope_params(view):
    assert _SOURCES[view].validate({'scope': 'all', 'market_id': 'es-es', 'query_prompt_id': 'p1'}, USER) is None
