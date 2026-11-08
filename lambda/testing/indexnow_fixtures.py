"""The IndexNow key and the SEO cache table ``indexnow_store`` keeps it in, for the IndexNow suites."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from shared import indexnow_store
from testing.dynamodb_stubs import conditional_check_failure

SAMPLE_HEX_32 = '0123456789abcdef' * 2
"""An IndexNow key of the expected shape (32 hex characters); a made-up test value, not a credential."""


@dataclass
class KeyTable:
    """The SEO cache table as ``indexnow_store`` uses it: get, and put with ``attribute_not_exists``."""

    items: dict[str, dict[str, Any]] = field(default_factory=dict)
    lose_next_race_to: str | None = None
    """When set, the next conditional put finds this key already stored by a concurrent writer."""

    def get_item(self, Key: dict[str, str], **_options: Any) -> dict[str, Any]:
        stored = self.items.get(Key['cache_key'])
        return {} if stored is None else {'Item': {**stored}}

    def put_item(self, Item: dict[str, Any], **condition: Any) -> None:
        cache_key = Item['cache_key']
        if condition and self.lose_next_race_to is not None:
            self.items[cache_key], self.lose_next_race_to = {**Item, 'key': self.lose_next_race_to}, None
        if condition and cache_key in self.items:
            raise conditional_check_failure('PutItem')
        self.items[cache_key] = {**Item}


def install_key_table(monkeypatch: pytest.MonkeyPatch) -> KeyTable:
    table = KeyTable()
    monkeypatch.setattr(indexnow_store, '_table', lambda: table)
    return table
