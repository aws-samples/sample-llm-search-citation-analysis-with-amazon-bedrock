"""
Tests for shared.models — role-based Bedrock model resolution and invocation.

Covers:
- Role -> default tier -> model ID resolution
- BEDROCK_TIER_<ROLE> env override
- BEDROCK_MODEL_<ROLE> direct override (wins over tier and the saved model)
- The model saved per tier in Settings (ProviderConfig ``bedrock-<tier>``):
  used, cached 60 s, fail-open on DynamoDB errors and without the table variable
- Request style: first guess, saved style, and the single self-correcting retry
- Invalid tier override falls back to default
- Thinking budget wiring per tier and per-call override
- Invocation retry/backoff on throttling
- Non-throttling errors propagate immediately
"""

import logging
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.bedrock_model_fixtures import (
    HAIKU_4_5,
    HAIKU_5_5,
    NEEDS_ADAPTIVE,
    NEEDS_BUDGET,
    OPUS_4_6,
    OPUS_5_5,
    OUTPUT_CONFIG_REFUSED,
    SONNET_4_6,
    SONNET_5_5,
    bedrock_error,
    converse_reply,
    dynamodb_over,
    refusal,
    rows_table,
    runtime_client,
    tier_row,
)
from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))

HAIKU = HAIKU_5_5
SONNET = SONNET_5_5
OPUS = OPUS_5_5
# An older model that still takes a thinking token budget and a temperature.
BUDGET_MODEL = SONNET_4_6
PROVIDER_TABLE_ENV = 'DYNAMODB_TABLE_PROVIDER_CONFIG'


def _install_client(models_module, side_effect) -> MagicMock:
    """Install a Bedrock client whose ``converse`` follows ``side_effect`` (replies and/or errors)."""
    client = runtime_client(side_effect)
    models_module._bedrock_client = client
    return client


def _converse_kwargs(models_module, role, **invoke_kwargs) -> dict:
    """The kwargs ``converse`` received for one ``invoke_bedrock("hi", role, ...)`` call."""
    client = _install_client(models_module, [converse_reply({"text": "ok"})])

    models_module.invoke_bedrock("hi", role, **invoke_kwargs)

    return client.converse.call_args.kwargs


