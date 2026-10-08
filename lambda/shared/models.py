"""
Centralized Bedrock model resolution and invocation.

Single source of truth for:
- Bedrock Anthropic global inference profile IDs (the tier defaults)
- Role-to-tier mapping (SUMMARIZATION/EXTRACTION/GENERATION/ANALYSIS/...)
- Tier definitions (FAST/BALANCED/DEEP -> Haiku/Sonnet/Opus by default)
- The model an administrator saved per tier in Settings > Bedrock models
- The Converse request shape per model (adaptive thinking or a token budget)
- Shared Converse invocation with retry/backoff

Resolution order for model ID:
1. Direct per-role override env var:  BEDROCK_MODEL_<ROLE>
2. The model saved for the role's tier (ProviderConfig row ``bedrock-<tier>``,
   read through ``DYNAMODB_TABLE_PROVIDER_CONFIG``, cached 60 s per tier)
3. The tier default in ``_TIER_MODELS``

The tier itself is ``BEDROCK_TIER_<ROLE>`` (fast|balanced|deep) or the role
default. Reading the saved row fails open: no table variable, a DynamoDB error
or a malformed row all mean "use the default", which is always a working model.

Note on inference profile IDs (verified via `aws bedrock list-inference-profiles`):
AWS uses inconsistent ID formats. Some profiles include the `-YYYYMMDD-v1:0`
suffix (Haiku 4.5), some a bare `-v1` (Opus 4.6), others nothing (the 5.5
family). ``model_family`` strips those suffixes for the first-guess table and
the quota names; everything else treats the ids as opaque strings.

Request styles (verified with live Converse calls, 2026-10-08):
- ``adaptive``: no ``temperature``/``top_p`` (the 5.x models and Opus 4.7/4.8
  refuse them as "deprecated for this model"), thinking steered by
  ``output_config.effort`` (low | medium | high). These models also think when
  no ``thinking`` field is sent at all, so every call names an effort.
- ``budget``: ``temperature`` plus ``thinking.type.enabled`` with a token
  budget (temperature 1 while thinking). Haiku/Sonnet/Opus 4.5 require it:
  they reject adaptive thinking and ``output_config``.
The style comes from the saved row (proven by the Settings test), else a
first-guess table; a refusal that names the other style is retried once in
that style and the correction is remembered for the container.
"""

import logging
import os
import random
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeGuard

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.env_vars import resolve_table_env

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


class RequestStyle(StrEnum):
    """The Converse request shape a model accepts."""

    ADAPTIVE = "adaptive"  # thinking.type.adaptive + output_config.effort, no sampling parameters
    BUDGET = "budget"      # temperature + thinking.type.enabled with budget_tokens


# Current global inference profile IDs (verified 2026-10-08): the tier
# defaults. To upgrade a family, change the single line here and redeploy;
# an administrator can also pick another model per tier in Settings.
_TIER_MODELS: dict[ModelTier, str] = {
    ModelTier.FAST: "global.anthropic.claude-haiku-5-5",
    ModelTier.BALANCED: "global.anthropic.claude-sonnet-5-5",
    ModelTier.DEEP: "global.anthropic.claude-opus-5-5",
}

# Role -> default tier. Overridable per-role via BEDROCK_TIER_<ROLE>.
_ROLE_DEFAULT_TIER: dict[ModelRole, ModelTier] = {
    ModelRole.SUMMARIZATION: ModelTier.FAST,
    ModelRole.EXTRACTION: ModelTier.FAST,
    ModelRole.GENERATION: ModelTier.FAST,
    ModelRole.ANALYSIS: ModelTier.BALANCED,
    ModelRole.RESEARCH_PLANNING: ModelTier.BALANCED,
    ModelRole.RESEARCH_EVALUATION: ModelTier.FAST,
}

# The only model ids Settings may save: the runtime roles may invoke
# `inference-profile/global.anthropic.claude-*` and nothing else.
_ALLOWED_MODEL_ID = re.compile(r"global\.anthropic\.claude-[a-z0-9.:-]+")
_MAX_MODEL_ID_LENGTH = 128

