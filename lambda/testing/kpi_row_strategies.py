"""Hypothesis strategies for SearchResults rows of a few keywords over a few runs.

Small vocabularies make collisions frequent: one brand key spelled two ways
("Hotel Sol" / "HOTEL SOL"), one brand named twice in an answer, the same
domain cited by several answers, ranks beyond the weight cap, unlabelled
sentiment, failed answers and web-search rows (which are not answers).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from hypothesis import strategies as st

KEYWORDS: tuple[str, ...] = ('hotel coruña', 'spa galicia', 'playa riazor')
RUNS = ('2026-09-01T06:00:00.000000Z', '2026-09-02T06:00:00.000000Z', '2026-09-09T06:00:00.000000Z', '2026-10-01T06:00:00.000000Z')
OWNED_CHOICES = ((), ('hotel-sol.com',), ('hotel-sol.com', 'blog.sol.es'))
_DOMAINS = ('https://www.hotel-sol.com/a', 'https://blog.hotel-sol.com/b', 'https://blog.sol.es/', 'https://booking.com/x', 'https://tripadvisor.es/y', 'not a url')
_NAMES = ('Hotel Sol', 'HOTEL SOL', 'Hotel Mar', 'Parador', 'Meliá', 'Melia', 'NH')
_CLASSES = ('first_party', 'competitor', 'other', None)
_SENTIMENTS = ('positive', 'neutral', 'negative', 'mixed', 'Positive', 'unknown', None)

_BRAND = st.fixed_dictionaries({
    'name': st.sampled_from(_NAMES),
    'classification': st.sampled_from(_CLASSES),
    'rank': st.one_of(st.none(), st.integers(min_value=0, max_value=14), st.just('3'), st.just(999)),
    'sentiment': st.sampled_from(_SENTIMENTS),
})


@st.composite
def search_rows(draw: st.DrawFn, min_size: int = 0, max_size: int = 40) -> list[dict[str, Any]]:
    """SearchResults rows of ``KEYWORDS`` in ``RUNS`` (answers, failures and web-search rows), in sort-key order per keyword."""
    drawn = draw(st.lists(
        st.fixed_dictionaries({
            'keyword': st.sampled_from(KEYWORDS),
            'timestamp': st.sampled_from(RUNS),
            'provider': st.sampled_from(('openai', 'perplexity', 'gemini', 'claude', 'brave')),
            'status': st.sampled_from(('success', 'success', 'success', 'error')),
            'query_prompt_id': st.sampled_from(('default', 'family', 'business')),
            'brands': st.lists(_BRAND, max_size=6),
            'citations': st.lists(st.sampled_from(_DOMAINS), max_size=5),
            'metadata': st.fixed_dictionaries({'model': st.sampled_from(('gpt-5-mini', 'sonar', ''))}),
        }, optional={
            # Rows from before 2.43.0 carry no citation version; DynamoDB answers numbers as Decimal.
            'citations_version': st.sampled_from((2, Decimal(2))),
        }),
        min_size=min_size,
        max_size=max_size,
        # A sort key is unique in DynamoDB: one row per keyword, run, engine and persona.
        unique_by=lambda row: (row['keyword'], row['timestamp'], row['provider'], row['query_prompt_id']),
    ))
    rows: list[dict[str, Any]] = [
        {**row, 'timestamp_provider': f"{row['timestamp']}#{row['provider']}#{row['query_prompt_id']}"} for row in drawn
    ]
    return sorted(rows, key=lambda row: (KEYWORDS.index(row['keyword']), row['timestamp_provider']))


OWNED_DOMAINS = st.sampled_from(OWNED_CHOICES)