@pytest.fixture(autouse=True)
def clear_bedrock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate each test from env pollution across tier/model overrides and the saved-model table."""
    for key in list(os.environ.keys()):
        if key.startswith(("BEDROCK_TIER_", "BEDROCK_MODEL_")):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv(PROVIDER_TABLE_ENV, raising=False)


@pytest.fixture
def models_module():
    """Execute a fresh copy of models.py so module-level state (clients, caches) is reset."""
    return load_handler_module(_HERE, 'models.py', 'models_under_test')


@pytest.fixture
def saved_rows(models_module, monkeypatch: pytest.MonkeyPatch) -> dict:
    """The ProviderConfig rows the module reads, by ``provider_id``; empty until a test adds one."""
    rows: dict = {}
    monkeypatch.setenv(PROVIDER_TABLE_ENV, 'test-provider-config')
    models_module._dynamodb_resource = dynamodb_over(rows_table(rows))
    return rows


def _provider_table(models_module) -> MagicMock:
    return models_module._dynamodb_resource.Table.return_value


# =============================================================================
# Model ID resolution
# =============================================================================

class TestModelIdResolution:
    """Resolution order: direct model env > saved tier model > tier default."""

    def test_returns_haiku_for_summarization_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.SUMMARIZATION) == (
            HAIKU
        )

    def test_returns_haiku_for_extraction_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.EXTRACTION) == (
            HAIKU
        )

    def test_returns_haiku_for_generation_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.GENERATION) == (
            HAIKU
        )

    def test_returns_sonnet_for_analysis_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == (
            SONNET
        )

    def test_returns_opus_when_tier_env_override_set_to_deep(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_ANALYSIS", "deep")
        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == (
            OPUS
        )

    def test_returns_direct_model_env_override_ignoring_tier(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_ANALYSIS", "deep")
        monkeypatch.setenv("BEDROCK_MODEL_ANALYSIS", "pinned-model-id")
        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == "pinned-model-id"

    def test_falls_back_to_role_default_when_tier_env_value_invalid(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_GENERATION", "not-a-real-tier")
        assert models_module.get_model_id(models_module.ModelRole.GENERATION) == (
            HAIKU
        )

    def test_tier_override_is_case_insensitive(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_SUMMARIZATION", "DEEP")
        assert models_module.get_model_id(models_module.ModelRole.SUMMARIZATION) == (
            OPUS
        )


class TestTierResolution:
    """get_model_tier reflects the active tier for a role."""

    def test_returns_balanced_tier_for_analysis_role_by_default(self, models_module) -> None:
        assert models_module.get_model_tier(models_module.ModelRole.ANALYSIS) == (
            models_module.ModelTier.BALANCED
        )

    def test_returns_fast_tier_for_extraction_role_by_default(self, models_module) -> None:
        assert models_module.get_model_tier(models_module.ModelRole.EXTRACTION) == (
            models_module.ModelTier.FAST
        )

    def test_research_planning_uses_the_balanced_tier_and_evaluation_the_fast_tier(self, models_module) -> None:
        assert models_module.get_model_tier(models_module.ModelRole.RESEARCH_PLANNING) == models_module.ModelTier.BALANCED
        assert models_module.get_model_tier(models_module.ModelRole.RESEARCH_EVALUATION) == models_module.ModelTier.FAST

    def test_lists_the_roles_each_tier_serves(self, models_module) -> None:
        by_tier = {tier.value: models_module.roles_for_tier(tier) for tier in models_module.ModelTier}

        assert by_tier == {
            'fast': ['summarization', 'extraction', 'generation', 'research_evaluation'],
            'balanced': ['analysis', 'research_planning'],
            'deep': [],
        }


# =============================================================================
# Saved tier models (Settings > Bedrock models)
# =============================================================================

class TestSavedTierModel:
    def test_uses_the_model_saved_for_the_roles_tier(self, models_module, saved_rows) -> None:
        saved_rows['bedrock-balanced'] = tier_row('balanced', model=OPUS_4_6, request_style='adaptive')

        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == OPUS_4_6

    def test_reads_the_row_of_the_roles_tier(self, models_module, saved_rows) -> None:
        models_module.get_model_id(models_module.ModelRole.EXTRACTION)

        _provider_table(models_module).get_item.assert_called_once_with(Key={'provider_id': 'bedrock-fast'})

    def test_follows_a_tier_env_override_to_that_tiers_saved_model(
        self, models_module, saved_rows, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        saved_rows['bedrock-deep'] = tier_row('deep', model=SONNET_4_6)
        monkeypatch.setenv("BEDROCK_TIER_SUMMARIZATION", "deep")

        assert models_module.get_model_id(models_module.ModelRole.SUMMARIZATION) == SONNET_4_6

    def test_direct_model_env_override_wins_over_the_saved_model(
        self, models_module, saved_rows, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        saved_rows['bedrock-balanced'] = tier_row('balanced', model=OPUS_4_6)
        monkeypatch.setenv("BEDROCK_MODEL_ANALYSIS", HAIKU_4_5)

        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == HAIKU_4_5

    def test_uses_the_default_when_the_tier_has_no_saved_model(self, models_module, saved_rows) -> None:
        saved_rows['bedrock-fast'] = tier_row('fast', updated_at='2026-10-08T09:00:00Z')

        assert models_module.get_model_id(models_module.ModelRole.GENERATION) == HAIKU

    @pytest.mark.parametrize('model', ['us.anthropic.claude-opus-5-5', 'global.amazon.nova-pro-v1:0', '', 42])
    def test_ignores_a_saved_model_outside_the_allowed_profiles(self, models_module, saved_rows, model) -> None:
        saved_rows['bedrock-fast'] = tier_row('fast', model=model)

        assert models_module.get_model_id(models_module.ModelRole.GENERATION) == HAIKU

    def test_uses_the_default_without_reading_when_the_table_variable_is_unset(self, models_module) -> None:
        resource = MagicMock()
        models_module._dynamodb_resource = resource

        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == SONNET
        assert resource.Table.call_count == 0

    def test_falls_back_to_the_default_when_dynamodb_fails(self, models_module, saved_rows) -> None:
        _provider_table(models_module).get_item.side_effect = bedrock_error('ProvisionedThroughputExceededException', 'slow', 'GetItem')

        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == SONNET

    def test_logs_one_warning_per_cache_period_while_dynamodb_fails(
        self, models_module, saved_rows, caplog: pytest.LogCaptureFixture,
    ) -> None:
        _provider_table(models_module).get_item.side_effect = bedrock_error('InternalServerError', 'boom', 'GetItem')

        with caplog.at_level(logging.WARNING, logger=models_module.logger.name):
            for _ in range(3):
                models_module.get_model_id(models_module.ModelRole.ANALYSIS)

        assert [record.levelno for record in caplog.records] == [logging.WARNING]

    def test_reads_the_saved_model_once_within_the_cache_period(self, models_module, saved_rows) -> None:
        saved_rows['bedrock-balanced'] = tier_row('balanced', model=OPUS_4_6)

        with patch.object(models_module, '_clock', side_effect=[100.0, 159.0]):
            models_module.get_model_id(models_module.ModelRole.ANALYSIS)
            models_module.get_model_id(models_module.ModelRole.ANALYSIS)

        assert _provider_table(models_module).get_item.call_count == 1

    def test_picks_up_a_newly_saved_model_once_the_cache_expires(self, models_module, saved_rows) -> None:
        with patch.object(models_module, '_clock', side_effect=[100.0, 160.0]):
            first = models_module.get_model_id(models_module.ModelRole.ANALYSIS)
            saved_rows['bedrock-balanced'] = tier_row('balanced', model=OPUS_4_6)
            second = models_module.get_model_id(models_module.ModelRole.ANALYSIS)

        assert (first, second) == (SONNET, OPUS_4_6)

    def test_sends_the_saved_request_style_for_the_saved_model(self, models_module, saved_rows) -> None:
        # Sonnet 4.6 accepts both styles; its first guess is budget, the saved test proved adaptive.
        saved_rows['bedrock-balanced'] = tier_row('balanced', model=SONNET_4_6, request_style='adaptive')

        kwargs = _converse_kwargs(models_module, models_module.ModelRole.ANALYSIS, max_tokens=2000)

        assert (kwargs['modelId'], kwargs['additionalModelRequestFields']) == (SONNET_4_6, _effort('medium'))


# =============================================================================
# Request style: first guess and the self-correcting retry
# =============================================================================

class TestFirstGuessStyle:
    @pytest.mark.parametrize(
        ('model_id', 'style'),
        [
            pytest.param(HAIKU_5_5, 'adaptive', id='haiku_5_5'),
            pytest.param('global.anthropic.claude-sonnet-5', 'adaptive', id='sonnet_5'),
            pytest.param('global.anthropic.claude-opus-4-7', 'adaptive', id='opus_4_7'),
            pytest.param('global.anthropic.claude-opus-4-8', 'adaptive', id='opus_4_8'),
            pytest.param('us.anthropic.claude-opus-5-5', 'adaptive', id='regional_opus_5_5'),
            pytest.param(HAIKU_4_5, 'budget', id='dated_haiku_4_5'),
            pytest.param('global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'budget', id='dated_sonnet_4_5'),
            pytest.param('global.anthropic.claude-opus-4-5-20251101-v1:0', 'budget', id='dated_opus_4_5'),
            pytest.param(OPUS_4_6, 'budget', id='versioned_opus_4_6'),
            pytest.param('anthropic.claude-3-7-sonnet-20250219-v1:0', 'budget', id='claude_3'),
            pytest.param('global.anthropic.claude-opus-6', 'adaptive', id='unknown_newer_family'),
        ],
    )
    def test_guesses_the_style_the_family_accepts(self, models_module, model_id, style) -> None:
        assert models_module.first_guess_style(model_id) == style


class TestRequestStyleRetry:
    def test_retries_once_in_adaptive_style_when_temperature_is_refused(self, models_module, monkeypatch) -> None:
        monkeypatch.setenv("BEDROCK_MODEL_GENERATION", SONNET_4_6)
        client = _install_client(models_module, [refusal(NEEDS_ADAPTIVE), converse_reply({"text": "ok"})])

        result = models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION, max_tokens=100)

        assert result == "ok"
        assert client.converse.call_args.kwargs['additionalModelRequestFields'] == _effort('low')

    @pytest.mark.parametrize('message', [NEEDS_BUDGET, OUTPUT_CONFIG_REFUSED])
    def test_retries_once_in_budget_style_when_adaptive_thinking_is_refused(self, models_module, monkeypatch, message) -> None:
        monkeypatch.setenv("BEDROCK_MODEL_ANALYSIS", 'global.anthropic.claude-opus-6')
        client = _install_client(models_module, [refusal(message), converse_reply({"text": "ok"})])

        models_module.invoke_bedrock("q", models_module.ModelRole.ANALYSIS, max_tokens=2000)

        assert client.converse.call_args.kwargs['additionalModelRequestFields'] == _budget(2000)

    def test_remembers_the_corrected_style_for_the_model(self, models_module, monkeypatch) -> None:
        monkeypatch.setenv("BEDROCK_MODEL_GENERATION", SONNET_4_6)
        client = _install_client(models_module, [
            refusal(NEEDS_ADAPTIVE), converse_reply({"text": "ok"}), converse_reply({"text": "again"}),
        ])

        models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)
        result = models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)

        assert (result, client.converse.call_count) == ("again", 3)

    def test_corrects_a_wrong_saved_style(self, models_module, saved_rows) -> None:
        saved_rows['bedrock-fast'] = tier_row('fast', model=HAIKU_4_5, request_style='adaptive')
        client = _install_client(models_module, [refusal(NEEDS_BUDGET), converse_reply({"text": "ok"})])

        models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION, max_tokens=100, temperature=0.2)

        assert client.converse.call_args.kwargs['inferenceConfig'] == {"maxTokens": 100, "temperature": 0.2}

    def test_raises_the_second_refusal_instead_of_looping(self, models_module, monkeypatch) -> None:
        monkeypatch.setenv("BEDROCK_MODEL_GENERATION", SONNET_4_6)
        client = _install_client(models_module, [refusal(NEEDS_ADAPTIVE), refusal(NEEDS_BUDGET)])

        with pytest.raises(ClientError, match="adaptive thinking is not supported"):
            models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)

        assert client.converse.call_count == 2

    def test_does_not_retry_a_refusal_that_names_the_style_already_sent(self, models_module) -> None:
        client = _install_client(models_module, [refusal(NEEDS_ADAPTIVE)])

        with pytest.raises(ClientError, match="temperature"):
            models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)

        assert client.converse.call_count == 1


# =============================================================================
# invoke_bedrock — system prompt
# =============================================================================

class TestInvokeBedrockSystemPrompt:
    def test_sends_the_system_prompt_as_the_converse_system_block(self, models_module) -> None:
        kwargs = _converse_kwargs(models_module, models_module.ModelRole.RESEARCH_EVALUATION, system="You are a researcher.")

        assert kwargs["system"] == [{"text": "You are a researcher."}]

    def test_omits_the_system_block_when_no_system_prompt_is_given(self, models_module) -> None:
        kwargs = _converse_kwargs(models_module, models_module.ModelRole.RESEARCH_EVALUATION)

        assert "system" not in kwargs


# =============================================================================
# invoke_bedrock — request shape per model generation
# =============================================================================

_ADAPTIVE = {"thinking": {"type": "adaptive"}}


def _effort(level: str) -> dict:
    """The extra fields of an adaptive-thinking call at ``level`` effort."""
    return {**_ADAPTIVE, "output_config": {"effort": level}}


def _budget(tokens: int) -> dict:
    """The extra fields of a token-budget thinking call."""
    return {"thinking": {"type": "enabled", "budget_tokens": tokens}}


class TestInvokeBedrockRequestShape:
    """
    The 5.5 models refuse ``temperature`` and token budgets and think
    adaptively, steered by effort; reasoning counts against maxTokens, so each
    effort adds headroom. Older models pinned with BEDROCK_MODEL_<ROLE> keep
    the budget shape, which needs temperature 1 while thinking.
    """

    @pytest.mark.parametrize(
        ('env', 'role', 'call', 'inference', 'extra'),
        [
            pytest.param({}, 'GENERATION', {'max_tokens': 1200, 'temperature': 0.3},
                         {"maxTokens": 2200}, _effort("low"), id='fast_tier_low_effort_no_temperature'),
            pytest.param({}, 'ANALYSIS', {'max_tokens': 2000},
                         {"maxTokens": 6000}, _effort("medium"), id='balanced_tier_medium_effort'),
            pytest.param({'BEDROCK_TIER_ANALYSIS': 'deep'}, 'ANALYSIS', {'max_tokens': 2000},
                         {"maxTokens": 18000}, _effort("high"), id='deep_tier_high_effort'),
            pytest.param({}, 'ANALYSIS', {'max_tokens': 2000, 'thinking': False},
                         {"maxTokens": 3000}, _effort("low"), id='thinking_off_is_low_effort'),
            pytest.param({}, 'GENERATION', {'max_tokens': 2000, 'thinking': True},
                         {"maxTokens": 6000}, _effort("medium"), id='thinking_forced_on_for_fast_tier'),
            pytest.param({'BEDROCK_MODEL_ANALYSIS': 'us.anthropic.claude-opus-5-5'}, 'ANALYSIS', {'max_tokens': 2000},
                         {"maxTokens": 6000}, _effort("medium"), id='regional_5_5_override_is_adaptive'),
            pytest.param({'BEDROCK_MODEL_GENERATION': BUDGET_MODEL}, 'GENERATION', {'max_tokens': 1200, 'temperature': 0.3},
                         {"maxTokens": 1200, "temperature": 0.3}, None, id='older_model_fast_tier_keeps_temperature'),
            pytest.param({'BEDROCK_MODEL_ANALYSIS': BUDGET_MODEL}, 'ANALYSIS', {'max_tokens': 2000, 'temperature': 0},
                         {"maxTokens": 4000, "temperature": 1.0}, _budget(2000), id='older_model_balanced_budget'),
            pytest.param({'BEDROCK_MODEL_ANALYSIS': BUDGET_MODEL, 'BEDROCK_TIER_ANALYSIS': 'deep'}, 'ANALYSIS', {'max_tokens': 2000},
                         {"maxTokens": 10000, "temperature": 1.0}, _budget(8000), id='older_model_deep_budget'),
            pytest.param({'BEDROCK_MODEL_ANALYSIS': BUDGET_MODEL}, 'ANALYSIS', {'max_tokens': 2000, 'thinking': False},
                         {"maxTokens": 2000, "temperature": 0.0}, None, id='older_model_thinking_off'),
            pytest.param({'BEDROCK_MODEL_GENERATION': BUDGET_MODEL}, 'GENERATION', {'max_tokens': 2000, 'thinking': True},
                         {"maxTokens": 4000, "temperature": 1.0}, _budget(2000), id='older_model_thinking_forced_on'),
        ],
    )
    def test_sends_the_request_shape_the_model_accepts(
        self, models_module, monkeypatch: pytest.MonkeyPatch, env, role, call, inference, extra,
    ) -> None:
        for name, value in env.items():
            monkeypatch.setenv(name, value)

        kwargs = _converse_kwargs(models_module, models_module.ModelRole[role], **call)

        assert (kwargs["inferenceConfig"], kwargs.get("additionalModelRequestFields")) == (inference, extra)


# =============================================================================
# invoke_bedrock — response extraction
# =============================================================================

class TestInvokeBedrockResponseExtraction:
    @pytest.mark.parametrize(
        ('blocks', 'role', 'expected'),
        [
            pytest.param([{"text": "hello world"}], 'GENERATION', "hello world", id='first_text_block'),
            pytest.param(
                [{"reasoningContent": {"reasoningText": {"text": "thinking..."}}}, {"text": "final answer"}],
                'ANALYSIS',
                "final answer",
                id='reasoning_blocks_skipped',
            ),
            pytest.param([{"reasoningContent": {"reasoningText": {"text": "only thoughts"}}}], 'GENERATION', "",
                         id='no_text_block_empty_string'),
        ],
    )
    def test_returns_the_text_of_the_first_text_block(self, models_module, blocks, role, expected) -> None:
        _install_client(models_module, [converse_reply(*blocks)])

        result = models_module.invoke_bedrock("q", models_module.ModelRole[role])

        assert result == expected


# =============================================================================
# invoke_bedrock — retry behavior
# =============================================================================

class TestInvokeBedrockRetry:
    def test_retries_on_throttling_exception_then_succeeds(self, models_module) -> None:
        client = _install_client(models_module, [
            bedrock_error("ThrottlingException", "slow down"),
            converse_reply({"text": "ok"}),
        ])

        with patch.object(models_module.time, "sleep"):
            result = models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=3,
            )

        assert result == "ok"
        assert client.converse.call_count == 2

    def test_reraises_the_last_throttling_error_when_all_retries_throttled(
        self, models_module,
    ) -> None:
        """The last attempt's raw exception propagates unwrapped, so callers see the provider's code."""
        client = _install_client(models_module, bedrock_error("ThrottlingException", "slow"))

        with (
            patch.object(models_module.time, "sleep"),
            pytest.raises(ClientError, match="ThrottlingException"),
        ):
            models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=2,
            )

        assert client.converse.call_count == 2

    def test_propagates_non_throttling_errors_without_retry(self, models_module) -> None:
        client = _install_client(models_module, bedrock_error("ValidationException", "bad input"))

        with pytest.raises(ClientError, match="ValidationException"):
            models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=3,
            )

        assert client.converse.call_count == 1
