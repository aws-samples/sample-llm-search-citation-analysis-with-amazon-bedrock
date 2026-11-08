"""An in-memory EventBridge Scheduler client for the rank tracker schedule tests."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest


class SchedulerNotFoundError(Exception):
    """Stands in for ``scheduler.exceptions.ResourceNotFoundException``."""


class SchedulerStub:
    """Holds schedules by ``(GroupName, Name)``; update and delete of a missing one raise like the service."""

    def __init__(self) -> None:
        self.schedules: dict[tuple[str, str], dict[str, Any]] = {}
        self.exceptions = SimpleNamespace(ResourceNotFoundException=SchedulerNotFoundError)

    def create_schedule(self, **definition: Any) -> dict[str, Any]:
        self.schedules[(definition['GroupName'], definition['Name'])] = definition
        return {}

    def update_schedule(self, **definition: Any) -> dict[str, Any]:
        key = (definition['GroupName'], definition['Name'])
        if key not in self.schedules:
            raise SchedulerNotFoundError(key)
        self.schedules[key] = definition
        return {}

    def delete_schedule(self, *, Name: str, GroupName: str) -> dict[str, Any]:
        if self.schedules.pop((GroupName, Name), None) is None:
            raise SchedulerNotFoundError((GroupName, Name))
        return {}

    def expression(self, name: str, group: str = 'citation-analysis-seo-rank') -> str | None:
        """The ``at(...)`` expression of ``name``, or ``None`` when it does not exist."""
        schedule = self.schedules.get((group, name))
        return schedule['ScheduleExpression'] if schedule else None

    def target_input(self, name: str, group: str = 'citation-analysis-seo-rank') -> dict[str, Any]:
        return json.loads(self.schedules[(group, name)]['Target']['Input'])


def scheduler_stub(monkeypatch: pytest.MonkeyPatch) -> SchedulerStub:
    """A fresh stub, with the target and role variables ``shared.rank_tracking_timer`` reads."""
    monkeypatch.setenv('RANK_TRACKER_TARGET_ARN', 'arn:aws:lambda:us-east-1:123456789012:function:SeoJobs')
    monkeypatch.setenv('RANK_TRACKER_SCHEDULER_ROLE_ARN', 'arn:aws:iam::123456789012:role/RankScheduler')
    return SchedulerStub()
