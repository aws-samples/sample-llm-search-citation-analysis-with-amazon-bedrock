"""``GET /api/visibility`` full lists (2.45.0 wave 5): ``view=brands`` and ``view=sources`` page the whole leaderboard and source table.

The oracle is the same route read live with one page as long as the list
(``LIST_PAGE`` raised): the uncapped list. Served from the snapshot and live,
the pages concatenate to it, and the body's own first page is unchanged.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from shared import artifact_latest
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.full_list_fixtures import drain, patched, without_build
from testing.scale_data import ScaleSpec, group_id, keyword_text

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-visibility-metrics.py', '/api/visibility'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'one keyword': {'keyword': keyword_text(1)}}
_LISTS = (('brands', 'brands_next_token'), ('sources', 'sources_next_token'))
_FIRST_PAGE = {'brands': 100, 'sources': 25}
#: A page short enough that every list here takes several.
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


def _uncapped(tenant: EndToEndTenant, scope: Mapping[str, str], items: str) -> list[Any]:
    with patched(artifact_latest, LIST_PAGE=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'view': items})
    assert (status, body['next_token']) == (200, None)
    return body[items]


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize(('items', 'first_token'), _LISTS)
def test_view_pages_concatenate_to_the_whole_list(tenant, scope, items, first_token):
    query = {**_SCOPES[scope], 'view': items}

    with patched(artifact_latest, LIST_PAGE=_SMALL_PAGE):
        pages = drain(lambda token: _ask(tenant, query, token), items)

    assert pages == _uncapped(tenant, _SCOPES[scope], items)


@pytest.mark.parametrize(('items', 'first_token'), _LISTS)
def test_the_list_is_longer_than_the_body_page_so_the_cursor_is_exercised(tenant, items, first_token):
    assert len(_uncapped(tenant, {'scope': 'all'}, items)) > max(_FIRST_PAGE[items], 2 * _SMALL_PAGE)


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize(('items', 'first_token'), _LISTS)
def test_the_body_first_page_then_its_token_reach_the_whole_list(tenant, scope, items, first_token):
    first = _ask(tenant, _SCOPES[scope])
    query = {**_SCOPES[scope], 'view': items}
    token = first[first_token]

    rest = drain(lambda following: _ask(tenant, query, following or token), items) if token else []

    assert first[items][:_FIRST_PAGE[items]] + rest == _uncapped(tenant, _SCOPES[scope], items)


def test_the_body_keeps_todays_first_brand_page(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['brands'][:100] == _uncapped(tenant, {'scope': 'all'}, 'brands')[:100]


def test_the_body_keeps_todays_first_25_sources(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['sources'] == _uncapped(tenant, {'scope': 'all'}, 'sources')[:25]


def test_a_brand_filter_narrows_every_page(tenant):
    query = {'scope': 'all', 'view': 'brands', 'brand': 'a'}

    pages = drain(lambda token: _ask(tenant, query, token), 'brands')

    assert pages == [row for row in _uncapped(tenant, {'scope': 'all'}, 'brands') if 'a' in row['name'].lower()]


def test_a_snapshot_token_on_a_live_scope_is_cursor_expired(tenant):
    token = _ask(tenant, {'scope': 'all'})['brands_next_token']

    status, body = tenant.call(_HANDLER, _PATH, {'keyword': keyword_text(1), 'view': 'brands', 'next_token': token})

    assert (status, body['code']) == (400, 'cursor_expired')


def test_a_view_job_body_token_pages_the_rest_of_its_artifacts(tenant):
    with without_build(tenant):
        first = _ask(tenant, {'scope': 'all'})
        rest = drain(lambda following: _ask(tenant, {'scope': 'all', 'view': 'brands'}, following or first['brands_next_token']), 'brands')

    assert first['brands'][:_FIRST_PAGE['brands']] + rest == _uncapped(tenant, {'scope': 'all'}, 'brands')
