"""``GET /api/prompt-insights`` full lists (2.45.0 wave 5): each list pages its whole ranking (``<list>_next_token`` with ``type=<tab>``).

The oracle is one live answer of the same route with ``limit`` past every
list (the uncapped ranking). Served from the snapshot, from a view job and
live, the body's first page and its tokens reach it.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import Any

import pytest

from shared.prompt_classification import TYPE_LISTS
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.full_list_fixtures import answered_page, drain, without_build
from testing.scale_data import ScaleSpec, group_id, keyword_text, market_id

SPEC = ScaleSpec()
_HANDLER, _PATH = 'get-prompt-insights.py', '/api/prompt-insights'
_SCOPES = {
    'scope=all': {'scope': 'all'},
    'large group': {'group_id': group_id(0)},
    'market': {'market_id': market_id(0)},
    'one keyword': {'keyword': keyword_text(1)},
}
_PAGE = '7'


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


_ask = partial(answered_page, handler=_HANDLER, path=_PATH)


def _uncapped(tenant: EndToEndTenant, scope: Mapping[str, str], tab: str) -> list[Any]:
    status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'type': tab, 'limit': '100'})
    key = TYPE_LISTS[tab]
    assert (status, body[f'{key}_next_token']) == (200, None)
    return body[key]


def _whole_list(tenant: EndToEndTenant, scope: Mapping[str, str], tab: str) -> list[Any]:
    key = TYPE_LISTS[tab]
    first = _ask(tenant, {**scope, 'limit': _PAGE})
    token = first[f'{key}_next_token']
    query = {**scope, 'type': tab, 'limit': _PAGE}
    rest = drain(lambda following: _ask(tenant, query, following or token), key, f'{key}_next_token') if token else []
    return first[key] + rest


@pytest.mark.parametrize('scope', list(_SCOPES))
@pytest.mark.parametrize('tab', ['winning', 'losing', 'opportunities'])
def test_the_body_first_page_then_its_token_reach_the_whole_ranking(tenant, scope, tab):
    assert _whole_list(tenant, _SCOPES[scope], tab) == _uncapped(tenant, _SCOPES[scope], tab)


def test_the_winning_ranking_is_longer_than_a_page_so_the_cursor_is_exercised(tenant):
    assert len(_uncapped(tenant, {'scope': 'all'}, 'winning')) > 3 * int(_PAGE)


def test_a_view_job_body_token_pages_the_rest_of_its_ranking(tenant):
    with without_build(tenant):
        pages = _whole_list(tenant, {'scope': 'all'}, 'winning')

    assert pages == _uncapped(tenant, {'scope': 'all'}, 'winning')


def test_the_body_keeps_todays_first_twenty_prompts(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert body['winning_prompts'] == _uncapped(tenant, {'scope': 'all'}, 'winning')[:20]


def test_each_list_total_equals_its_summary_count(tenant):
    body = _ask(tenant, {'scope': 'all'})

    assert (body['winning_prompts_total'], body['losing_prompts_total'], body['opportunity_prompts_total']) == (
        body['summary']['winning_count'], body['summary']['losing_count'], body['summary']['opportunity_count'],
    )
