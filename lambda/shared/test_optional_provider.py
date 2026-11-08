"""``optional_provider()`` accepts every answer engine of ``shared.config``."""

from __future__ import annotations

from shared.config import LLM_PROVIDERS
from shared.decorators import optional_provider


def test_accepts_every_answer_engine_when_validating_provider_filter():
    assert optional_provider()['choices'] == list(LLM_PROVIDERS)
