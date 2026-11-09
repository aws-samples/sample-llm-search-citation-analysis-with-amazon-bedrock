"""An in-memory EventBridge client that records the change events ``shared.change_events`` publishes."""

from __future__ import annotations

import json
from typing import Any

import pytest

from shared import change_events
from shared.change_events import ChangeKind


def _kind_of(detail_type: str) -> ChangeKind:
    """The ``shared.change_events`` kind whose ``detail-type`` is ``detail_type``; a typo fails the test."""
    kinds = [value for value in vars(change_events).values() if isinstance(value, ChangeKind) and value.detail_type == detail_type]
    if len(kinds) != 1:
        raise KeyError(f'no change event kind has detail-type {detail_type!r}')
    return kinds[0]


class RecordingEvents:
    """Accepts every ``PutEvents`` entry (or refuses them all with ``refuse``) and keeps it."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []
        self.refuse = False
        self.error: Exception | None = None

    def put_events(self, *, Entries: list[dict[str, Any]]) -> dict[str, Any]:
        if self.error is not None:
            raise self.error
        self.entries.extend(Entries)
        if self.refuse:
            return {'FailedEntryCount': len(Entries), 'Entries': [{'ErrorCode': 'InternalFailure'} for _ in Entries]}
        return {'FailedEntryCount': 0, 'Entries': [{'EventId': str(index)} for index, _ in enumerate(Entries)]}

    def details(self, kind: ChangeKind | str) -> list[dict[str, Any]]:
        """The decoded detail of every ``kind`` event put so far, in order; ``kind`` may be its ``detail-type``."""
        if isinstance(kind, str):
            kind = _kind_of(kind)
        return [
            json.loads(entry['Detail']) for entry in self.entries
            if entry['Source'] == kind.source and entry['DetailType'] == kind.detail_type
        ]


def install_recorder(monkeypatch: pytest.MonkeyPatch) -> RecordingEvents:
    """A fresh recorder in place of the EventBridge client for one test (``lambda/conftest.py`` does it for every test)."""
    recorder = RecordingEvents()
    monkeypatch.setattr(change_events, '_events_client', lambda: recorder)
    return recorder
