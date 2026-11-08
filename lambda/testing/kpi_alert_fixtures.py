"""Support for the KpiAlerts worker tests: its environment, a run's event and the worker's collaborators replaced."""

from __future__ import annotations

from collections.abc import Mapping
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS

KPI_ALERTS_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'search',
    'DYNAMODB_TABLE_KEYWORDS': 'keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'groups',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'brand-config',
    'DYNAMODB_TABLE_KPI_SNAPSHOTS': 'snapshots',
    'DYNAMODB_TABLE_KPI_ALERTS': 'alerts',
    'DYNAMODB_TABLE_ALERT_SETTINGS': 'settings',
    'DYNAMODB_TABLE_CONTENT_CHANGES': 'changes',
    'KPI_ALERTS_TOPIC_ARN': 'arn:aws:sns:us-east-1:123456789012:kpi-alerts',
}
"""The worker's environment variables."""

ALERTS_DISABLED = {**DEFAULT_ALERT_SETTINGS, 'enabled': False}


def run_event(run: str, keywords: list[str], status: str = 'completed') -> dict[str, Any]:
    """The worker's event for a run stamped ``run`` that processed ``keywords`` (``scope`` all)."""
    return {
        'execution_id': 'exec-1',
        'execution_input': {'scope': {'mode': 'all'}},
        'report': {
            'execution_id': 'exec-1',
            'timestamp': '2026-10-01T10:05:00Z',
            'status': status,
            'run_metadata': {
                'timestamp': run,
                'timestamps': [run],
                'processed_keywords': [{'keyword': keyword, 'timestamp': run} for keyword in keywords],
            },
        },
    }


def worker_patches(
    module: ModuleType, *, active: list[dict[str, Any]], groups: list[dict[str, Any]], brand_config: Mapping[str, Any],
    raw: MagicMock, resource: Any, **extra: Any,
) -> Any:
    """``module``'s collaborators replaced: the active keywords and groups, alerts disabled, ``raw`` as the run rows read."""
    return patch.multiple(
        module,
        query_active_keywords=MagicMock(return_value=active),
        _load_groups=MagicMock(return_value=groups),
        _settings=MagicMock(return_value=ALERTS_DISABLED),
        get_brand_config=MagicMock(return_value=dict(brand_config)),
        _load_run_rows=raw,
        _previous_snapshot=MagicMock(return_value=None),
        _notify=MagicMock(return_value={'status': 'not_sent'}),
        dynamodb=resource,
        **extra,
    )


__all__ = ['ALERTS_DISABLED', 'KPI_ALERTS_ENV', 'run_event', 'worker_patches']
