"""``GET /api/citation-gaps`` full lists (2.45.0 wave 5): every gap of a scope (``view=gaps``), every list of one keyword.

The oracle is the same route read live with one page as long as the list:
the uncapped list. Served from the snapshot, from a view job and live, the
answer's first page and its token reach it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from shared import action_list_builders
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.full_list_fixtures import drain, patched, without_build
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-citation-gaps.py', '/api/citation-gaps'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'market': {'market_id': market_id(0)}}
#: The tenant keyword with the most gaps (7): every one of its lists takes several short pages.
_KEYWORD = {'keyword': keyword_text(17)}
_SMALL_PAGE = 7
#: One keyword's lists cut short (3 first, pages of 2) so its handful of gaps and sources take several pages.
_SHORT_KEYWORD_LISTS = {'gaps': ('gaps', 3), 'covered': ('covered_sources', 3), 'domains': ('domain_summary', 3)}


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


def _every_gap(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    with patched(action_list_builders, GAPS_PAGE=10**9):
        status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'view': 'gaps'})
    assert (status, body['next_token'], body['gaps_truncated']) == (200, None, False)
    return body['gaps']


def _scope_gaps(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    first = _ask(tenant, scope)
    token = first['gaps_next_token']
    with patched(action_list_builders, GAPS_PAGE=_SMALL_PAGE):
        rest = drain(lambda following: _ask(tenant, {**scope, 'view': 'gaps'}, following or token), 'gaps') if token else []
    return first['top_gaps'] + rest


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_top_gaps_then_their_token_reach_every_gap_of_the_scope(tenant, scope):
    assert _scope_gaps(tenant, _SCOPES[scope]) == _every_gap(tenant, _SCOPES[scope])


def test_a_scope_has_more_gaps_than_the_answer_lists_first(tenant):
    assert len(_every_gap(tenant, {'scope': 'all'})) > 30 + 2 * _SMALL_PAGE


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_gaps_total_counts_every_gap_of_the_scope(tenant, scope):
    assert _ask(tenant, _SCOPES[scope])['gaps_total'] == len(_every_gap(tenant, _SCOPES[scope]))


def test_a_view_job_answer_token_pages_the_rest_of_its_gaps(tenant):
    with without_build(tenant):
        gaps = _scope_gaps(tenant, {'scope': 'all'})

    assert gaps == _every_gap(tenant, {'scope': 'all'})


@pytest.fixture
def short_keyword_lists(tenant) -> Any:
    module = tenant.handler(_HANDLER)
    with patched(module, KEYWORD_LISTS=_SHORT_KEYWORD_LISTS, KEYWORD_PAGE=2):
        yield


@pytest.mark.parametrize(('view', 'key'), [('gaps', 'gaps'), ('covered', 'covered_sources'), ('domains', 'domain_summary')])
@pytest.mark.usefixtures('short_keyword_lists')
def test_one_keyword_lists_page_to_their_whole_run(tenant, view, key):
    first = _ask(tenant, _KEYWORD)
    token = first[f'{key}_next_token']

    rest = drain(lambda following: _ask(tenant, {**_KEYWORD, 'view': view}, following or token), key) if token else []

    assert (first[key] + rest, first[f'{key}_total'] > 3) == (_whole_keyword_list(tenant, view, key), True)


def _whole_keyword_list(tenant: EndToEndTenant, view: str, key: str) -> list[Any]:
    module = tenant.handler(_HANDLER)
    with patched(module, KEYWORD_PAGE=10**9):
        status, body = tenant.call(_HANDLER, _PATH, {**_KEYWORD, 'view': view})
    assert (status, body['next_token']) == (200, None)
    return body[key]


def test_a_scope_gap_token_on_a_keyword_list_is_cursor_expired(tenant):
    status, body = tenant.call(_HANDLER, _PATH, {**_KEYWORD, 'view': 'gaps', 'next_token': _ask(tenant, {'scope': 'all'})['gaps_next_token']})

    assert (status, body['code']) == (400, 'cursor_expired')


def test_a_scope_answers_400_for_a_keyword_only_view(tenant):
    status, body = tenant.call(_HANDLER, _PATH, {'scope': 'all', 'view': 'covered'})

    assert (status, body['field']) == (400, 'view')
