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
suffix (Haiku 4.5), others do not (Sonnet 4.6, Opus 4.7). Treat the strings
as opaque identifiers — do not parse or regex over them.
"""

import logging
import os
import random
import time
from enum import Enum
from typing import Optional

import boto3

logger = logging.getLogger(__name__)


class ModelRole(str, Enum):
    """Task-specific role for a Bedrock call."""

    SUMMARIZATION = "summarization"  # Crawler page summaries + SEO extraction
    EXTRACTION = "extraction"        # Brand mention extraction
    GENERATION = "generation"        # Content studio article generation
    ANALYSIS = "analysis"            # Recommendations, brand expansion, reasoning


class ModelTier(str, Enum):
    """Capability tier that maps to a specific model family."""

    FAST = "fast"          # Haiku — low latency, low cost
    BALANCED = "balanced"  # Sonnet — good reasoning, moderate latency
    DEEP = "deep"          # Opus — deep reasoning, higher latency


# Current global inference profile IDs (verified 2026-04-17).
# To upgrade a family, change the single line here and redeploy.
_TIER_MODELS: dict[ModelTier, str] = {
    ModelTier.FAST: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    ModelTier.BALANCED: "global.anthropic.claude-sonnet-4-6",
    ModelTier.DEEP: "global.anthropic.claude-opus-4-7",
}

# Role -> default tier. Overridable per-role via BEDROCK_TIER_<ROLE>.
_ROLE_DEFAULT_TIER: dict[ModelRole, ModelTier] = {
    ModelRole.SUMMARIZATION: ModelTier.FAST,
    ModelRole.EXTRACTION: ModelTier.FAST,
    ModelRole.GENERATION: ModelTier.FAST,
    ModelRole.ANALYSIS: ModelTier.BALANCED,
}

# Extended thinking budget (tokens) per tier. 0 disables thinking.
# Only Sonnet/Opus support extended thinking; Haiku ignores the field.
_TIER_THINKING_BUDGET: dict[ModelTier, int] = {
    ModelTier.FAST: 0,
    ModelTier.BALANCED: 2000,
    ModelTier.DEEP: 8000,
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
    thinking: Optional[bool] = None,
) -> str:
    """
    Invoke Bedrock Converse API with exponential backoff on throttling.

    Args:
        prompt: User prompt text.
        role: Task role; drives model + default tier.
        max_tokens: Maximum response tokens.
        temperature: Sampling temperature (0.0 = deterministic).
        max_retries: Total attempts before giving up on throttling.
        thinking: If True, force extended thinking on (uses tier budget).
                  If False, force off. If None (default), use tier budget.

    Returns:
        Response text. Empty string if the model returns no text blocks.

    Raises:
        BedrockInvocationError: if all retries are exhausted on throttling.
        Exception: non-throttling errors propagate unchanged.
    """
    model_id = get_model_id(role)
    tier = _resolve_tier(role)
    tier_budget = _TIER_THINKING_BUDGET[tier]

    if thinking is True:
        budget = tier_budget if tier_budget > 0 else _TIER_THINKING_BUDGET[ModelTier.BALANCED]
    elif thinking is False:
        budget = 0
    else:
        budget = tier_budget

    client = _get_bedrock_client()
    request_kwargs: dict = {
        "modelId": model_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    if budget > 0:
        request_kwargs["additionalModelRequestFields"] = {
            "thinking": {"type": "enabled", "budget_tokens": budget}
        }

    for attempt in range(max_retries):
        try:
            response = client.converse(**request_kwargs)
            content_blocks = (
                response.get("output", {}).get("message", {}).get("content", [])
            )
            for block in content_blocks:
                if "text" in block:
                    return block["text"]
            return ""
        except Exception as exc:  # noqa: BLE001 — boto3 surfaces many types
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

    raise BedrockInvocationError(
        f"Bedrock invocation failed after {max_retries} attempts for model {model_id}"
    )
