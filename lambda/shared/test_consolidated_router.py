"""
Tests for shared.consolidated_router — the handler factory behind the router Lambdas.

- the built handler dispatches to the sub-handler file of the matching route
- an unmatched route answers 404 through the shared CORS policy
- log lines carry the router's own logger name
"""

from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import patch

import pytest

from shared.consolidated_router import route_map_handler

_ROUTE_MAP = {
    '/api/things/{id}/status': 'status-handler.py',
    '/api/things': 'generic-handler.py',
}


@pytest.fixture
def router_file(tmp_path: Path) -> str:
    """A router file path whose two sibling sub-handlers echo which one ran."""
    for name in ('status-handler', 'generic-handler'):
        (tmp_path / f'{name}.py').write_text(
            f'def handler(event, context):\n'
            f'    return {{"handled_by": "{name}", "context": context}}\n'
        )
    return str(tmp_path / 'fake-router.py')


@pytest.fixture
def configured_origin():
    """Pin the shared CORS policy to one origin, independent of the ambient env and SSM."""
    with patch('shared.api_response.get_cors_origin', return_value='https://dashboard.example.com'):
        yield 'https://dashboard.example.com'


def test_dispatches_to_the_sub_handler_of_the_first_matching_route(router_file):
    handler = route_map_handler(router_file, _ROUTE_MAP, 'test_router')

    result = handler({'resource': '/api/things/{id}/status', 'path': '/api/things/42/status'}, 'ctx')

    assert result == {'handled_by': 'status-handler', 'context': 'ctx'}


def test_falls_through_to_the_generic_route_for_a_plain_child_path(router_file):
    handler = route_map_handler(router_file, _ROUTE_MAP, 'test_router')

    result = handler({'resource': '/api/things/{id}', 'path': '/api/things/42'}, None)

    assert result['handled_by'] == 'generic-handler'


def test_answers_404_through_the_shared_cors_policy_for_an_unmatched_route(router_file, configured_origin):
    handler = route_map_handler(router_file, _ROUTE_MAP, 'test_router')

    result = handler({'resource': '/api/other', 'path': '/api/other', 'headers': {'origin': configured_origin}}, None)

    assert (result['statusCode'], result['headers']['Access-Control-Allow-Origin']) == (404, configured_origin)


def test_logs_under_the_router_logger_name(router_file, caplog: pytest.LogCaptureFixture):
    handler = route_map_handler(router_file, _ROUTE_MAP, 'stats_insights_router')

    with caplog.at_level(logging.INFO, logger='stats_insights_router'):
        handler({'resource': '/api/things', 'path': '/api/things'}, None)

    assert {record.name for record in caplog.records} == {'stats_insights_router'}
    assert 'Matched route /api/things -> generic-handler.py' in caplog.text
