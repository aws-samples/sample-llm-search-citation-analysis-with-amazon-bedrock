"""``GET /api/brand-mentions`` full brand list (2.45.0 wave 5): ``view=brands`` pages every brand after the summary's first ``BRAND_LIMIT``.

The oracle is the route read live with ``BRAND_LIMIT`` raised: the summary
then lists every brand. Served from the snapshot, from a view job and live,
the summary's first page and the ``view=brands`` pages concatenate to it.
Previews (``appearances``) are compared too.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import Any

import pytest

from shared import artifact_mentions, brand_mention_views
from shared.kpi_scope_serve import LIVE_BUILD_ID
from shared.snapshot_artifacts import encode_snapshot_cursor
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.full_list_fixtures import answered_page, drain, patched, without_build
from testing.scale_data import ScaleSpec, group_id, keyword_text

SPEC = ScaleSpec()
_LIMIT = brand_mention_views.BRAND_LIMIT
_HANDLER, _PATH = 'get-brand-mentions.py', '/api/brand-mentions'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'one keyword': {'keyword': keyword_text(1)}}


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


_ask = partial(answered_page, handler=_HANDLER, path=_PATH)


def _uncapped(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    with patched(brand_mention_views, BRAND_LIMIT=10**9), patched(artifact_mentions, BRAND_LIMIT=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, dict(scope))
    assert (status, body['aggregated']['brands_next_token']) == (200, None)
    return body['aggregated']['brands']


def _every_brand(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    """The summary's brands, then every ``view=brands`` page its token leads to."""
    first = _ask(tenant, scope)['aggregated']
    token = first['brands_next_token']
    query = {**scope, 'view': 'brands'}
    rest = drain(lambda following: _ask(tenant, query, following or token)['aggregated'], 'brands') if token else []
    return first['brands'] + rest


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_the_summary_then_its_brand_pages_reach_every_brand(tenant, scope):
    assert _every_brand(tenant, _SCOPES[scope]) == _uncapped(tenant, _SCOPES[scope])


def test_the_brand_list_is_longer_than_several_pages_so_the_cursor_is_exercised(tenant):
    assert len(_uncapped(tenant, {'scope': 'all'})) > 2 * _LIMIT


def test_the_summary_reports_every_matching_brand_as_brands_total(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['aggregated']['brands_total'] == len(_uncapped(tenant, {'scope': 'all'}))


def test_the_summary_keeps_todays_first_brand_page(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['aggregated']['brands'] == _uncapped(tenant, {'scope': 'all'})[:_LIMIT]


def test_a_view_brands_request_without_a_token_answers_the_first_page(tenant):
    page = _ask(tenant, {'scope': 'all', 'view': 'brands'})['aggregated']

    assert page['brands'] == _uncapped(tenant, {'scope': 'all'})[:_LIMIT]


def test_a_classification_filter_narrows_every_page(tenant):
    query = {'scope': 'all', 'classification': 'competitor'}

    assert _every_brand(tenant, query) == [row for row in _uncapped(tenant, {'scope': 'all'}) if row['classification'] == 'competitor']


def test_a_view_job_summary_token_pages_the_rest_of_its_build(tenant):
    with without_build(tenant):
        brands = _every_brand(tenant, {'scope': 'all'})

    assert brands == _uncapped(tenant, {'scope': 'all'})


def test_a_snapshot_token_on_a_live_keyword_is_cursor_expired(tenant):
    token = _ask(tenant, {'scope': 'all'})['aggregated']['brands_next_token']

    status, body = tenant.call(_HANDLER, _PATH, {'keyword': keyword_text(1), 'view': 'brands', 'next_token': token})

    assert (status, body['code']) == (400, 'cursor_expired')


def test_a_live_token_on_a_snapshot_scope_is_cursor_expired(tenant):
    # The token a live answer mints for its second brand page.
    token = encode_snapshot_cursor(_LIMIT, _LIMIT + 1, LIVE_BUILD_ID)

    status, body = tenant.call(_HANDLER, _PATH, {'scope': 'all', 'view': 'brands', 'next_token': token})

    assert (status, body['code']) == (400, 'cursor_expired')


def test_a_malformed_token_is_a_validation_error(tenant):
    status, body = tenant.call(_HANDLER, _PATH, {'scope': 'all', 'view': 'brands', 'next_token': 'not-a-token'})

    assert (status, body['field']) == (400, 'next_token')
