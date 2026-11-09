"""The result shape every provider client returns to the search handler, and its uniform error row."""

from __future__ import annotations

import time
from typing import Any

ProviderResult = dict[str, Any]
"""One provider's answer to one query: ``provider``, ``response``, ``citations``, ``status``, ``metadata``, ..."""


def provider_error_result(provider: str, model: str, error: Exception, start_time: float) -> ProviderResult:
    """The uniform error-result dict every query_* previously duplicated."""
    return {
        "provider": provider,
        "response": "",
        "citations": [],
        "status": "error",
        "error": str(error),
        "raw_response": None,
        "metadata": {"model": model, "latency_ms": int((time.time() - start_time) * 1000)}
    }
