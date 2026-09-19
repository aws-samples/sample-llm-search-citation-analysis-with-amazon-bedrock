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
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(autouse=True)
def clear_bedrock_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Isolate each test from env pollution across tier/model overrides."""
    for key in list(os.environ.keys()):
        if key.startswith("BEDROCK_TIER_") or key.startswith("BEDROCK_MODEL_"):
            monkeypatch.delenv(key, raising=False)
    yield


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
            "global.anthropic.claude-haiku-4-5-20251001-v1:0"
        )

    def test_returns_haiku_for_extraction_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.EXTRACTION) == (
            "global.anthropic.claude-haiku-4-5-20251001-v1:0"
        )

    def test_returns_haiku_for_generation_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.GENERATION) == (
            "global.anthropic.claude-haiku-4-5-20251001-v1:0"
        )

    def test_returns_sonnet_for_analysis_role_by_default(self, models_module) -> None:
        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == (
            "global.anthropic.claude-sonnet-4-6"
        )

    def test_returns_opus_when_tier_env_override_set_to_deep(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_ANALYSIS", "deep")
        assert models_module.get_model_id(models_module.ModelRole.ANALYSIS) == (
            "global.anthropic.claude-opus-4-7"
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
            "global.anthropic.claude-haiku-4-5-20251001-v1:0"
        )

    def test_tier_override_is_case_insensitive(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_SUMMARIZATION", "DEEP")
        assert models_module.get_model_id(models_module.ModelRole.SUMMARIZATION) == (
            "global.anthropic.claude-opus-4-7"
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
    def _client(self) -> MagicMock:
        client = MagicMock()
        client.converse.return_value = {"output": {"message": {"content": [{"text": "ok"}]}}}
        return client

    def test_sends_the_system_prompt_as_the_converse_system_block(self, models_module) -> None:
        client = self._client()
        models_module._bedrock_client = client

        models_module.invoke_bedrock("hi", models_module.ModelRole.RESEARCH_EVALUATION, system="You are a researcher.")

        assert client.converse.call_args.kwargs["system"] == [{"text": "You are a researcher."}]

    def test_omits_the_system_block_when_no_system_prompt_is_given(self, models_module) -> None:
        client = self._client()
        models_module._bedrock_client = client

        models_module.invoke_bedrock("hi", models_module.ModelRole.RESEARCH_EVALUATION)

        assert "system" not in client.converse.call_args.kwargs


# =============================================================================
# invoke_bedrock — thinking budget
# =============================================================================

class TestInvokeBedrockThinkingBudget:
    """Thinking budget wiring for Converse API."""

    def _mock_converse_success(self, text: str = "ok") -> MagicMock:
        client = MagicMock()
        client.converse.return_value = {
            "output": {"message": {"content": [{"text": text}]}}
        }
        return client

    def _converse_kwargs(self, models_module, role, **invoke_kwargs) -> dict:
        """The kwargs ``converse`` received for one ``invoke_bedrock("hi", role, ...)`` call."""
        client = self._mock_converse_success()
        models_module._bedrock_client = client

        models_module.invoke_bedrock("hi", role, **invoke_kwargs)

        return client.converse.call_args.kwargs

    def test_omits_additional_fields_when_tier_is_fast(self, models_module) -> None:
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.GENERATION)

        assert "additionalModelRequestFields" not in kwargs

    def test_includes_thinking_budget_when_tier_is_balanced(self, models_module) -> None:
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.ANALYSIS)

        assert kwargs["additionalModelRequestFields"] == {"thinking": {"type": "enabled", "budget_tokens": 2000}}

    def test_forces_temperature_one_and_grows_max_tokens_when_thinking_is_on(self, models_module) -> None:
        """
        Anthropic rejects thinking with any temperature but 1 and counts the
        budget against maxTokens. With temperature 0 (every ANALYSIS caller)
        the balanced tier answered a ValidationException on every call.
        """
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.ANALYSIS, max_tokens=2000, temperature=0)

        assert kwargs["inferenceConfig"] == {"maxTokens": 4000, "temperature": 1.0}

    def test_keeps_the_callers_temperature_when_thinking_is_off(self, models_module) -> None:
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.GENERATION, max_tokens=1200, temperature=0.3)

        assert kwargs["inferenceConfig"] == {"maxTokens": 1200, "temperature": 0.3}

    def test_uses_deep_budget_when_tier_override_set_to_deep(
        self, models_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("BEDROCK_TIER_ANALYSIS", "deep")

        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.ANALYSIS)

        assert kwargs["additionalModelRequestFields"] == {"thinking": {"type": "enabled", "budget_tokens": 8000}}

    def test_disables_thinking_when_caller_passes_thinking_false(self, models_module) -> None:
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.ANALYSIS, thinking=False)

        assert "additionalModelRequestFields" not in kwargs

    def test_enables_thinking_when_caller_forces_on_for_fast_tier(self, models_module) -> None:
        kwargs = self._converse_kwargs(models_module, models_module.ModelRole.GENERATION, thinking=True)

        assert kwargs["additionalModelRequestFields"] == {"thinking": {"type": "enabled", "budget_tokens": 2000}}


# =============================================================================
# invoke_bedrock — response extraction
# =============================================================================

class TestInvokeBedrockResponseExtraction:
    def test_returns_text_from_first_text_block(self, models_module) -> None:
        client = MagicMock()
        client.converse.return_value = {
            "output": {"message": {"content": [{"text": "hello world"}]}}
        }
        models_module._bedrock_client = client

        result = models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)
        assert result == "hello world"

    def test_skips_reasoning_blocks_and_returns_text_block(self, models_module) -> None:
        client = MagicMock()
        client.converse.return_value = {
            "output": {
                "message": {
                    "content": [
                        {"reasoningContent": {"reasoningText": {"text": "thinking..."}}},
                        {"text": "final answer"},
                    ]
                }
            }
        }
        models_module._bedrock_client = client

        result = models_module.invoke_bedrock("q", models_module.ModelRole.ANALYSIS)
        assert result == "final answer"

    def test_returns_empty_string_when_no_content_blocks(self, models_module) -> None:
        client = MagicMock()
        client.converse.return_value = {"output": {"message": {"content": []}}}
        models_module._bedrock_client = client

        result = models_module.invoke_bedrock("q", models_module.ModelRole.GENERATION)
        assert result == ""


# =============================================================================
# invoke_bedrock — retry behavior
# =============================================================================

class TestInvokeBedrockRetry:
    def test_retries_on_throttling_exception_then_succeeds(self, models_module) -> None:
        client = MagicMock()
        client.converse.side_effect = [
            Exception("ThrottlingException: slow down"),
            {"output": {"message": {"content": [{"text": "ok"}]}}},
        ]
        models_module._bedrock_client = client

        with patch.object(models_module.time, "sleep"):
            result = models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=3,
            )

        assert result == "ok"
        assert client.converse.call_count == 2

    def test_raises_bedrock_invocation_error_when_all_retries_throttled(
        self, models_module,
    ) -> None:
        client = MagicMock()
        client.converse.side_effect = Exception("ThrottlingException: slow")
        models_module._bedrock_client = client

        with patch.object(models_module.time, "sleep"):
            with pytest.raises(Exception) as excinfo:
                models_module.invoke_bedrock(
                    "q", models_module.ModelRole.GENERATION, max_retries=2,
                )

        # Last attempt's raw exception is re-raised (not wrapped) per implementation
        assert "ThrottlingException" in str(excinfo.value)

    def test_propagates_non_throttling_errors_without_retry(self, models_module) -> None:
        client = MagicMock()
        client.converse.side_effect = Exception("ValidationException: bad input")
        models_module._bedrock_client = client

        with pytest.raises(Exception) as excinfo:
            models_module.invoke_bedrock(
                "q", models_module.ModelRole.GENERATION, max_retries=3,
            )

        assert "ValidationException" in str(excinfo.value)
        assert client.converse.call_count == 1
