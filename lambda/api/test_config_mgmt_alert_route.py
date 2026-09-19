"""ConfigMgmt dispatch coverage for the alerts API."""

from __future__ import annotations

import os
from unittest.mock import MagicMock

from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


def test_dispatches_alert_paths_to_manage_alerts_handler() -> None:
    router = load_handler_module(
        _API_DIR,
        'config-mgmt.py',
        'config_mgmt_alert_route_under_test',
    )
    child = MagicMock(return_value={'statusCode': 200, 'body': '{}'})
    router._handlers.get = MagicMock(return_value=child)
    event = {
        'httpMethod': 'GET',
        'resource': '/api/alerts/settings',
        'path': '/api/alerts/settings',
    }

    response = router.handler(event, None)

    assert response == {'statusCode': 200, 'body': '{}'}
    router._handlers.get.assert_called_once_with('manage-alerts.py')
    child.assert_called_once_with(event, None)
