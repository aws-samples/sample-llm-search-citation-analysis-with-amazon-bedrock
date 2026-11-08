"""Export sources S23 (content ideas, against a generated tenant) and S24 (content history, against a paged fake route)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.export_source_studio import CONTENT_HISTORY, CONTENT_IDEAS
from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.export_source_fixtures import USER, PagedRoute, all_rows, resumed_from_every_row, row_values
from testing.full_list_fixtures import TenantRoutes, oracle_values, over_tenant, short_paged
from testing.scale_data import ScaleSpec, group_id, market_id

SPEC = ScaleSpec()
_SCOPES = {'scope=all': {'scope': 'all'}, 'large group': {'group_id': group_id(0)}, 'market': {'market_id': market_id(0)}}


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


@pytest.fixture(autouse=True)
def no_seasonal_ideas() -> Any:
    with patch('shared.content_idea_rules.seasonal_suggestions', MagicMock(return_value=[])):
        yield


def _without_ids(rows: list[tuple[str, tuple]]) -> list[tuple[str, tuple]]:
    """Idea ids are minted per answer; the rest of each row is the idea."""
    return [(sheet, values[1:]) for sheet, values in rows]


@pytest.mark.parametrize('scope', list(_SCOPES))
def test_ideas_equal_the_uncapped_view(tenant, scope):
    source = over_tenant(short_paged(CONTENT_IDEAS, 7), TenantRoutes(tenant))
    oracle = oracle_values(TenantRoutes(tenant, live=True), CONTENT_IDEAS.lists[0], {**_SCOPES[scope], 'limit': '100'})

    assert _without_ids(row_values(all_rows(source, _SCOPES[scope]))) == _without_ids(oracle)


def test_ideas_resume_after_every_row_with_exactly_the_remaining_rows(tenant):
    params = {'group_id': group_id(0)}
    source = over_tenant(short_paged(CONTENT_IDEAS, 7), TenantRoutes(tenant))
    rows = all_rows(source, params)

    resumed = {index: _without_ids(row_values(rest)) for index, rest in resumed_from_every_row(source, params, rows)}

    assert (len(rows) > 7, resumed) == (True, {index: _without_ids(row_values(rows[index + 1:])) for index in range(len(rows))})


def _history(count: int) -> list[dict[str, Any]]:
    return [{'id': f'c{index:03}', 'status': 'completed', 'idea_title': f'Guide {index}', 'created_at': f'2026-11-{1 + index % 28:02}'} for index in range(count)]


def test_history_lists_every_piece_across_pages():
    route = PagedRoute(_history(230), list_key='history')
    source = replace(CONTENT_HISTORY, invoker=route, sleep=lambda _seconds: None)

    rows = all_rows(source, {})

    assert [row.values[0] for row in rows] == [f'c{index:03}' for index in range(230)]


def test_history_takes_no_parameter():
    assert CONTENT_HISTORY.validate({'scope': 'all'}, USER) == 'Unknown parameter for the content-history export: scope'


def test_ideas_take_the_scope_and_market():
    assert CONTENT_IDEAS.validate({'group_id': 'g1', 'market_id': 'es-es'}, USER) is None
