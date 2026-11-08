"""``GET /api/trends`` full lists (2.45.0 wave 5): ``latest_brands`` pages the whole leaderboard; ``top_movers`` ranks every keyword.

The oracle is the same route read live with the body cut and the page
raised past the list (``LATEST_BRANDS_LIMIT`` / ``LIST_PAGE``): the uncapped
leaderboard, with every brand of every run (KeywordRunBrands). Served from
the snapshot and live, the body's first rows and its token reach it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from shared import artifact_latest, artifact_trends
from shared.artifact_trends import TOP_MOVERS, top_movers
from shared.keyword_run_kpis import BRANDS_PER_RUN
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.full_list_fixtures import drain, patched, without_build
from testing.scale_data import ScaleSpec, group_id, keyword_text

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-historical-trends.py', '/api/trends'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'one keyword': {'keyword': keyword_text(1)}}
_FIRST = artifact_trends.LATEST_BRANDS_LIMIT
_SMALL_PAGE = 17


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


def _ask(tenant: EndToEndTenant, query: Mapping[str, str], token: str | None = None) -> dict[str, Any]:
    status, body = tenant.call(_HANDLER, _PATH, {**query, **({'next_token': token} if token else {})})
    if status == 202:
        tenant.run_jobs()
        status, body = tenant.call(_HANDLER, _PATH, {**query, **({'next_token': token} if token else {})})
    assert status == 200, body
    return body


def _uncapped(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    with patched(artifact_trends, LATEST_BRANDS_LIMIT=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, dict(scope))
    assert (status, body['latest_brands_next_token']) == (200, None)
    return body['latest_brands']


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_body_first_brands_then_its_token_reach_the_whole_leaderboard(tenant, scope):
    first = _ask(tenant, _SCOPES[scope])
    query = {**_SCOPES[scope], 'view': 'latest_brands'}
    token = first['latest_brands_next_token']

    with patched(artifact_latest, LIST_PAGE=_SMALL_PAGE):
        rest = drain(lambda following: _ask(tenant, query, following or token), 'latest_brands') if token else []

    assert first['latest_brands'] + rest == _uncapped(tenant, _SCOPES[scope])


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_body_counts_every_brand_of_the_leaderboard(tenant, scope):
    body = _ask(tenant, _SCOPES[scope])

    assert body['latest_brands_total'] == len(_uncapped(tenant, _SCOPES[scope]))


def test_the_leaderboard_is_longer_than_a_run_rollup_keeps(tenant):
    assert len(_uncapped(tenant, {'scope': 'all'})) > max(BRANDS_PER_RUN, _FIRST, 2 * _SMALL_PAGE)


def test_the_body_keeps_todays_first_ten_brands(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['latest_brands'] == _uncapped(tenant, {'scope': 'all'})[:_FIRST]


@pytest.mark.parametrize('scope', ['scope=all', 'large group'])
def test_top_movers_rank_every_keyword_trend_of_the_scope(tenant, scope):
    body = _ask(tenant, _SCOPES[scope])
    rows = drain(lambda token: _ask(tenant, {**_SCOPES[scope], 'view': 'keyword_trends'}, token), 'keyword_trends')
    improving, declining = top_movers(rows, TOP_MOVERS)

    assert body['top_movers'] == {'improving': improving, 'declining': declining}


def test_a_view_job_body_token_pages_the_rest_of_its_artifacts(tenant):
    with without_build(tenant):
        first = _ask(tenant, {'scope': 'all'})
        rest = drain(lambda following: _ask(tenant, {'scope': 'all', 'view': 'latest_brands'}, following or first['latest_brands_next_token']), 'latest_brands')

    assert first['latest_brands'] + rest == _uncapped(tenant, {'scope': 'all'})


def _live_series(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    with patched(artifact_latest, LIST_PAGE=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'view': 'brand_series'})
    assert (status, body['next_token']) == (200, None)
    return body['brand_series']


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_brand_series_pages_concatenate_to_every_brand_of_the_window(tenant, scope):
    query = {**_SCOPES[scope], 'view': 'brand_series'}

    with patched(artifact_latest, LIST_PAGE=_SMALL_PAGE):
        pages = drain(lambda token: _ask(tenant, query, token), 'brand_series')

    assert pages == _live_series(tenant, _SCOPES[scope])


def test_brand_series_lists_more_brands_than_the_chart_follows(tenant):
    assert len(_live_series(tenant, {'scope': 'all'})) > 2 * _SMALL_PAGE


def test_brand_series_holds_the_charted_competitors_points_where_they_are_named(tenant):
    body = _ask(tenant, {'scope': 'all'})
    series = {row['name']: row['points'] for row in _live_series(tenant, {'scope': 'all'})}
    charted = {row['name']: [point for point in row['points'] if point['mention_rate']] for row in body['brand_trends']['competitors']}

    assert {name: [point for point in series[name] if point['mention_rate']] for name in charted} == charted
