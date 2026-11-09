"""EventBridge events as the live-events relay receives them (``lambda/live-events/``)."""

from __future__ import annotations

import json
from typing import Any

from shared.change_events import ChangeKind

WORKFLOW = 'CitationAnalysis-Workflow'
RESEARCH = 'CitationAnalysis-KeywordResearch'
STATE_MACHINE_TOPICS = {WORKFLOW: 'runs', RESEARCH: 'research'}
OWNER_SUB = '3f1c2a4e-9b7d-4e21-8a55-0c6d2f1e9a10'


def change_event(kind: ChangeKind, detail: dict[str, Any]) -> dict[str, Any]:
    """The event EventBridge delivers for one ``shared.change_events.publish_change(kind, detail)``."""
    return {
        'version': '0', 'id': 'e-1', 'source': kind.source, 'detail-type': kind.detail_type,
        'account': '123456789012', 'time': '2026-11-09T10:00:00Z', 'region': 'us-east-1', 'resources': [],
        'detail': detail,
    }


def execution_status_event(state_machine: str, status: str, execution_input: Any = None) -> dict[str, Any]:
    """A Step Functions ``Execution Status Change`` of ``state_machine`` (input included when given)."""
    detail: dict[str, Any] = {
        'executionArn': f'arn:aws:states:us-east-1:123456789012:execution:{state_machine}:run-1',
        'stateMachineArn': f'arn:aws:states:us-east-1:123456789012:stateMachine:{state_machine}',
        'name': 'run-1', 'status': status, 'startDate': 1, 'stopDate': None,
        'input': None if execution_input is None else json.dumps(execution_input),
        'output': '{"secret": "never copied"}',
    }
    return {
        'version': '0', 'id': 'e-2', 'source': 'aws.states', 'detail-type': 'Step Functions Execution Status Change',
        'account': '123456789012', 'time': '2026-11-09T10:00:00Z', 'region': 'us-east-1', 'resources': [],
        'detail': detail,
    }
