"""
Tests for shared.secrets.get_api_key.

The helper replaces the two divergent ``get_secret`` copies from
``search/handler.py`` and ``api/keyword-research.py`` (bugs.md 1.2). These
tests pin the consolidated contract both callers now rely on:

- JSON ``{"api_key": ...}`` secrets and raw plain-string secrets both work
  (the old search copy silently disabled providers with raw secrets)
- The ``'placeholder'`` sentinel and empty values return None so
  unconfigured providers are skipped, never called with a bogus key
- ``SECRETS_PREFIX`` is read from the environment per call and prepended
- Lookup failures return None and log the exception type only — never the
  secret value or exception message
- Results are cached for the TTL; None results are never cached

Note: imported as ``shared.secrets`` rather than by bare module name like
sibling tests — a top-level ``secrets`` module would shadow the Python
stdlib ``secrets`` for the rest of the pytest session.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared import secrets

_PREFIX = 'test-prefix/'


class FakeClientError(Exception):
    """Stand-in for a botocore ClientError without the botocore dependency."""


def _client_returning(secret_string: str) -> MagicMock:
    """Build a fake Secrets Manager client returning `secret_string`."""
    client = MagicMock()
    client.get_secret_value.return_value = {'SecretString': secret_string}
    return client


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    """Clear the module cache and pin SECRETS_PREFIX around each test."""
    secrets._cache.clear()
    monkeypatch.setenv('SECRETS_PREFIX', _PREFIX)
    yield
    secrets._cache.clear()


class TestSecretFormats:
    def test_returns_api_key_when_secret_is_json_with_api_key_field(self):
        client = _client_returning(json.dumps({'api_key': 'sk-json-123'}))
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') == 'sk-json-123'

    def test_returns_raw_string_when_secret_is_not_json(self):
        client = _client_returning('sk-raw-456')
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') == 'sk-raw-456'

    def test_returns_none_when_json_secret_has_no_api_key_field(self):
        """A structured secret without the expected field is misconfigured —
        the raw JSON blob must not be handed to a provider as a key."""
        client = _client_returning(json.dumps({'token': 'sk-wrong-field'}))
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None


class TestUnconfiguredProviders:
    """Falsy returns let callers skip providers instead of calling them
    with a bogus key (the old search copy's skip behavior, preserved)."""

    def test_returns_none_when_raw_secret_is_placeholder(self):
        client = _client_returning('placeholder')
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_returns_none_when_json_api_key_is_placeholder(self):
        client = _client_returning(json.dumps({'api_key': 'placeholder'}))
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_returns_none_when_secret_string_is_empty(self):
        client = _client_returning('')
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_returns_none_when_json_api_key_is_empty(self):
        client = _client_returning(json.dumps({'api_key': ''}))
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_returns_none_when_response_has_no_secret_string(self):
        """Binary-only secrets carry no SecretString key at all."""
        client = MagicMock()
        client.get_secret_value.return_value = {'SecretBinary': b'\x00'}
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_returns_none_when_lookup_raises(self):
        client = MagicMock()
        client.get_secret_value.side_effect = FakeClientError('ResourceNotFound')
        with patch.object(secrets, '_secrets_client', client):
            assert secrets.get_api_key('openai-key') is None

    def test_logs_exception_type_only_when_lookup_fails(self, caplog):
        """Exception messages can carry ARNs or values — only the type name
        may reach the logs, at warning level."""
        client = MagicMock()
        client.get_secret_value.side_effect = FakeClientError('arn:aws:secretsmanager:us-east-1 sk-leaked-value')
        with patch.object(secrets, '_secrets_client', client), \
             caplog.at_level(logging.WARNING, logger='shared.secrets'):
            secrets.get_api_key('openai-key')

        messages = [record.getMessage() for record in caplog.records]
        assert any('FakeClientError' in message for message in messages)
        assert all('sk-leaked-value' not in message for message in messages)


class TestPrefixing:
    def test_prepends_secrets_prefix_env_var_to_secret_id(self):
        client = _client_returning('sk-raw')
        with patch.object(secrets, '_secrets_client', client):
            secrets.get_api_key('gemini-key')
        client.get_secret_value.assert_called_once_with(SecretId='test-prefix/gemini-key')

    def test_uses_default_prefix_when_env_var_unset(self, monkeypatch):
        monkeypatch.delenv('SECRETS_PREFIX', raising=False)
        client = _client_returning('sk-raw')
        with patch.object(secrets, '_secrets_client', client):
            secrets.get_api_key('openai-key')
        client.get_secret_value.assert_called_once_with(SecretId='citation-analysis/openai-key')


class TestCaching:
    def test_serves_second_call_within_ttl_from_cache(self):
        client = _client_returning('sk-cached')
        with patch.object(secrets, '_secrets_client', client):
            first = secrets.get_api_key('openai-key')
            second = secrets.get_api_key('openai-key')
        assert first == 'sk-cached'
        assert second == 'sk-cached'
        client.get_secret_value.assert_called_once_with(SecretId=f'{_PREFIX}openai-key')

    def test_refetches_when_cache_ttl_expired(self, monkeypatch):
        client = _client_returning('sk-v1')
        clock = {'now': 1_000_000.0}
        monkeypatch.setattr(time, 'time', lambda: clock['now'])

        with patch.object(secrets, '_secrets_client', client):
            secrets.get_api_key('openai-key')
            clock['now'] += secrets.CACHE_TTL_SECONDS + 1
            client.get_secret_value.return_value = {'SecretString': 'sk-v2'}
            refreshed = secrets.get_api_key('openai-key')

        assert refreshed == 'sk-v2'
        assert client.get_secret_value.call_count == 2

    def test_does_not_cache_none_results(self):
        """A provider configured mid-flight must be picked up on the next
        lookup — the old keyword-research copy cached 'placeholder'."""
        client = MagicMock()
        client.get_secret_value.side_effect = [
            {'SecretString': 'placeholder'},
            {'SecretString': 'sk-now-configured'},
        ]
        with patch.object(secrets, '_secrets_client', client):
            first = secrets.get_api_key('openai-key')
            second = secrets.get_api_key('openai-key')
        assert first is None
        assert second == 'sk-now-configured'
