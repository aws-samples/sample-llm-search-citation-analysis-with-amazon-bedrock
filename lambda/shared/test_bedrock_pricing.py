"""The Bedrock prices the re-extract estimate uses."""

from __future__ import annotations

import pytest

from shared.bedrock_pricing import FALLBACK_PRICE, PRICES, extraction_cost_usd, price_of


def test_prices_a_global_profile_id_by_its_family():
    assert price_of('global.anthropic.claude-haiku-5-5') == PRICES['haiku-5-5']


def test_prices_an_unknown_family_at_the_dearest_known_price():
    assert price_of('global.anthropic.claude-fable-5-2') == FALLBACK_PRICE == PRICES['opus-5-5']


def test_one_thousand_answers_on_haiku_cost_about_a_dollar():
    # 2,970,000 input tokens at $0.10/M + 1,630,000 output tokens at $0.50/M.
    assert extraction_cost_usd(1000, 'global.anthropic.claude-haiku-5-5') == pytest.approx(1.112)


@pytest.mark.parametrize('answers', [0, -3])
def test_no_answers_cost_nothing(answers):
    assert extraction_cost_usd(answers, 'global.anthropic.claude-haiku-5-5') == 0.0


def test_a_single_answer_keeps_its_fraction_of_a_cent():
    assert extraction_cost_usd(1, 'global.anthropic.claude-haiku-5-5') == 0.0011
