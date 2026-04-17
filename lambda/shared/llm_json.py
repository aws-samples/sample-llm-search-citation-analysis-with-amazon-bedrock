"""
Shared helpers for parsing JSON out of LLM text responses.

LLMs wrap JSON in varied ways: markdown fences with or without a language tag,
prose before and after, and sometimes truncated output that cuts off mid-array.
This module centralizes the cleanup and parsing logic so every Lambda gets the
same behavior and the same bug fixes.

Two entry points:
- parse_llm_json(text, expect="object") -> dict | None
- parse_llm_json(text, expect="array")  -> list | None

Both return None on unrecoverable parse failures. The caller logs context and
decides how to react; this module does not raise for bad input because LLM
output is expected to be fuzzy and callers already have graceful fallbacks.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal, Optional, Union

logger = logging.getLogger(__name__)

JsonLike = Union[dict, list]


def _strip_code_fences(text: str) -> str:
    """Remove surrounding markdown code fences (```json ... ``` or ``` ... ```).

    Handles the common cases:
      - full fenced block: ```json\n{...}\n```
      - fenced without language: ```\n{...}\n```
      - unclosed fence (LLM truncated by max_tokens)
    """
    cleaned = text.strip()
    if "```" not in cleaned:
        return cleaned

    start_fence = cleaned.find("```")
    if start_fence == -1:
        return cleaned

    # Drop everything up to the first newline after the opening fence (skips
    # optional language tag like ```json).
    newline_after_fence = cleaned.find("\n", start_fence)
    if newline_after_fence != -1:
        after_fence = cleaned[newline_after_fence + 1 :]
    else:
        after_fence = cleaned[start_fence + 3 :]

    end_fence = after_fence.rfind("```")
    if end_fence != -1:
        return after_fence[:end_fence].strip()
    # No closing fence — LLM likely truncated. Keep the body we have.
    return after_fence.strip()


def _extract_array(cleaned: str) -> Optional[str]:
    """Return a best-effort JSON array substring, salvaging truncated output."""
    start_idx = cleaned.find("[")
    if start_idx == -1:
        return None

    end_idx = cleaned.rfind("]") + 1
    if end_idx > 0:
        return cleaned[start_idx:end_idx]

    # Unclosed array — try to salvage by closing after the last complete object.
    partial = cleaned[start_idx:]
    last_brace = partial.rfind("}")
    if last_brace == -1:
        return None
    return partial[: last_brace + 1] + "]"


def _extract_object(cleaned: str) -> Optional[str]:
    """Return a JSON object substring, or None if braces aren't balanced enough."""
    start_idx = cleaned.find("{")
    if start_idx == -1:
        return None
    end_idx = cleaned.rfind("}") + 1
    if end_idx == 0:
        return None
    return cleaned[start_idx:end_idx]


def parse_llm_json(
    text: str,
    expect: Literal["object", "array"] = "object",
) -> Optional[JsonLike]:
    """Parse JSON from an LLM response, tolerating code fences and prose.

    Args:
        text: Raw LLM response text.
        expect: "object" for a JSON object response, "array" for a JSON array.

    Returns:
        Parsed dict/list on success. None on any failure (empty input, no JSON
        found, malformed JSON, or wrong top-level type).
    """
    if not text:
        return None

    cleaned = _strip_code_fences(text)
    candidate = _extract_array(cleaned) if expect == "array" else _extract_object(cleaned)
    if candidate is None:
        logger.warning(
            "llm_json_no_%s_found preview=%r",
            expect,
            cleaned[:300],
        )
        return None

    try:
        parsed: Any = json.loads(candidate)
    except json.JSONDecodeError as exc:
        logger.warning(
            "llm_json_parse_failed expect=%s error=%s preview=%r",
            expect,
            exc,
            candidate[:300],
        )
        return None

    if expect == "array" and not isinstance(parsed, list):
        logger.warning("llm_json_expected_array got=%s", type(parsed).__name__)
        return None
    if expect == "object" and not isinstance(parsed, dict):
        logger.warning("llm_json_expected_object got=%s", type(parsed).__name__)
        return None

    return parsed
