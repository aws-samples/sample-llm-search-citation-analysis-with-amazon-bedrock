"""
Tests for shared.env_vars.resolve_table_env.

This helper enforces the canonical ``DYNAMODB_TABLE_*`` env-var naming
(audit #12).

These tests pin:
- The canonical value is returned when set
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


def _resolve_foo(environ: dict[str, str]) -> str:
    """Resolve the required ``DYNAMODB_TABLE_FOO`` with exactly ``environ`` set."""
    with patch.dict(os.environ, environ, clear=True):
        return env_vars.resolve_table_env('DYNAMODB_TABLE_FOO')


@pytest.fixture
def empty_environ():
    """No environment variable set for the duration of the test."""
    with patch.dict(os.environ, {}, clear=True):
        yield


class TestResolveTableEnv:
    def test_returns_canonical_value_when_set(self) -> None:
        assert _resolve_foo({'DYNAMODB_TABLE_FOO': 'canonical-foo'}) == 'canonical-foo'

    def test_raises_key_error_naming_the_variable_when_required_and_unset(self) -> None:
        # The message names the variable so ops can fix the CDK stack
        # without guessing.
        with pytest.raises(KeyError, match='DYNAMODB_TABLE_FOO is not set'):
            _resolve_foo({})

    @pytest.mark.usefixtures('empty_environ')
    def test_returns_default_when_optional_and_nothing_set(self) -> None:
        result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', required=False, default='default-value')
        assert result == 'default-value'

    @pytest.mark.usefixtures('empty_environ')
    def test_returns_none_when_optional_no_default_and_nothing_set(self) -> None:
        assert env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', required=False) is None

    def test_treats_empty_string_env_var_as_unset(self) -> None:
        """DynamoDB table names can't be empty. An empty-string env var
        is almost certainly a deployment accident (unset variable
        substitution in a shell)."""
        with pytest.raises(KeyError, match='DYNAMODB_TABLE_FOO is not set'):
            _resolve_foo({'DYNAMODB_TABLE_FOO': ''})

    def test_returns_default_for_empty_string_when_optional(self) -> None:
        with patch.dict(os.environ, {'DYNAMODB_TABLE_FOO': ''}, clear=True):
            result = env_vars.resolve_table_env('DYNAMODB_TABLE_FOO', required=False, default='default-value')
        assert result == 'default-value'

    def test_rejects_non_prefixed_canonical_name(self) -> None:
        """The helper enforces the DYNAMODB_TABLE_ prefix on the canonical
        arg. Accepting any name would defeat the whole point of the
        naming-consistency migration."""
        with pytest.raises(ValueError, match="must use the DYNAMODB_TABLE_ prefix; got 'FOO_TABLE'"):
            env_vars.resolve_table_env('FOO_TABLE')
