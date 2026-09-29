"""
The answers behind one sentiment count of the Sentiment report.

The report's per-engine sentiment split counts, over each keyword's latest
run, every first-party sighting ``shared.kpi_engine`` builds (one per brand
per answer, at its best rank) by its label. ``sentiment_examples`` lists the
sightings behind one of those counts, so its ``total`` is that count: the
sightings come from ``answer_from_row`` itself, and the quote, reason and
ranking context from the stored brand dict that sighting was built from.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from shared.kpi_engine import (
    ANSWER_ATTRIBUTE_NAMES,
    ANSWER_PROJECTION,
    Answer,
    Sighting,
    answer_from_row,
    sighting_from_brand,
)

#: The labels a sentiment count is asked for (the KPI engine's sentiment split).
SENTIMENT_LABELS = ('positive', 'neutral', 'mixed', 'negative')

#: How many examples a request returns by default, and at most.
DEFAULT_LIMIT = 20
MAX_LIMIT = 50

#: The most characters of an answer's text an example carries.
ANSWER_TEXT_CAP = 20_000

#: What an example is read from: an answer's attributes, its text (``#rsp``) and the persona's name.
EXAMPLE_PROJECTION = f'{ANSWER_PROJECTION}, #rsp, query_prompt_name'
EXAMPLE_ATTRIBUTE_NAMES = {**ANSWER_ATTRIBUTE_NAMES, '#rsp': 'response'}


def _text(value: object) -> str | None:
    """A stored string without surrounding whitespace, or ``None`` when there is no text."""
    text = value.strip() if isinstance(value, str) else ''
    return text or None


def _kept_brand(row: Mapping[str, Any], sighting: Sighting) -> Mapping[str, Any]:
    """The stored brand dict ``sighting`` was built from.

    ``answer_from_row`` keeps, per brand, the first dict at the brand's best
    rank, so the first dict making exactly that sighting is the one it kept.
    """
    return next(brand for brand in row['brands'] if sighting_from_brand(brand) == sighting)


def _example(row: Mapping[str, Any], answer: Answer, sighting: Sighting) -> dict[str, Any]:
    brand = _kept_brand(row, sighting)
    response = row.get('response')
    text = response if isinstance(response, str) else ''
    return {
        'keyword': answer.keyword,
        'provider': answer.provider,
        'persona': answer.persona,
        'persona_name': _text(row.get('query_prompt_name')),
        'timestamp': answer.timestamp,
        'brand': sighting.name,
        'rank': sighting.rank,
        'sentiment': sighting.sentiment,
        'quote': _text(brand.get('sentiment_quote')),
        'reason': _text(brand.get('sentiment_reason')),
        'ranking_context': _text(brand.get('ranking_context')),
        'answer': text[:ANSWER_TEXT_CAP],
        'answer_truncated': len(text) > ANSWER_TEXT_CAP,
    }


def _row_examples(row: Mapping[str, Any], sentiment: str, provider: str | None) -> list[dict[str, Any]]:
    """The first-party sightings labelled ``sentiment`` in the answer ``row`` holds (none when it is no answer)."""
    answer = answer_from_row(row)
    if answer is None or provider not in (None, answer.provider):
        return []
    return [_example(row, answer, sighting) for sighting in answer.first_party() if sighting.sentiment == sentiment]


def sentiment_examples(
    rows: Iterable[Mapping[str, Any]],
    sentiment: str,
    *,
    provider: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> tuple[int, list[dict[str, Any]]]:
    """How many first-party sightings in ``rows`` are labelled ``sentiment``, and the first ``limit`` of them.

    ``provider`` keeps one AI engine's answers. Examples are ordered newest
    run first, then by keyword, provider and brand (keyword and brand
    case-insensitively).
    """
    examples = [example for row in rows for example in _row_examples(row, sentiment, provider)]
    examples.sort(key=lambda example: (example['keyword'].lower(), example['provider'], example['brand'].lower()))
    examples.sort(key=lambda example: example['timestamp'], reverse=True)
    return len(examples), examples[:limit]


__all__ = [
    'ANSWER_TEXT_CAP',
    'DEFAULT_LIMIT',
    'EXAMPLE_ATTRIBUTE_NAMES',
    'EXAMPLE_PROJECTION',
    'MAX_LIMIT',
    'SENTIMENT_LABELS',
    'sentiment_examples',
]
