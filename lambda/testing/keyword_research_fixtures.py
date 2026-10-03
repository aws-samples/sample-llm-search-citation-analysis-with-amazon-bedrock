"""Loading, stubs and events shared by the ``keyword-research.py`` API suites."""

from __future__ import annotations

import os
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock

from testing.env import KEYWORD_RESEARCH_ENV, setdefault_env
from testing.module_loader import load_handler_module_offline

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')

_HISTORY_PATH = '/api/keyword-research/history'


def load_keyword_research(module_name: str) -> ModuleType:
    """``keyword-research.py`` loaded as ``module_name`` with its import-time env defaulted and boto3 stubbed."""
    setdefault_env(KEYWORD_RESEARCH_ENV)
    return load_handler_module_offline(_API_DIR, 'keyword-research.py', module_name)


def research_table_stub(item: dict | None = None, items: list[dict] | None = None) -> MagicMock:
    """A table whose ``get_item`` finds ``item`` (nothing when ``None``) and whose ``scan`` lists ``items``."""
    table = MagicMock()
    table.get_item.return_value = {'Item': item} if item is not None else {}
    table.scan.return_value = {'Items': items or [], 'Count': len(items or [])}
    return table


def started_stepfunctions() -> MagicMock:
    """A Step Functions client whose ``start_execution`` succeeds."""
    client = MagicMock()
    client.start_execution.return_value = {'executionArn': 'arn:aws:states:us-west-2:123456789012:execution:research:abc'}
    return client


def job_event(method: str, job_id: str, suffix: str = '') -> dict[str, Any]:
    """``<method> /api/keyword-research/<job_id><suffix>`` with the ``id`` path parameter."""
    return {'httpMethod': method, 'path': f'/api/keyword-research/{job_id}{suffix}', 'pathParameters': {'id': job_id}}


def history_event(job_type: str | None = None) -> dict[str, Any]:
    """``GET /api/keyword-research/history``, filtered to ``job_type`` when given."""
    event: dict[str, Any] = {'httpMethod': 'GET', 'path': _HISTORY_PATH}
    if job_type is not None:
        event['queryStringParameters'] = {'type': job_type}
    return event
