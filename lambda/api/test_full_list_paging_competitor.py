"""``GET /api/reports/competitor`` outreach targets (2.45.0 wave 5) and the ``competitor-gap`` export source.

The rollup lists a competitor's ten best exclusive sources first;
``view=outreach`` pages every one. The oracle is the live route with one
page as long as the list.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import Any

import pytest

from shared import action_list_builders
from shared.export_source_actions import COMPETITOR_GAP
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, all_rows, resumes_from_every_row, row_values
from testing.full_list_fixtures import (
    TenantRoutes,
    answered_page,
    drain,
    oracle_values,
    over_tenant,
    patched,
    short_paged,
    without_build,
)
from testing.scale_data import ScaleSpec, group_id, market_id

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-reports-competitor.py', '/api/reports/competitor'
_COMPETITOR = 'Meliá Galicia'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'market': {'market_id': market_id(0)}}
_SMALL_PAGE = 7


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


_ask = partial(answered_page, handler=_HANDLER, path=_PATH)


def _every_source(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    with patched(action_list_builders, OUTREACH_PAGE=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'competitor': _COMPETITOR, 'view': 'outreach'})
    assert (status, body['next_token']) == (200, None)
    return body['rollup']['outreach_targets']


def _paged_sources(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    query = {**scope, 'competitor': _COMPETITOR}
    first = _ask(tenant, query)['rollup']
    token = first['outreach_targets_next_token']
    with patched(action_list_builders, OUTREACH_PAGE=_SMALL_PAGE):
        rest = drain(lambda following: _ask(tenant, {**query, 'view': 'outreach'}, following or token)['rollup'], 'outreach_targets') if token else []
    return first['outreach_targets'] + rest


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_first_targets_then_their_token_reach_every_exclusive_source(tenant, scope):
    assert _paged_sources(tenant, _SCOPES[scope]) == _every_source(tenant, _SCOPES[scope])


def test_the_competitor_has_more_exclusive_sources_than_the_answer_lists_first(tenant):
    assert len(_every_source(tenant, {'scope': 'all'})) > 10 + 2 * _SMALL_PAGE


def test_outreach_targets_total_counts_every_exclusive_source(tenant):
    rollup = _ask(tenant, {'scope': 'all', 'competitor': _COMPETITOR})['rollup']

    assert (rollup['outreach_targets_total'], rollup['exclusive_source_count']) == (len(_every_source(tenant, {'scope': 'all'})),) * 2


def test_a_view_job_answer_token_pages_the_rest_of_its_sources(tenant):
    with without_build(tenant):
        sources = _paged_sources(tenant, {'scope': 'all'})

    assert sources == _every_source(tenant, {'scope': 'all'})


def test_view_outreach_without_a_competitor_is_a_400(tenant):
    status, body = tenant.call(_HANDLER, _PATH, {'scope': 'all', 'view': 'outreach'})

    assert (status, body['field']) == (400, 'competitor')


# --- the export source ---------------------------------------------------------------

_UNCAPPED = ((action_list_builders, {'OUTREACH_PAGE': 10**9}),)
_SHORT = ((action_list_builders, {'OUTREACH_PAGE': _SMALL_PAGE}),)


def _oracle(tenant: EndToEndTenant, params: dict[str, str]) -> list[tuple[str, tuple]]:
    routes = TenantRoutes(tenant, live=True, patches=_UNCAPPED)
    return [row for route_list in COMPETITOR_GAP.lists for row in oracle_values(routes, route_list, {**params, 'limit': '100'})]


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_source_rows_equal_the_uncapped_view(tenant, scope):
    params = {**_SCOPES[scope], 'competitor': _COMPETITOR}
    source = over_tenant(short_paged(COMPETITOR_GAP, 1), TenantRoutes(tenant, patches=_SHORT))

    assert row_values(all_rows(source, params)) == _oracle(tenant, params)


def test_the_source_resumes_after_every_row_with_exactly_the_remaining_rows(tenant):
    params = {'group_id': group_id(0), 'competitor': _COMPETITOR}
    source = over_tenant(short_paged(COMPETITOR_GAP, 1), TenantRoutes(tenant, patches=_SHORT))
    assert resumes_from_every_row(source, params)


def test_the_source_needs_a_competitor():
    assert COMPETITOR_GAP.validate({'scope': 'all'}, USER) == 'The competitor-gap export needs: competitor'