# First guess of the request style per model family (the id without its
# `global.anthropic.claude-` prefix and date/version suffix). The 4.6 models
# accept both styles; they keep the budget shape so `temperature` still applies.
_FAMILY_STYLES: dict[str, RequestStyle] = {
    "haiku-5-5": RequestStyle.ADAPTIVE,
    "sonnet-5": RequestStyle.ADAPTIVE,
    "sonnet-5-5": RequestStyle.ADAPTIVE,
    "opus-4-7": RequestStyle.ADAPTIVE,
    "opus-4-8": RequestStyle.ADAPTIVE,
    "opus-5": RequestStyle.ADAPTIVE,
    "opus-5-5": RequestStyle.ADAPTIVE,
    "sonnet-4-6": RequestStyle.BUDGET,
    "opus-4-6": RequestStyle.BUDGET,
    "haiku-4-5": RequestStyle.BUDGET,
    "sonnet-4-5": RequestStyle.BUDGET,
    "opus-4-5": RequestStyle.BUDGET,
    "sonnet-4": RequestStyle.BUDGET,
    "opus-4-1": RequestStyle.BUDGET,
    "opus-4": RequestStyle.BUDGET,
}

# `-YYYYMMDD`, `-v1` and `-v1:0` suffixes of the older profile ids.
_ID_SUFFIX = re.compile(r"(-\d{8})?(-v\d+(:\d+)?)?$")
_ID_FAMILY_PREFIX = "anthropic.claude-"

# Refusals that name the other request style (matched case-insensitively).
_NEEDS_ADAPTIVE_MARKERS = (
    "`temperature` is deprecated for this model",
    'use "thinking.type.adaptive"',
    "`top_p` is deprecated",
)
_NEEDS_BUDGET_MARKERS = (
    "adaptive thinking is not supported on this model",
    "output_config.effort: extra inputs are not permitted",
)

# Extended thinking budget (tokens) per tier, for models that take a budget.
# 0 disables thinking.
_TIER_THINKING_BUDGET: dict[ModelTier, int] = {
    ModelTier.FAST: 0,
    ModelTier.BALANCED: 2000,
    ModelTier.DEEP: 8000,
}

# Adaptive-thinking effort per tier, and for a call that turns thinking off
# (adaptive models cannot all switch it off; "low" thinks only when needed).
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

# How long a container trusts the saved tier models it read.
SAVED_MODEL_TTL_SECONDS = 60.0

_PROVIDER_ID_PREFIX = "bedrock-"


# =============================================================================
# Model ids, tiers and request styles
# =============================================================================

def is_allowed_model_id(value: object) -> TypeGuard[str]:
    """Whether ``value`` is a model id Settings may save (``global.anthropic.claude-*``)."""
    return (
        isinstance(value, str)
        and len(value) <= _MAX_MODEL_ID_LENGTH
        and _ALLOWED_MODEL_ID.fullmatch(value) is not None
    )


def model_family(model_id: str) -> str:
    """``global.anthropic.claude-haiku-4-5-20251001-v1:0`` -> ``haiku-4-5``."""
    name = model_id.rsplit(_ID_FAMILY_PREFIX, 1)[-1]
    return _ID_SUFFIX.sub("", name, count=1)


def first_guess_style(model_id: str) -> RequestStyle:
    """The request style ``model_id`` most likely accepts.

    Unknown families are assumed to be newer models (adaptive); Claude 3 ids
    (``claude-3-7-sonnet``) take a budget. A wrong guess costs one retry.
    """
    family = model_family(model_id)
    known = _FAMILY_STYLES.get(family)
    if known is not None:
        return known
    return RequestStyle.BUDGET if family[:1].isdigit() else RequestStyle.ADAPTIVE


def parse_request_style(value: object) -> RequestStyle | None:
    """``value`` as a ``RequestStyle``; ``None`` when it is not one."""
    try:
        return RequestStyle(value)
    except ValueError:
        return None


