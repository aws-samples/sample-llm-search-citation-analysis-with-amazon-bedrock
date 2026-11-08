"""In-memory DataForSEO callback gates (``shared.dataforseo_callbacks``) for the job step tests."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any

import pytest

from shared.dataforseo_callbacks import Arrival

TASK_TOKEN = '-'.join(('step-functions', 'callback', '1'))
"""A stand-in Step Functions task token."""


@dataclass
class GateStub:
    """The gates a step opened, settled and released, with every task success sent."""

    gates: dict[str, dict[str, Any]] = field(default_factory=dict)
    released: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    arrived_early: int = 0
    """Pingbacks counted before ``settle`` (every task called back while the post was still answering)."""

    def open_gate(self, gate_id: str, expected: int, task_token: str, output: dict[str, Any]) -> None:
        self.gates[gate_id] = {'remaining': expected - self.arrived_early, 'task_token': task_token,
                               'output': json.dumps(output)}

    def settle(self, gate_id: str, never_coming: int) -> Arrival:
        gate = self.gates[gate_id]
        gate['remaining'] -= never_coming
        return Arrival(remaining=gate['remaining'], task_token=gate['task_token'], output=gate['output'])

    def release(self, task_token: str, output: str) -> bool:
        self.released.append((task_token, json.loads(output)))
        return True

    def release_if_due(self, gate_id: str) -> bool:
        gate = self.gates[gate_id]
        if gate['remaining'] > 0 or gate.get('released'):
            return False
        gate['released'] = True
        return self.release(gate['task_token'], gate['output'])

    @property
    def only_gate(self) -> dict[str, Any]:
        (gate,) = self.gates.values()
        return gate

    def resumed_state(self) -> dict[str, Any]:
        """The state the state machine resumes with: the release a step sent, else the gate's own output."""
        if self.released:
            return self.released[-1][1]
        return json.loads(self.only_gate['output'])


def fake_callback_gates(monkeypatch: pytest.MonkeyPatch, module: ModuleType) -> GateStub:
    """Replace the gate functions ``module`` imported from ``shared.dataforseo_callbacks``."""
    stub = GateStub()
    for name in ('open_gate', 'settle', 'release', 'release_if_due'):
        monkeypatch.setattr(module, name, getattr(stub, name))
    monkeypatch.setattr(module, 'pingback_url', lambda gate_id: f'https://callbacks.example/?gate={gate_id}&id=$id')
    return stub


__all__ = ['TASK_TOKEN', 'GateStub', 'fake_callback_gates']
