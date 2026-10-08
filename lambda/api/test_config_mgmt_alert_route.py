"""ConfigMgmt dispatch coverage for the alerts, custom-reports, providers (incl. Bedrock models) and markets APIs."""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest

from shared.router import HandlerLoader
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


@pytest.mark.parametrize(
    ('method', 'resource', 'path', 'handler_file'),
    [
        ('GET', '/api/alerts/settings', '/api/alerts/settings', 'manage-alerts.py'),
        ('POST', '/api/alerts/test-notification', '/api/alerts/test-notification', 'manage-alerts.py'),
        ('GET', '/api/custom-reports', '/api/custom-reports', 'manage-custom-reports.py'),
        ('POST', '/api/custom-reports', '/api/custom-reports', 'manage-custom-reports.py'),
        ('PUT', '/api/custom-reports/{id}', '/api/custom-reports/report-1', 'manage-custom-reports.py'),
        ('DELETE', '/api/custom-reports/{id}', '/api/custom-reports/report-1', 'manage-custom-reports.py'),
        ('GET', '/api/providers/{id}/models', '/api/providers/bedrock/models', 'manage-bedrock-models.py'),
        ('POST', '/api/providers/{id}/validate', '/api/providers/bedrock/validate', 'manage-bedrock-models.py'),
        ('PUT', '/api/providers/{id}', '/api/providers/bedrock', 'manage-bedrock-models.py'),
        ('GET', '/api/providers/{id}/models', '/api/providers/openai/models', 'manage-providers.py'),
        ('PUT', '/api/providers/{id}', '/api/providers/bedrockx', 'manage-providers.py'),
        ('GET', '/api/providers', '/api/providers', 'manage-providers.py'),
        ('GET', '/api/markets', '/api/markets', 'manage-markets.py'),
        ('PUT', '/api/markets', '/api/markets', 'manage-markets.py'),
        ('POST', '/api/markets', '/api/markets', 'manage-markets.py'),
    ],
)
def test_dispatches_each_config_path_to_its_handler_file(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    resource: str,
    path: str,
    handler_file: str,
) -> None:
    router = load_handler_module(
        _API_DIR,
        'config-mgmt.py',
        'config_mgmt_alert_route_under_test',
    )
    child = MagicMock(return_value={'statusCode': 200, 'body': '{}'})
    loader_get = MagicMock(return_value=child)
    monkeypatch.setattr(HandlerLoader, 'get', loader_get)
    event = {
        'httpMethod': method,
        'resource': resource,
        'path': path,
    }

    response = router.handler(event, None)

    assert response == {'statusCode': 200, 'body': '{}'}
    assert loader_get.call_args.args[-1] == handler_file
    child.assert_called_once_with(event, None)
