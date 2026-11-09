"""GET /api/visibility within the request's time budget.

The scope's latest runs are read in parallel (``shared.scoped_reports.read_scope_keywords``);
keywords the budget leaves unread are left out and the answer says so with
``keywords_truncated``. Scope behaviour shared with the other report routes
lives in ``test_report_scopes.py``; the size budget in ``test_get_visibility_metrics_volume.py``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from testing.events import api_gateway_event, parse_response
from testing.report_scope_fixtures import report_handler_fixture
from testing.search_results_fixtures import active_keywords_table, report_dynamodb, search_results_table
from testing.sentiment_examples_fixtures import OLDER_RUN, stored_answer, stored_brand
from testing.window_budget_fixtures import one_scope_worker, request_deadline_of, spent_request_budget, ticking_deadline

visibility_handler = report_handler_fixture('get-visibility-metrics.py', 'get_visibility_metrics_budget_under_test')

_BRAND_CONFIG = {'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': []}}

_KEYWORDS = ['vuelos baratos a cusco', 'vuelos baratos a lima']
_ROWS = {
    keyword: [
        stored_answer(keyword, 'openai', [stored_brand('Altiplano Air', 'positive')]),
        stored_answer(keyword, 'openai', [stored_brand('Altiplano Air', 'neutral')], timestamp=OLDER_RUN),
    ]
    for keyword in _KEYWORDS
}


@pytest.fixture
def endpoint(visibility_handler) -> Any:
    keywords = active_keywords_table([{'id': f'k{index}', 'keyword': keyword, 'status': 'active'} for index, keyword in enumerate(_KEYWORDS)])
    with (
        patch.object(visibility_handler, 'dynamodb', report_dynamodb(search_results_table(_ROWS), keywords)),
        patch.object(visibility_handler, 'get_brand_config', return_value=_BRAND_CONFIG),
    ):
        yield visibility_handler


def _body(module: Any) -> dict[str, Any]:
    return parse_response(module.handler(api_gateway_event('GET', '/api/visibility', query={'scope': 'all'}), None))[1]


def test_answers_200_without_the_unread_keywords_when_the_budget_is_spent(endpoint) -> None:
    with spent_request_budget():
        status, body = parse_response(endpoint.handler(api_gateway_event('GET', '/api/visibility', query={'scope': 'all'}), None))

    assert (status, body['keywords_analyzed'], body['keywords_truncated']) == (200, 0, True)


def test_keeps_the_keywords_read_before_the_budget_ran_out(endpoint) -> None:
    # Checks: the first keyword's start passes, the second keyword's start finds the budget spent.
    with one_scope_worker(), request_deadline_of(lambda: ticking_deadline(2)):
        body = _body(endpoint)

    assert ([row['keyword'] for row in body['keywords']], body['keywords_truncated']) == ([_KEYWORDS[0]], True)


def test_reads_every_keyword_within_the_budget(endpoint) -> None:
    body = _body(endpoint)

    assert (body['keywords_analyzed'], body['keywords_truncated']) == (2, False)