def style_correction(message: str, style: RequestStyle) -> RequestStyle | None:
    """The style a refusal of a ``style`` request asks for; ``None`` when it asks for none."""
    lowered = message.lower()
    if style is RequestStyle.BUDGET and any(marker in lowered for marker in _NEEDS_ADAPTIVE_MARKERS):
        return RequestStyle.ADAPTIVE
    if style is RequestStyle.ADAPTIVE and any(marker in lowered for marker in _NEEDS_BUDGET_MARKERS):
        return RequestStyle.BUDGET
    return None


def default_model(tier: ModelTier) -> str:
    """The model ``tier`` uses when nothing is saved."""
    return _TIER_MODELS[tier]


def tier_provider_id(tier: ModelTier) -> str:
    """The ProviderConfig ``provider_id`` holding ``tier``'s saved model (``bedrock-fast``)."""
    return f"{_PROVIDER_ID_PREFIX}{tier.value}"


def roles_for_tier(tier: ModelTier) -> list[str]:
    """The roles whose calls go to ``tier`` in this environment."""
    return [role.value for role in ModelRole if _resolve_tier(role) is tier]


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


# =============================================================================
# Saved tier models (Settings > Bedrock models)
# =============================================================================

@dataclass(frozen=True)
class SavedModel:
    """The model an administrator saved for a tier, and the style its test proved."""

    model: str
    request_style: RequestStyle | None


def saved_model_from_row(row: Mapping[str, Any]) -> SavedModel | None:
    """The saved model on a ``bedrock-<tier>`` row; ``None`` when there is none (or it is malformed)."""
    model = row.get("model")
    if not is_allowed_model_id(model):
        return None
    return SavedModel(model, parse_request_style(row.get("request_style")))


# Container caches: tier -> (read at, saved model), and styles learned from refusals.
_saved_models: dict[ModelTier, tuple[float, SavedModel | None]] = {}
_learned_styles: dict[str, RequestStyle] = {}

# Lazily initialized module-level clients. No region needed for global
# inference profiles.
_bedrock_client = None
_dynamodb_resource = None


def _clock() -> float:
    """Monotonic seconds for the saved-model cache (patched by tests)."""
    return time.monotonic()


def _get_dynamodb() -> Any:
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb")
    return _dynamodb_resource


def _read_saved_model(tier: ModelTier) -> SavedModel | None:
    """Read ``tier``'s saved model; fails open to ``None`` (the default model)."""
    table_name = resolve_table_env("DYNAMODB_TABLE_PROVIDER_CONFIG", required=False)
    if not table_name:
        return None
    try:
        response = _get_dynamodb().Table(table_name).get_item(Key={"provider_id": tier_provider_id(tier)})
    except (BotoCoreError, ClientError):
        logger.warning(
            "Could not read the saved %s-tier Bedrock model; using the default for %d s",
            tier.value,
            SAVED_MODEL_TTL_SECONDS,
            exc_info=True,
        )
        return None
    return saved_model_from_row(response.get("Item") or {})


def saved_model(tier: ModelTier) -> SavedModel | None:
    """``tier``'s saved model, read at most once per ``SAVED_MODEL_TTL_SECONDS`` per container.

    A failed read is cached like an empty one, so a DynamoDB outage logs one
    warning per tier per period rather than one per call.
    """
    now = _clock()
    cached = _saved_models.get(tier)
    if cached is not None and now - cached[0] < SAVED_MODEL_TTL_SECONDS:
        return cached[1]
    saved = _read_saved_model(tier)
    _saved_models[tier] = (now, saved)
    return saved


@dataclass(frozen=True)
class _ResolvedModel:
    model_id: str
    tier: ModelTier
    saved_style: RequestStyle | None


def _resolve_model(role: ModelRole) -> _ResolvedModel:
    """The model a ``role`` call goes to, its tier, and the saved style when it came from Settings."""
    tier = _resolve_tier(role)
    direct = os.environ.get(f"BEDROCK_MODEL_{role.value.upper()}")
    if direct:
        return _ResolvedModel(direct, tier, None)
    saved = saved_model(tier)
    if saved is not None:
        return _ResolvedModel(saved.model, tier, saved.request_style)
    return _ResolvedModel(_TIER_MODELS[tier], tier, None)


def get_model_id(role: ModelRole) -> str:
    """Resolve the Bedrock model ID for a given role."""
    return _resolve_model(role).model_id


