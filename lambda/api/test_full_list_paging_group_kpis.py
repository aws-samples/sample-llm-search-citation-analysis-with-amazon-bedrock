"""``GET /api/reports/group-kpis`` (2.45.0 wave 5): ``view=runs`` pages every run of the window; the ``group-kpis`` export source.

The runs oracle is the live summary with the page budget raised past the
window; the export's oracle is one live answer of each view with every list
in one page.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import Any

import pytest

from shared import artifact_group_kpis
from shared.export_source_reports import GROUP_KPIS
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
)
from testing.scale_data import ScaleSpec, group_id, market_id

SPEC = ScaleSpec(runs=6)
_HANDLER, _PATH = 'get-group-kpi-history.py', '/api/reports/group-kpis'
_SCOPES = {'large group': {'group_id': group_id(0)}, 'scope=all': {'scope': 'all'}, 'market': {'market_id': market_id(0)}}
#: About two runs a page.
_SMALL_BYTES = 3_000


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


_ask = partial(answered_page, handler=_HANDLER, path=_PATH)


def _every_run(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'days': '30'})
    assert (status, body['runs_truncated']) == (200, False)
    return body['runs']


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_run_pages_concatenate_to_every_run_of_the_window_oldest_first(tenant, scope):
    with patched(artifact_group_kpis, RUNS_PAGE_BYTES=_SMALL_BYTES):
        pages = drain(lambda token: _ask(tenant, {**_SCOPES[scope], 'days': '30', 'view': 'runs'}, token), 'runs')

    assert pages == _every_run(tenant, _SCOPES[scope])


def test_the_window_has_more_runs_than_a_small_page(tenant):
    with patched(artifact_group_kpis, RUNS_PAGE_BYTES=_SMALL_BYTES):
        first = _ask(tenant, {'group_id': group_id(0), 'days': '30', 'view': 'runs'})

    assert (len(first['runs']) < len(_every_run(tenant, {'group_id': group_id(0)})), first['next_token'] is not None) == (True, True)


def test_the_summary_counts_every_run_of_the_window(tenant):
    body = _ask(tenant, {'group_id': group_id(0), 'days': '30'})

    assert body['runs_total'] == len(_every_run(tenant, {'group_id': group_id(0)}))


def test_a_malformed_runs_token_is_a_400(tenant):
    status, body = tenant.call(_HANDLER, _PATH, {'group_id': group_id(0), 'view': 'runs', 'next_token': 'nope'})

    assert (status, body['field']) == (400, 'next_token')


# --- the export source ---------------------------------------------------------------

_UNCAPPED = ((artifact_group_kpis, {'RUNS_PAGE_BYTES': 10**9}),)
_SHORT = ((artifact_group_kpis, {'RUNS_PAGE_BYTES': _SMALL_BYTES}),)


def _oracle(tenant: EndToEndTenant, params: dict[str, str]) -> list[tuple[str, tuple]]:
    routes = TenantRoutes(tenant, live=True, patches=_UNCAPPED)
    whole = {'Keyword runs': {'limit': '25'}}
    rows = []
    for route_list in GROUP_KPIS.lists:
        rows.extend(oracle_values(routes, route_list, {**params, **whole.get(route_list.sheet, {})}))
    return rows


@pytest.mark.parametrize('scope', ['large group', 'market'])
def test_the_source_rows_equal_the_uncapped_views(tenant, scope):
    params = {**_SCOPES[scope], 'days': '30'}
    source = over_tenant(GROUP_KPIS, TenantRoutes(tenant, patches=_SHORT))

    assert row_values(all_rows(source, params)) == _oracle(tenant, params)


def test_the_source_resumes_after_every_row_with_exactly_the_remaining_rows(tenant):
    params = {'group_id': group_id(1), 'days': '7'}
    source = over_tenant(short_paged(GROUP_KPIS, 3), TenantRoutes(tenant, patches=_SHORT))
    assert resumes_from_every_row(source, params)


def test_the_source_takes_the_views_scope_and_days():
    assert GROUP_KPIS.validate({'group_id': 'g1', 'market_id': 'es-es', 'days': '90'}, USER) is None
