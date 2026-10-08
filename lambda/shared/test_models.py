"""
Tests for shared.models — role-based Bedrock model resolution and invocation.

Covers:
- Role -> default tier -> model ID resolution
- BEDROCK_TIER_<ROLE> env override
- BEDROCK_MODEL_<ROLE> direct override (wins over tier)
- Invalid tier override falls back to default
- Thinking budget wiring per tier and per-call override
- Invocation retry/backoff on throttling
- Non-throttling errors propagate immediately
"""

import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))

HAIKU = "global.anthropic.claude-haiku-5-5"
SONNET = "global.anthropic.claude-sonnet-5-5"
OPUS = "global.anthropic.claude-opus-5-5"
# An older model that still takes a thinking token budget and a temperature.
BUDGET_MODEL = "global.anthropic.claude-sonnet-4-6"


def _bedrock_error(code: str, message: str) -> ClientError:
    """The ``ClientError`` boto3 raises when ``converse`` fails with ``code``."""
    return ClientError({'Error': {'Code': code, 'Message': message}}, 'Converse')


def _converse_reply(*blocks: dict) -> dict:
    """A ``converse`` response whose message holds ``blocks``."""
    return {"output": {"message": {"content": list(blocks)}}}


def _install_client(models_module, side_effect) -> MagicMock:
    """Install a Bedrock client whose ``converse`` follows ``side_effect`` (replies and/or errors)."""
    client = MagicMock()
    client.converse.side_effect = side_effect
    models_module._bedrock_client = client
    return client


def _converse_kwargs(models_module, role, **invoke_kwargs) -> dict:
    """The kwargs ``converse`` received for one ``invoke_bedrock("hi", role, ...)`` call."""
    client = _install_client(models_module, [_converse_reply({"text": "ok"})])

    models_module.invoke_bedrock("hi", role, **invoke_kwargs)

    return client.converse.call_args.kwargs


@pytest.fixture(autouse=True)
def clear_bedrock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate each test from env pollution across tier/model overrides."""
    for key in list(os.environ.keys()):
        if key.startswith("BEDROCK_TIER_") or key.startswith("BEDROCK_MODEL_"):
            monkeypatch.delenv(key, raising=False)


@pytest.fixture
def models_module():
    """Execute a fresh copy of models.py so module-level state (the lazy client) is reset."""
    return load_handler_module(_HERE, 'models.py', 'models_under_test')


# =============================================================================
# Model ID resolution
# =============================================================================

class TestModelIdResolution:
    """Resolution order: direct model env > tier env > role default."""

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
            pytest.param([], 'GENERATION', "", id='no_content_blocks_empty_string'),
        ],
    )
    def test_returns_the_text_of_the_first_text_block(self, models_module, blocks, role, expected) -> None:
        _install_client(models_module, [_converse_reply(*blocks)])

        result = models_module.invoke_bedrock("q", models_module.ModelRole[role])

        assert result == expected


# =============================================================================
# invoke_bedrock — retry behavior
# =============================================================================

class TestInvokeBedrockRetry:
    def test_retries_on_throttling_exception_then_succeeds(self, models_module) -> None:
        client = _install_client(models_module, [
            _bedrock_error("ThrottlingException", "slow down"),
            _converse_reply({"text": "ok"}),
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
        client = _install_client(models_module, _bedrock_error("ThrottlingException", "slow"))

        with (
            patch.object(models_module.time, "sleep"),
            pytest.raises(ClientError, match="ThrottlingException"),
        ):
            models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=2,
            )

        assert client.converse.call_count == 2

    def test_propagates_non_throttling_errors_without_retry(self, models_module) -> None:
        client = _install_client(models_module, _bedrock_error("ValidationException", "bad input"))

        with pytest.raises(ClientError, match="ValidationException"):
            models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=3,
            )

        assert client.converse.call_count == 1