def get_model_tier(role: ModelRole) -> ModelTier:
    """Resolve the active tier for a role (useful for response metadata)."""
    return _resolve_tier(role)


def request_style_for(model_id: str, saved_style: RequestStyle | None = None) -> RequestStyle:
    """The style to send: learned from a refusal in this container, else saved, else the first guess."""
    return _learned_styles.get(model_id) or saved_style or first_guess_style(model_id)


# =============================================================================
# Requests
# =============================================================================

def build_converse_request(
    model_id: str,
    style: RequestStyle,
    tier: ModelTier,
    prompt: str,
    *,
    max_tokens: int,
    temperature: float = 0.0,
    thinking: bool | None = None,
    system: str | None = None,
) -> dict[str, Any]:
    """The ``converse`` keyword arguments for one prompt in ``style``.

    The one request builder for runtime calls and the Settings model test.
    """
    if style is RequestStyle.ADAPTIVE:
        inference_config, extra_fields = _adaptive_request(tier, thinking, max_tokens)
    else:
        inference_config, extra_fields = _budget_request(tier, thinking, max_tokens, temperature)
    request: dict[str, Any] = {
        "modelId": model_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": inference_config,
    }
    if system:
        request["system"] = [{"text": system}]
    if extra_fields:
        request["additionalModelRequestFields"] = extra_fields
    return request


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


def first_text_block(response: Mapping[str, Any]) -> str:
    """The first ``text`` content block of a Converse response; ``""`` when there is none.

    Reasoning blocks (``reasoningContent``) precede the answer when extended
    thinking is on and are skipped.
    """
    content_blocks = response.get("output", {}).get("message", {}).get("content", [])
    return next((block["text"] for block in content_blocks if "text" in block), "")


# =============================================================================
# Invocation
# =============================================================================

def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime")
    return _bedrock_client


class BedrockInvocationError(RuntimeError):
    """Raised when Bedrock invocation fails after all retries."""


def _converse_with_backoff(request: dict[str, Any], max_retries: int) -> str:
    """Send ``request``, retrying throttling with exponential backoff; the answer text."""
    client = _get_bedrock_client()
    model_id = request["modelId"]
    for attempt in range(max_retries):
        try:
            response = client.converse(**request)
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
        return first_text_block(response)

    raise BedrockInvocationError(
        f"Bedrock invocation failed after {max_retries} attempts for model {model_id}"
    )


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
                     models that refuse sampling parameters (adaptive style).
        max_retries: Total attempts before giving up on throttling.
        thinking: If True, force extended thinking on (uses tier budget).
                  If False, force off. If None (default), use tier budget.
        system: Optional system prompt, sent as the Converse ``system`` block
                (the research agent's user-editable instructions).

    Returns:
        Response text. Empty string if the model returns no text blocks.

    Raises:
        BedrockInvocationError: if all retries are exhausted on throttling.
        Exception: non-throttling errors propagate unchanged, except a refusal
            naming the other request style, which is retried once in that style.
    """
    resolved = _resolve_model(role)
    style = request_style_for(resolved.model_id, resolved.saved_style)

    def request_in(request_style: RequestStyle) -> dict[str, Any]:
        return build_converse_request(
            resolved.model_id, request_style, resolved.tier, prompt,
            max_tokens=max_tokens, temperature=temperature, thinking=thinking, system=system,
        )

    try:
        return _converse_with_backoff(request_in(style), max_retries)
    except ClientError as exc:
        corrected = style_correction(str(exc), style)
        if corrected is None:
            raise
    return _retry_in_style(resolved.model_id, corrected, request_in, max_retries)


def _retry_in_style(
    model_id: str,
    style: RequestStyle,
    request_in: Callable[[RequestStyle], dict[str, Any]],
    max_retries: int,
) -> str:
    """The single self-correcting retry: remember ``style`` for ``model_id`` and send once more."""
    logger.warning("Bedrock model %s refused the request shape; retrying as %s", model_id, style.value)
    _learned_styles[model_id] = style
    return _converse_with_backoff(request_in(style), max_retries)
