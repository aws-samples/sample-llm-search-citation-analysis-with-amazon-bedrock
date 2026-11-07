"""Shared setup for tests that load the KPI alert worker (``lambda/kpi-alerts/handler.py``)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from testing.search_result_fixtures import BrandSpec, successful_answer_row

#: The table names and topic the worker resolves at import.
KPI_ALERT_WORKER_ENV: Mapping[str, str] = {
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


def complete_run_event(timestamp: str, keywords: list[str]) -> dict[str, Any]:
    """The worker event of a completed run stamped ``timestamp`` that processed ``keywords``."""
    return {
        'execution_id': 'exec-1',
        'execution_input': {'scope': {'mode': 'all'}},
        'report': {
            'execution_id': 'exec-1',
            'status': 'completed',
            'run_metadata': {
                'timestamp': timestamp,
                'timestamps': [timestamp],
                'processed_keywords': [{'keyword': keyword, 'timestamp': timestamp} for keyword in keywords],
            },
        },
    }


def hotel_row(timestamp: str, provider: str, *brands: BrandSpec) -> dict[str, Any]:
    """One engine answer to 'hotel spa' in the run stamped ``timestamp`` naming ``brands``."""
    return successful_answer_row(keyword='hotel spa', timestamp=timestamp, provider=provider, brands=brands, citations=[])
