"""Routing tests for the consolidated stats-insights API Lambda: which handler file answers a resource.

Sub-handlers load lazily through ``shared.router.HandlerLoader.get``; it is
patched to hand back a stub per file name, so no handler module executes.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.router import HandlerLoader
from testing.events import api_gateway_event
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(scope='module')
def router():
    return load_handler_module(_API_DIR, 'stats-insights.py', 'stats_insights_router_routing_under_test')


@pytest.mark.parametrize(('resource', 'filename'), [
    ('/api/visibility/sentiment-examples', 'get-sentiment-examples.py'),
    ('/api/visibility', 'get-visibility-metrics.py'),
    ('/api/reports/insights', 'get-reports-insights.py'),
    ('/api/reports/insights/regenerate', 'regenerate-report-insights.py'),
])
def test_routes_each_resource_to_its_own_handler(router, resource: str, filename: str) -> None:
    loaded: list[str] = []

    def load(_loader: HandlerLoader, name: str) -> MagicMock:
        loaded.append(name)
        return MagicMock(return_value={'statusCode': 200})

    with patch.object(HandlerLoader, 'get', load):
        router.handler(api_gateway_event('GET', resource, resource=resource), None)

    assert loaded == [filename]
