"""Tests for the provider definitions in shared.config: the read-only ``asks_plain_keyword`` field."""

from __future__ import annotations

import dataclasses
from typing import Any, cast

import pytest

from shared.config import LLM_PROVIDERS, PROVIDER_DEFINITIONS, PROVIDERS, Provider, asks_plain_keyword


def test_defines_every_provider_once() -> None:
    assert sorted(PROVIDER_DEFINITIONS) == sorted(PROVIDERS)


def test_asks_only_google_ai_overviews_the_plain_keyword() -> None:
    assert [provider for provider in PROVIDERS if asks_plain_keyword(provider)] == [Provider.GOOGLE_AI_OVERVIEW]


def test_counts_the_plain_keyword_engine_among_the_answer_engines() -> None:
    assert Provider.GOOGLE_AI_OVERVIEW in LLM_PROVIDERS


@pytest.mark.parametrize('provider_id', ['dataforseo', 'unknown', ''])
def test_answers_false_when_provider_has_no_definition(provider_id: str) -> None:
    assert asks_plain_keyword(provider_id) is False


def test_refuses_to_add_or_replace_a_definition_at_run_time() -> None:
    with pytest.raises(TypeError):
        cast(Any, PROVIDER_DEFINITIONS)[Provider.OPENAI] = PROVIDER_DEFINITIONS[Provider.GOOGLE_AI_OVERVIEW]


def test_refuses_to_change_a_definition_at_run_time() -> None:
    with pytest.raises(dataclasses.FrozenInstanceError):
        cast(Any, PROVIDER_DEFINITIONS[Provider.GOOGLE_AI_OVERVIEW]).asks_plain_keyword = False
