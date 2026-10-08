"""
Centralized Bedrock model resolution and invocation.

Single source of truth for:
- Bedrock Anthropic global inference profile IDs
- Role-to-tier mapping (SUMMARIZATION/EXTRACTION/GENERATION/ANALYSIS)
- Tier definitions (FAST/BALANCED/DEEP -> Haiku/Sonnet/Opus)
- Extended thinking budget per tier
- Shared Converse invocation with retry/backoff

Resolution order for model ID:
1. Direct per-role override env var:  BEDROCK_MODEL_<ROLE>
2. Per-role tier override env var:    BEDROCK_TIER_<ROLE>  (fast|balanced|deep)
3. Hardcoded role-default tier

Resolution order for thinking budget:
1. Explicit `thinking` arg passed to invoke_bedrock()
2. Tier default from _TIER_THINKING

Note on inference profile IDs (verified via `aws bedrock list-inference-profiles`):
AWS uses inconsistent ID formats. Some profiles include the `-YYYYMMDD-v1:0`
suffix (Haiku 4.5), others do not (the 5.5 family). Treat the strings as
opaque identifiers — do not parse or regex over them.

Request shapes (verified with live Converse calls, 2026-10-08): the Claude 5.5
models refuse `temperature` and `top_p` ("deprecated for this model") and
`thinking.type.enabled` with a token budget; they think adaptively, steered by
`output_config.effort` (low | medium | high | xhigh). They also think when no
`thinking` field is sent at all, so every call names an effort. Older models
(a `BEDROCK_MODEL_<ROLE>` override such as Sonnet 4.6) keep the budget shape.
"""

import logging
import os
import random
import time
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

import boto3

logger = logging.getLogger(__name__)


class ModelRole(StrEnum):
    """Task-specific role for a Bedrock call."""

    SUMMARIZATION = "summarization"  # Crawler page summaries + SEO extraction
    EXTRACTION = "extraction"        # Brand mention extraction
    GENERATION = "generation"        # Content studio article generation
    ANALYSIS = "analysis"            # Recommendations, brand expansion, reasoning
    RESEARCH_PLANNING = "research_planning"      # Research agent: plan queries, select the final list
    RESEARCH_EVALUATION = "research_evaluation"  # Research agent: judge a round, decide continue/stop


class ModelTier(StrEnum):
    """Capability tier that maps to a specific model family."""

    FAST = "fast"          # Haiku — low latency, low cost
    BALANCED = "balanced"  # Sonnet — good reasoning, moderate latency
    DEEP = "deep"          # Opus — deep reasoning, higher latency


# Current global inference profile IDs (verified 2026-10-08).
# To upgrade a family, change the single line here and redeploy.
_TIER_MODELS: dict[ModelTier, str] = {
    ModelTier.FAST: "global.anthropic.claude-haiku-5-5",
    ModelTier.BALANCED: "global.anthropic.claude-sonnet-5-5",
    ModelTier.DEEP: "global.anthropic.claude-opus-5-5",
}

# Models that think adaptively (effort instead of a token budget, no sampling
# parameters), in every form a BEDROCK_MODEL_<ROLE> override may name them.
_ADAPTIVE_THINKING_MODELS: frozenset[str] = frozenset(
    f"{prefix}anthropic.claude-{family}-5-5"
    for prefix in ("global.", "us.", "")
    for family in ("haiku", "sonnet", "opus")
)

# Role -> default tier. Overridable per-role via BEDROCK_TIER_<ROLE>.
_ROLE_DEFAULT_TIER: dict[ModelRole, ModelTier] = {
    ModelRole.SUMMARIZATION: ModelTier.FAST,
    ModelRole.EXTRACTION: ModelTier.FAST,
    ModelRole.GENERATION: ModelTier.FAST,
    ModelRole.ANALYSIS: ModelTier.BALANCED,
    ModelRole.RESEARCH_PLANNING: ModelTier.BALANCED,
    ModelRole.RESEARCH_EVALUATION: ModelTier.FAST,
}

# Extended thinking budget (tokens) per tier, for models that take a budget
# (older overrides). 0 disables thinking.
_TIER_THINKING_BUDGET: dict[ModelTier, int] = {
    ModelTier.FAST: 0,
    ModelTier.BALANCED: 2000,
    ModelTier.DEEP: 8000,
}

# Adaptive-thinking effort per tier, and for a call that turns thinking off
# (the 5.5 models cannot all switch it off; "low" thinks only when needed).
_THINKING_OFF_EFFORT = "low"
_TIER_EFFORT: dict[ModelTier, str] = {
    ModelTier.FAST: _THINKING_OFF_EFFORT,
    ModelTier.BALANCED: "medium",
    ModelTier.DEEP: "high",
}

# Extra maxTokens per effort: adaptive reasoning counts against maxTokens, so
# the caller's answer budget would otherwise be eaten by the thinking.
_EFFORT_HEADROOM: dict[str, int] = {
    "low": 1000,
    "medium": 4000,
    "high": 16000,
}

# Throttling error class names that should trigger retry.
_THROTTLE_ERRORS = (
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
)


def _resolve_tier(role: ModelRole) -> ModelTier:
    """Resolve tier for a role: env override wins, else role default."""
    override = os.environ.get(f"BEDROCK_TIER_{role.value.upper()}")
    if override:
        try:
            return ModelTier(override.lower())
        except ValueError:
            logger.warning(
                "Invalid BEDROCK_TIER_%s value %r, falling back to default",
                role.value.upper(),
                override,
            )
    return _ROLE_DEFAULT_TIER[role]


