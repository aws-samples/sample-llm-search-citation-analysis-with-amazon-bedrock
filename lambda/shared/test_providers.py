"""
Tests for shared.providers.get_enabled_provider_count.

The helper replaces byte-identical copies that previously lived in
api/get-visibility-metrics.py and api/get-historical-trends.py (audit
item 28). These tests pin the semantic contract both callers relied on,
especially the three fallback branches that each return
``len(PROVIDERS)``:

- No env var configured → fall back (treat all providers as enabled)
- Scan raises → fall back (don't return 0 for visibility-score math)
- Scan returns empty → fall back (table exists but hasn't been populated)
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

# Load by bare name to avoid triggering shared/__init__.py's boto3 import.
sys.path.insert(0, os.path.dirname(__file__))

import providers  # type: ignore[import-not-found]
from config import PROVIDERS  # type: ignore[import-not-found]


class TestGetEnabledProviderCount:
    def _mock_dynamodb_with_items(self, items: list[dict]) -> MagicMock:
        """Build a fake DynamoDB resource whose table.scan returns `items`."""
        fake_table = MagicMock()
        fake_table.scan.return_value = {'Items': items}
        fake_resource = MagicMock()
        fake_resource.Table.return_value = fake_table
        return fake_resource

    def test_returns_all_providers_when_no_table_env_var(self) -> None:
        """No PROVIDER_CONFIG_TABLE → default-on for every provider."""
        with patch.dict(os.environ, {}, clear=True):
            # clear=True drops PROVIDER_CONFIG_TABLE from os.environ
            count = providers.get_enabled_provider_count()
        assert count == len(PROVIDERS)

    def test_returns_all_providers_when_table_is_empty(self) -> None:
        """Empty scan result → all providers enabled by default."""
        fake = self._mock_dynamodb_with_items([])
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        assert count == len(PROVIDERS)

    def test_counts_explicitly_enabled_providers(self) -> None:
        """Mix of enabled and disabled entries — count only the enabled."""
        items = [
            {'provider_id': p, 'enabled': (i % 2 == 0)}
            for i, p in enumerate(PROVIDERS)
        ]
        fake = self._mock_dynamodb_with_items(items)
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        expected = sum(1 for i, _ in enumerate(PROVIDERS) if i % 2 == 0)
        assert count == expected

    def test_falls_back_to_all_providers_when_every_entry_disabled(self) -> None:
        """If the table says zero providers are enabled we still return
        len(PROVIDERS) — otherwise downstream visibility-score math would
        divide by zero."""
        items = [{'provider_id': p, 'enabled': False} for p in PROVIDERS]
        fake = self._mock_dynamodb_with_items(items)
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        assert count == len(PROVIDERS)

    def test_treats_missing_enabled_attribute_as_enabled(self) -> None:
        """Dashboard convention: missing `enabled` field defaults to True.
        This has to match the UI's opt-out model or counts drift from
        what the user sees in settings."""
        items = [{'provider_id': p} for p in PROVIDERS]  # no `enabled` key
        fake = self._mock_dynamodb_with_items(items)
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        assert count == len(PROVIDERS)

    def test_falls_back_to_all_providers_on_scan_exception(self) -> None:
        """DynamoDB outage must not crash the dashboard — return the
        conservative count so visibility math still has a reasonable
        denominator."""
        fake = MagicMock()
        fake.Table.return_value.scan.side_effect = Exception("throttled")
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        assert count == len(PROVIDERS)
