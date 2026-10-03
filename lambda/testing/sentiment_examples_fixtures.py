"""Stored SearchResults rows for the sentiment-examples tests.

Shared by ``shared/test_sentiment_examples.py`` (the selection) and
``api/test_get_sentiment_examples.py`` (the endpoint).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from hypothesis import strategies as st

from testing.search_results_fixtures import search_result_row

RUN = '2026-09-28T10:00:00.000000Z'
OLDER_RUN = '2026-09-21T10:00:00.000000Z'


def stored_brand(
    name: str,
    sentiment: object = 'negative',
    *,
    classification: str = 'first_party',
    rank: object = 1,
    **fields: object,
) -> dict[str, Any]:
    """One brand dict as the search step stores it; ``fields`` adds quote, reason, ranking context ..."""
    return {'name': name, 'classification': classification, 'rank': rank, 'sentiment': sentiment, **fields}


def stored_answer(
    keyword: str,
    provider: str,
    brands: Sequence[Mapping[str, Any]],
    *,
    timestamp: str = RUN,
    **fields: object,
) -> dict[str, Any]:
    """One SearchResults row of a successful answer; ``fields`` adds or overrides attributes (``response`` ...)."""
    return search_result_row(keyword, provider, brands, timestamp=timestamp, **{'status': 'success', **fields})


# Brand dicts as models write them: names that collide across case, every
# classification, ranks the KPI engine accepts or rejects, labels in and out of the four.
STORED_BRANDS = st.fixed_dictionaries(
    {
        'name': st.sampled_from(['Hotel Sol', 'hotel sol', 'Hotel Mar', 'Rival Inn', '']),
        'classification': st.sampled_from(['first_party', 'competitor', 'other']),
        'rank': st.sampled_from([None, 1, 2, 3, '2', 'first', 999, True]),
        'sentiment': st.sampled_from(['positive', 'neutral', 'mixed', 'negative', 'Negative', 'great', None]),
    },
    optional={'sentiment_quote': st.sampled_from(['Rooms feel dated.', '', '  '])},
)

# SearchResults rows of one run: answers of every AI engine, web-search rows and failed calls.
STORED_ROWS = st.lists(
    st.builds(
        stored_answer,
        keyword=st.sampled_from(['hotel sol spa', 'Hotel Sol beach']),
        provider=st.sampled_from(['openai', 'perplexity', 'gemini', 'claude', 'brave']),
        brands=st.lists(STORED_BRANDS, max_size=5),
        status=st.sampled_from(['success', 'error']),
    ),
    max_size=8,
)
