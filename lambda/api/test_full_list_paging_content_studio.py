"""Content Studio full lists (2.45.0 wave 5): every idea of a scope paged with a true total; every saved template listed.

The ideas oracle is the same route read live with one page as long as the
list; the templates read is a scan answered in several pages.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.content_studio_fixtures import load_content_studio_module
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.events import api_gateway_event, parse_response
from testing.full_list_fixtures import drain, without_build
from testing.scale_data import ScaleSpec, group_id, market_id

SPEC = ScaleSpec()
_HANDLER, _PATH = 'content-studio.py', '/api/content-studio/ideas'
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'market': {'market_id': market_id(0)}}
_PAGE = '7'


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


@pytest.fixture(autouse=True)
def no_seasonal_ideas() -> Any:
    """Seasonal ideas follow the calendar; the oracle and the pages must see the same list."""
    with patch('shared.content_idea_rules.seasonal_suggestions', MagicMock(return_value=[])):
        yield


def _ask(tenant: EndToEndTenant, query: Mapping[str, str], token: str | None = None) -> dict[str, Any]:
    status, body = tenant.call(_HANDLER, _PATH, {**query, **({'next_token': token} if token else {})})
    if status == 202:
        tenant.run_jobs()
        status, body = tenant.call(_HANDLER, _PATH, {**query, **({'next_token': token} if token else {})})
    assert status == 200, body
    return body


def _ids_dropped(ideas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in idea.items() if key != 'id'} for idea in ideas]


def _every_idea(tenant: EndToEndTenant, scope: Mapping[str, str]) -> list[Any]:
    status, body = tenant.call_live(_HANDLER, _PATH, {**scope, 'limit': '100'})
    assert (status, body['ideas_next_token']) == (200, None)
    return _ids_dropped(body['ideas'])


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_pages_concatenate_to_every_idea_of_the_scope(tenant, scope):
    pages = drain(lambda token: _ask(tenant, {**_SCOPES[scope], 'limit': _PAGE}, token), 'ideas', 'ideas_next_token')

    assert _ids_dropped(pages) == _every_idea(tenant, _SCOPES[scope])


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_ideas_total_counts_every_idea_not_the_page(tenant, scope):
    assert _ask(tenant, {**_SCOPES[scope], 'limit': _PAGE})['ideas_total'] == len(_every_idea(tenant, _SCOPES[scope]))


def test_the_tenant_has_more_ideas_than_a_page(tenant):
    assert len(_every_idea(tenant, {'scope': 'all'})) > 3 * int(_PAGE)


def test_a_group_lists_only_its_keywords_ideas(tenant):
    group_keywords = {row['keyword'] for row in _every_idea(tenant, {'group_id': group_id(0)})}

    assert group_keywords < {row['keyword'] for row in _every_idea(tenant, {'scope': 'all'})}


def test_a_view_job_answer_token_pages_the_rest_of_its_ideas(tenant):
    with without_build(tenant):
        pages = drain(lambda token: _ask(tenant, {'scope': 'all', 'limit': _PAGE}, token), 'ideas', 'ideas_next_token')

    assert _ids_dropped(pages) == _every_idea(tenant, {'scope': 'all'})


# --- saved templates -------------------------------------------------------------------

_mod = load_content_studio_module('content_studio_lists_under_test')


class _PagedScan:
    """A table whose scan answers its items two at a time (``LastEvaluatedKey`` = the next index)."""

    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items = items

    def scan(self, **kwargs: Any) -> dict[str, Any]:
        start = int((kwargs.get('ExclusiveStartKey') or {}).get('at', 0))
        page: dict[str, Any] = {'Items': self.items[start:start + 2]}
        return {**page, 'LastEvaluatedKey': {'at': start + 2}} if start + 2 < len(self.items) else page


def test_templates_list_every_saved_template_past_the_first_scan_page():
    saved = [{'id': f't{index}', 'name': f'Template {index}', 'prompt_template': '{keyword}'} for index in range(5)]
    with patch.object(_mod, '_templates_table', return_value=_PagedScan(saved)):
        _status, body = parse_response(_mod._list_templates(api_gateway_event('GET', '/api/content-studio/templates'), None))

    assert sorted(item['id'] for item in body['items'] if item['id'].startswith('t')) == ['t0', 't1', 't2', 't3', 't4']