def get_model_id(role: ModelRole) -> str:
    """Resolve the Bedrock model ID for a given role."""
    direct = os.environ.get(f"BEDROCK_MODEL_{role.value.upper()}")
    if direct:
        return direct
    return _TIER_MODELS[_resolve_tier(role)]


def get_model_tier(role: ModelRole) -> ModelTier:
    """Resolve the active tier for a role (useful for response metadata)."""
    return _resolve_tier(role)


# Lazily initialized module-level Bedrock client. No region needed for
# global inference profiles.
_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime")
    return _bedrock_client


class BedrockInvocationError(RuntimeError):
    """Raised when Bedrock invocation fails after all retries."""


def invoke_bedrock(
    prompt: str,
    role: ModelRole,
    max_tokens: int = 2000,
    temperature: float = 0.0,
    max_retries: int = 5,
    thinking: bool | None = None,
    system: str | None = None,
) -> str:
    """
    Invoke Bedrock Converse API with exponential backoff on throttling.

    Args:
        prompt: User prompt text.
        role: Task role; drives model + default tier.
        max_tokens: Maximum response tokens.
        temperature: Sampling temperature (0.0 = deterministic). Not sent to
                     models that refuse sampling parameters (the 5.5 family).
        max_retries: Total attempts before giving up on throttling.
        thinking: If True, force extended thinking on (uses tier budget).
                  If False, force off. If None (default), use tier budget.
        system: Optional system prompt, sent as the Converse ``system`` block
                (the research agent's user-editable instructions).

    Returns:
        Response text. Empty string if the model returns no text blocks.

    Raises:
        BedrockInvocationError: if all retries are exhausted on throttling.
        Exception: non-throttling errors propagate unchanged.
    """
    model_id = get_model_id(role)
    tier = _resolve_tier(role)
    if model_id in _ADAPTIVE_THINKING_MODELS:
        inference_config, extra_fields = _adaptive_request(tier, thinking, max_tokens)
    else:
        inference_config, extra_fields = _budget_request(tier, thinking, max_tokens, temperature)

    client = _get_bedrock_client()
    request_kwargs: dict = {
        "modelId": model_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": inference_config,
    }
    if system:
        request_kwargs["system"] = [{"text": system}]
    if extra_fields:
        request_kwargs["additionalModelRequestFields"] = extra_fields

    for attempt in range(max_retries):
        try:
            response = client.converse(**request_kwargs)
        except Exception as exc:
            error_str = str(exc)
            is_throttle = any(name in error_str for name in _THROTTLE_ERRORS)
            if is_throttle and attempt < max_retries - 1:
                delay = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(
                    "Bedrock throttled (model=%s attempt=%d/%d), sleeping %.2fs",
                    model_id,
                    attempt + 1,
                    max_retries,
                    delay,
                )
                time.sleep(delay)
                continue
            raise
        return _first_text_block(response)

    raise BedrockInvocationError(
        f"Bedrock invocation failed after {max_retries} attempts for model {model_id}"
    )


def _adaptive_request(tier: ModelTier, thinking: bool | None, max_tokens: int) -> tuple[dict, dict]:
    """``inferenceConfig`` and extra fields for a model that thinks adaptively.

    No temperature: these models refuse it. Thinking is steered by effort —
    the tier's by default, the balanced tier's when forced on for a fast-tier
    role, and ``low`` when forced off.
    """
    if thinking is False:
        effort = _THINKING_OFF_EFFORT
    elif thinking is True and tier is ModelTier.FAST:
        effort = _TIER_EFFORT[ModelTier.BALANCED]
    else:
        effort = _TIER_EFFORT[tier]
    inference_config = {"maxTokens": max_tokens + _EFFORT_HEADROOM[effort]}
    return inference_config, {"thinking": {"type": "adaptive"}, "output_config": {"effort": effort}}


def _budget_request(
    tier: ModelTier, thinking: bool | None, max_tokens: int, temperature: float,
) -> tuple[dict, dict]:
    """``inferenceConfig`` and extra fields for a model that takes a thinking token budget."""
    tier_budget = _TIER_THINKING_BUDGET[tier]
    if thinking is True:
        budget = tier_budget if tier_budget > 0 else _TIER_THINKING_BUDGET[ModelTier.BALANCED]
    elif thinking is False:
        budget = 0
    else:
        budget = tier_budget
    if budget == 0:
        return {"maxTokens": max_tokens, "temperature": temperature}, {}
    # Extended thinking is only accepted with temperature 1 ("`temperature`
    # may only be set to 1 when thinking is enabled" — a ValidationException
    # otherwise), and the budget counts against maxTokens, which must exceed it.
    inference_config = {"maxTokens": max_tokens + budget, "temperature": 1.0}
    return inference_config, {"thinking": {"type": "enabled", "budget_tokens": budget}}


def _first_text_block(response: Mapping[str, Any]) -> str:
    """The first ``text`` content block of a Converse response; ``""`` when there is none.

    Reasoning blocks (``reasoningContent``) precede the answer when extended
    thinking is on and are skipped.
    """
    content_blocks = response.get("output", {}).get("message", {}).get("content", [])
    return next((block["text"] for block in content_blocks if "text" in block), "")
