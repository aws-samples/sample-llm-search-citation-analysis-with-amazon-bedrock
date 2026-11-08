"""Export sources S1, S3, S10, S11 (mention views) against a generated tenant: every row of the uncapped view, exact resume.

``scope=all`` and the large group are served from the snapshot (or a view
job), one keyword is read live. The oracle is the same source read with
every scope served live (one answer for the unpaged lists): snapshot and
live pages must hold the same rows, and as many as the route's total says.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared import brand_mention_views
from shared.export_source_mentions import BRAND_APPEARANCES, BRAND_MENTION_SUMMARY, PERSONA_RANKINGS, SENTIMENT_EXAMPLES
from shared.export_source_routes import RouteSource
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, all_rows, resumed_from_every_row, row_values
from testing.full_list_fixtures import TenantRoutes, oracle_values, over_tenant, short_paged
from testing.scale_data import ScaleSpec, group_id, keyword_text

SPEC = ScaleSpec()
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'one keyword': {'keyword': keyword_text(1)}}
_SHORT = 7


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


def _rows(tenant: EndToEndTenant, source: RouteSource, params: dict[str, str], *, live: bool = False) -> list[tuple[str, tuple[Any, ...]]]:
    return row_values(all_rows(over_tenant(short_paged(source, _SHORT), TenantRoutes(tenant, live=live)), params))


def _body(tenant: EndToEndTenant, query: dict[str, str]) -> dict[str, Any]:
    status, body = tenant.call('get-brand-mentions.py', '/api/brand-mentions', query)
    if status == 202:
        tenant.run_jobs()
        status, body = tenant.call('get-brand-mentions.py', '/api/brand-mentions', query)
    assert status == 200, body
    return body


@pytest.mark.parametrize('scope', ['scope=all', 'large group'])
def test_appearances_equal_the_live_list(tenant, scope):
    params = {**_SCOPES[scope], 'classification': 'first_party'}

    assert _rows(tenant, BRAND_APPEARANCES, params) == _rows(tenant, BRAND_APPEARANCES, params, live=True)


def test_appearances_hold_every_appearance_the_route_counts(tenant):
    params = {'group_id': group_id(0)}
    total = _body(tenant, {**params, 'view': 'appearances'})['total_appearances']

    assert len(_rows(tenant, BRAND_APPEARANCES, params)) == total


def test_appearances_of_one_brand_are_only_that_brands(tenant):
    brand = _body(tenant, {'group_id': group_id(0)})['aggregated']['brands'][0]['name']

    rows = _rows(tenant, BRAND_APPEARANCES, {'group_id': group_id(0), 'brand': brand})

    assert {values[0] for _sheet, values in rows} == {brand}


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_brand_summary_lists_every_brand_of_the_uncapped_summary(tenant, scope):
    routes = TenantRoutes(tenant, live=True, patches=((brand_mention_views, {'BRAND_LIMIT': 10**9}),))
    oracle = oracle_values(routes, BRAND_MENTION_SUMMARY.lists[0], _SCOPES[scope])

    assert row_values(all_rows(over_tenant(BRAND_MENTION_SUMMARY, TenantRoutes(tenant)), _SCOPES[scope])) == oracle


def test_the_scope_all_brand_list_is_longer_than_one_summary_page(tenant):
    assert _body(tenant, {'scope': 'all'})['aggregated']['brands_total'] > brand_mention_views.BRAND_LIMIT


@pytest.mark.parametrize('scope', ['scope=all', 'large group'])
def test_sentiment_examples_equal_the_live_list(tenant, scope):
    params = {**_SCOPES[scope], 'sentiment': 'positive'}

    assert _rows(tenant, SENTIMENT_EXAMPLES, params) == _rows(tenant, SENTIMENT_EXAMPLES, params, live=True)


def test_sentiment_examples_hold_every_example_the_route_counts(tenant):
    params = {'group_id': group_id(0), 'sentiment': 'negative', 'classification': 'competitor'}
    status, body = tenant.call('get-sentiment-examples.py', '/api/visibility/sentiment-examples', params)

    assert (status, len(_rows(tenant, SENTIMENT_EXAMPLES, params))) == (200, body['total'])


def test_persona_rankings_hold_every_persona_brand_and_the_summary(tenant):
    params = {'keyword': keyword_text(1)}
    routes = TenantRoutes(tenant, live=True)
    oracle = [row for route_list in PERSONA_RANKINGS.lists for row in oracle_values(routes, route_list, params)]

    assert _rows(tenant, PERSONA_RANKINGS, params) == oracle


def test_persona_rankings_list_brands_of_every_persona(tenant):
    personas = {values[0] for sheet, values in _rows(tenant, PERSONA_RANKINGS, {'keyword': keyword_text(1)}) if sheet == 'Personas'}

    assert len(personas) == SPEC.personas


#: Each source's resume params: lists of a few dozen rows (every row is resumed from).
_RESUME = {
    'brand-appearances': {'group_id': group_id(0), 'classification': 'first_party'},
    'brand-mention-summary': {'group_id': group_id(0)},
    'sentiment-examples': {'group_id': group_id(0), 'sentiment': 'mixed', 'classification': 'first_party'},
}


@pytest.mark.parametrize('source', [BRAND_APPEARANCES, BRAND_MENTION_SUMMARY, SENTIMENT_EXAMPLES], ids=lambda source: source.view)
def test_resuming_after_every_row_yields_exactly_the_remaining_rows(tenant, source):
    params = _RESUME[source.view]
    paged = over_tenant(short_paged(source, _SHORT), TenantRoutes(tenant))
    rows = all_rows(paged, params)

    resumed = {index: row_values(rest) for index, rest in resumed_from_every_row(paged, params, rows)}

    assert (len(rows) > _SHORT, resumed) == (True, {index: row_values(rows[index + 1:]) for index in range(len(rows))})


def test_sentiment_examples_need_a_sentiment():
    assert SENTIMENT_EXAMPLES.validate({'scope': 'all'}, USER) == 'The sentiment-examples export needs: sentiment'


def test_persona_rankings_need_a_keyword():
    assert PERSONA_RANKINGS.validate({'query_prompt_id': 'p1'}, USER) == 'The persona-rankings export needs: keyword'


def test_brand_exports_take_the_brands_view_filters():
    params = {'group_id': 'g1', 'market_id': 'es-es', 'timestamp': 't', 'classification': 'competitor', 'query_prompt_id': 'p1', 'brand': 'Hotel'}

    assert BRAND_APPEARANCES.validate(params, USER) is None
