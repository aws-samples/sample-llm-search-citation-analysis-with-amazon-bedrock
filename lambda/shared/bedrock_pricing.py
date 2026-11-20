"""
Bedrock on-demand prices of the Claude models the platform calls, and the cost of one brand extraction.

Prices are US dollars per million tokens of the ``global.`` inference profiles, as published in November 2026
(Anthropic's rate card, which Bedrock's global profiles match: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10,
Opus 5.5 $4 / $20). They only feed estimates shown before an Admin starts paid work; the bill is Bedrock's.

A model family without a price here is estimated at the dearest known price, so an estimate is never too low.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from shared.models import model_family


@dataclass(frozen=True)
class TokenPrice:
    """US dollars per million input and output tokens."""

    input_per_million: float
    output_per_million: float

    def cost(self, input_tokens: float, output_tokens: float) -> float:
        return (input_tokens * self.input_per_million + output_tokens * self.output_per_million) / 1_000_000


#: By model family (``shared.models.model_family``: ``global.anthropic.claude-haiku-5-5`` -> ``haiku-5-5``).
PRICES: Final[dict[str, TokenPrice]] = {
    'haiku-5-5': TokenPrice(0.10, 0.50),
    'sonnet-5-5': TokenPrice(2.0, 10.0),
    'opus-5-5': TokenPrice(4.0, 20.0),
}

#: What a family missing from ``PRICES`` is estimated at: the dearest known price.
FALLBACK_PRICE: Final = max(PRICES.values(), key=lambda price: price.output_per_million)

#: Tokens one brand extraction uses (``search/brand_extractor.py``), measured on 37 live extractions in November 2026:
#: 109,961 input and 60,232 output tokens, so about 2,970 in and 1,630 out per answer (answers average 2,400 characters).
EXTRACTION_INPUT_TOKENS: Final = 2970
EXTRACTION_OUTPUT_TOKENS: Final = 1630


def price_of(model_id: str) -> TokenPrice:
    """``model_id``'s price, or ``FALLBACK_PRICE`` for a family this module does not know."""
    return PRICES.get(model_family(model_id), FALLBACK_PRICE)


def extraction_cost_usd(answers: int, model_id: str) -> float:
    """The estimated Bedrock cost of extracting brands from ``answers`` stored answers with ``model_id``, rounded to cents' hundredths."""
    if answers <= 0:
        return 0.0
    cost = price_of(model_id).cost(EXTRACTION_INPUT_TOKENS * answers, EXTRACTION_OUTPUT_TOKENS * answers)
    return round(cost, 4)
