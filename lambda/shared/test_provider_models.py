"""Tests for shared/provider_models.py — which model each provider answers with."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from shared.provider_models import (
    CONFIGURABLE_MODEL_PROVIDERS,
    ProviderConfigUnavailableError,
    configured_model,
    default_model,
    effective_model,
    is_valid_model_id,
    read_provider_model,
)


class TestIsValidModelId:
    @pytest.mark.parametrize('model', ['gpt-5.2', 'o4-mini', 'gemini-2.5-flash-lite', 'gpt-5-2025-08-07', 'a', 'x' * 100])
    def test_accepts_published_model_ids(self, model):
        assert is_valid_model_id(model) is True

    @pytest.mark.parametrize('model', [
        '', ' gpt-5', 'gpt 5', 'gemini-2.5-pro:streamGenerateContent', '../files', 'models/gemini-2.5-pro',
        '-gpt', '.hidden', 'x' * 101, None, 5, ['gpt-5'],
    ])
    def test_refuses_anything_that_could_reshape_a_request_url(self, model):
        assert is_valid_model_id(model) is False


class TestConfiguredModel:
    def test_returns_the_override_of_a_configurable_provider(self):
        assert configured_model('gemini', {'model': 'gemini-2.5-pro'}) == 'gemini-2.5-pro'

    def test_ignores_an_override_on_a_provider_without_a_model(self):
        assert configured_model('brave', {'model': 'claude-opus-9'}) is None

    def test_reads_an_override_of_perplexity(self):
        assert configured_model('perplexity', {'model': 'sonar-pro'}) == 'sonar-pro'

    def test_reads_an_override_of_claude(self):
        assert configured_model('claude', {'model': 'claude-sonnet-4-6'}) == 'claude-sonnet-4-6'

    @pytest.mark.parametrize('row', [{}, {'model': ''}, {'model': None}, {'model': 'bad id'}])
    def test_treats_a_missing_or_malformed_value_as_no_override(self, row):
        assert configured_model('openai', row) is None


class TestEffectiveModel:
    def test_prefers_the_override(self):
        assert effective_model('openai', {'model': 'gpt-5.2'}) == 'gpt-5.2'

    def test_falls_back_to_the_default(self):
        assert effective_model('openai', {}) == 'gpt-5-mini'

    @pytest.mark.parametrize(('provider_id', 'model'), [
        ('openai', 'gpt-5-mini'),
        ('perplexity', 'sonar'),
        ('gemini', 'gemini-3-flash-preview'),
        ('claude', 'claude-sonnet-4-5'),
    ])
    def test_pins_each_llm_providers_default(self, provider_id, model):
        """Changing a default silently changes every run's model; it must be a deliberate edit here."""
        assert default_model(provider_id) == model

    def test_has_no_model_for_a_search_provider(self):
        assert default_model('brave') == ''


class TestProviderSets:
    def test_every_ai_engine_model_is_configurable(self):
        assert CONFIGURABLE_MODEL_PROVIDERS == frozenset({'openai', 'perplexity', 'gemini', 'claude'})


class TestReadProviderModel:
    def test_reads_the_providers_row(self):
        table = MagicMock()
        table.get_item.return_value = {'Item': {'provider_id': 'gemini', 'model': 'gemini-2.5-pro'}}

        assert (read_provider_model(table, 'gemini'), table.get_item.call_args.kwargs) == (
            'gemini-2.5-pro', {'Key': {'provider_id': 'gemini'}},
        )

    def test_uses_the_default_when_the_provider_has_no_row(self):
        table = MagicMock()
        table.get_item.return_value = {}

        assert read_provider_model(table, 'gemini') == 'gemini-3-flash-preview'

    def test_fails_closed_when_the_row_cannot_be_read(self):
        table = MagicMock()
        table.get_item.side_effect = RuntimeError('ThrottlingException')

        with pytest.raises(ProviderConfigUnavailableError, match=r'^Cannot read model config for provider gemini$'):
            read_provider_model(table, 'gemini')

    def test_logs_the_failure_without_the_error_text(self, caplog):
        """The message names the error type only; str(error) can name tables."""
        table = MagicMock()
        table.get_item.side_effect = RuntimeError('arn:aws:dynamodb:table/secret-name')

        with caplog.at_level(logging.ERROR), pytest.raises(ProviderConfigUnavailableError):
            read_provider_model(table, 'gemini')

        assert [record.getMessage() for record in caplog.records] == [
            'provider_model_read_failed provider=gemini error=RuntimeError action=fail_closed',
        ]
