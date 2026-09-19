"""
Tests for shared.env_vars.resolve_table_env.

This helper drives the DynamoDB env-var naming migration (audit #12). The
Python code reads the canonical ``DYNAMODB_TABLE_*`` name first, falling
back to any legacy names passed in, which lets the Python + CDK rollouts
deploy in either order without a cold-start failure.

These tests pin:
- Canonical name takes priority even when legacy is set
- Legacy name resolves when canonical is missing
- KeyError raised when required and nothing resolves
- Default returned when optional and nothing resolves
- Empty-string env vars count as unset (truthy check)
- Enforces the DYNAMODB_TABLE_ prefix contract to prevent misuse
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from shared import env_vars


class TestResolveTableEnv:
    def test_returns_canonical_value_when_only_canonical_set(self) -> None:
        with patch.dict(os.environ, {'DYNAMODB_TABLE_FOO': 'canonical-foo'}, clear=True):
            result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', 'FOO_LEGACY')
        assert result == 'canonical-foo'

    def test_returns_canonical_value_when_both_set(self) -> None:
        """Regression guard: canonical MUST take priority, otherwise
        deploying the new Python code with both env vars set would still
        resolve to the legacy value and the migration would stall."""
        with patch.dict(os.environ, {
            'DYNAMODB_TABLE_FOO': 'canonical-foo',
            'FOO_LEGACY': 'legacy-foo',
        }, clear=True):
            result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', 'FOO_LEGACY')
        assert result == 'canonical-foo'

    def test_returns_legacy_value_when_only_legacy_set(self) -> None:
        """The transitional case: CDK deploys first with both env vars
        set, Python rolls out later — until then the Lambda must keep
        working with only the legacy name."""
        with patch.dict(os.environ, {'FOO_LEGACY': 'legacy-foo'}, clear=True):
            result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', 'FOO_LEGACY')
        assert result == 'legacy-foo'

    def test_returns_first_legacy_name_when_multiple_fallbacks(self) -> None:
        """Priority: canonical, then each legacy in order."""
        with patch.dict(os.environ, {'SECOND_LEGACY': 'second'}, clear=True):
            result = env_vars.resolve_table_env(
                'DYNAMODB_TABLE_FOO', 'FIRST_LEGACY', 'SECOND_LEGACY',
            )
        assert result == 'second'

        with patch.dict(os.environ, {
            'FIRST_LEGACY': 'first',
            'SECOND_LEGACY': 'second',
        }, clear=True):
            result = env_vars.resolve_table_env(
                'DYNAMODB_TABLE_FOO', 'FIRST_LEGACY', 'SECOND_LEGACY',
            )
        assert result == 'first'

    def test_raises_key_error_when_required_and_nothing_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(KeyError) as excinfo:
                env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', 'FOO_LEGACY')
        # Error message should mention every candidate so ops can fix the
        # CDK stack without guessing.
        assert 'DYNAMODB_TABLE_FOO' in str(excinfo.value)
        assert 'FOO_LEGACY' in str(excinfo.value)

    def test_returns_default_when_optional_and_nothing_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            result = env_vars.resolve_table_env(
                'DYNAMODB_TABLE_FOO', 'FOO_LEGACY',
                required=False, default='default-value',
            )
        assert result == 'default-value'

    def test_returns_none_when_optional_no_default_and_nothing_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            result = env_vars.resolve_table_env(
                'DYNAMODB_TABLE_FOO', 'FOO_LEGACY', required=False,
            )
        assert result is None

    def test_treats_empty_string_env_var_as_unset(self) -> None:
        """DynamoDB table names can't be empty. An empty-string env var
        is almost certainly a deployment accident (unset variable
        substitution in a shell) — fall through to the next candidate."""
        with patch.dict(os.environ, {
            'DYNAMODB_TABLE_FOO': '',
            'FOO_LEGACY': 'legacy-foo',
        }, clear=True):
            result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', 'FOO_LEGACY')
        assert result == 'legacy-foo'

    def test_rejects_non_prefixed_canonical_name(self) -> None:
        """The helper enforces the DYNAMODB_TABLE_ prefix on the canonical
        arg. Accepting any name would defeat the whole point of the
        naming-consistency migration."""
        with pytest.raises(ValueError, match="must use the DYNAMODB_TABLE_ prefix; got 'FOO_TABLE'"):
            env_vars.resolve_table_env('FOO_TABLE', 'FOO_LEGACY')
