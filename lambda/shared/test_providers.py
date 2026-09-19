"""
Tests for shared.providers.get_enabled_provider_count.

The helper replaces byte-identical copies that previously lived in
api/get-visibility-metrics.py and api/get-historical-trends.py (audit
item 28). These tests pin the semantic contract both callers relied on:

- Only LLM providers are counted — brand extraction never runs on the
  optional search providers, so they cannot contribute to provider coverage.
- The three fallback branches each return ``len(LLM_PROVIDERS)``:
  no env var configured, scan raises, scan returns empty.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

from shared import providers
from shared.config import LLM_PROVIDERS, SEARCH_PROVIDERS
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table


class ProviderScanError(Exception):
    """Stand-in for whatever DynamoDB raises during the provider-config scan."""


def _count_with_scan_returning(items: list[dict]) -> int:
    """``get_enabled_provider_count`` against a provider-config table whose scan returns ``items``."""
    resource = fake_dynamodb_resource(fake_table(scan={'Items': items}))
    with patch.object(providers, 'get_dynamodb_resource', return_value=resource):
        return providers.get_enabled_provider_count(table_name='test-table')


class TestGetEnabledProviderCount:
    def test_returns_all_llm_providers_when_no_table_env_var(self) -> None:
        """No PROVIDER_CONFIG_TABLE → default-on for every LLM provider."""
        with patch.dict(os.environ, {}, clear=True):
            # clear=True drops PROVIDER_CONFIG_TABLE from os.environ
            count = providers.get_enabled_provider_count()
        assert count == len(LLM_PROVIDERS)

    def test_returns_all_llm_providers_when_table_is_empty(self) -> None:
        """Empty scan result → all LLM providers enabled by default."""
        assert _count_with_scan_returning([]) == len(LLM_PROVIDERS)

    def test_counts_only_the_explicitly_enabled_llm_providers(self) -> None:
        """Mix of enabled and disabled entries — count only the enabled."""
        items = [
            {'provider_id': p, 'enabled': (i % 2 == 0)}
            for i, p in enumerate(LLM_PROVIDERS)
        ]
        expected = sum(1 for i, _ in enumerate(LLM_PROVIDERS) if i % 2 == 0)
        assert _count_with_scan_returning(items) == expected

    def test_ignores_enabled_search_providers(self) -> None:
        """Search providers never produce brand mentions, so enabling them
        must not inflate the coverage denominator: 4 LLM + 5 search rows all
        enabled still count as 4."""
        items = [{'provider_id': p, 'enabled': True} for p in [*LLM_PROVIDERS, *SEARCH_PROVIDERS]]
        assert _count_with_scan_returning(items) == len(LLM_PROVIDERS)

    def test_counts_llm_providers_absent_from_the_table_as_enabled(self) -> None:
        """A table that only holds rows for two LLM providers still yields the
        full LLM count — absent providers follow the default-on convention."""
        items = [{'provider_id': LLM_PROVIDERS[0], 'enabled': True}, {'provider_id': LLM_PROVIDERS[1], 'enabled': True}]
        assert _count_with_scan_returning(items) == len(LLM_PROVIDERS)

    def test_falls_back_to_all_llm_providers_when_every_entry_disabled(self) -> None:
        """If the table says zero providers are enabled we still return
        len(LLM_PROVIDERS) — otherwise downstream visibility-score math would
        divide by zero."""
        items = [{'provider_id': p, 'enabled': False} for p in LLM_PROVIDERS]
        assert _count_with_scan_returning(items) == len(LLM_PROVIDERS)

    def test_treats_missing_enabled_attribute_as_enabled(self) -> None:
        """Dashboard convention: missing `enabled` field defaults to True.
        This has to match the UI's opt-out model or counts drift from
        what the user sees in settings."""
        # No `enabled` key on any row.
        items = [{'provider_id': p} for p in LLM_PROVIDERS]
        assert _count_with_scan_returning(items) == len(LLM_PROVIDERS)

    def test_falls_back_to_all_llm_providers_on_scan_exception(self) -> None:
        """DynamoDB outage must not crash the dashboard — return the
        conservative count so visibility math still has a reasonable
        denominator."""
        fake = MagicMock()
        fake.Table.return_value.scan.side_effect = ProviderScanError("throttled")
        with patch.object(providers, 'get_dynamodb_resource', return_value=fake):
            count = providers.get_enabled_provider_count(table_name='test-table')
        assert count == len(LLM_PROVIDERS)
