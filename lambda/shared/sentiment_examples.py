"""
The answers behind one sentiment count of the Sentiment report.

The report's per-engine sentiment split counts, over each keyword's latest
run, every first-party sighting ``shared.kpi_engine`` builds (one per brand
per answer, at its best rank) by its label; the competitor caveats count the
competitor sightings the same way. ``sentiment_examples`` lists the
sightings behind one of those counts, so its ``total`` is that count: the
sightings come from ``answer_from_row`` itself, and the quote, reason and
ranking context from the stored brand dict that sighting was built from.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Literal

from shared.kpi_engine import (
    ANSWER_ATTRIBUTE_NAMES,
    ANSWER_PROJECTION,
    COMPETITOR,
    FIRST_PARTY,
    Answer,
    Sighting,
    answer_from_row,
    sighting_from_brand,
)

#: The brand classifications an example can be read for; first-party by default.
ExampleClassification = Literal['first_party', 'competitor']
EXAMPLE_CLASSIFICATIONS: tuple[ExampleClassification, ...] = (FIRST_PARTY, COMPETITOR)

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


def _row_examples(
    row: Mapping[str, Any],
    sentiment: str,
    provider: str | None,
    classification: ExampleClassification,
) -> list[dict[str, Any]]:
    """The ``classification`` sightings labelled ``sentiment`` in the answer ``row`` holds (none when it is no answer)."""
    answer = answer_from_row(row)
    if answer is None or provider not in (None, answer.provider):
        return []
    return [
        _example(row, answer, sighting)
        for sighting in answer.sightings
        if sighting.classification == classification and sighting.sentiment == sentiment
    ]


def sentiment_examples(
    rows: Iterable[Mapping[str, Any]],
    sentiment: str,
    *,
    provider: str | None = None,
    classification: ExampleClassification = FIRST_PARTY,
    limit: int = DEFAULT_LIMIT,
) -> tuple[int, list[dict[str, Any]]]:
    """How many ``classification`` sightings in ``rows`` are labelled ``sentiment``, and the first ``limit`` of them.

    ``classification`` is each sighting's stored classification, first-party
    by default. ``provider`` keeps one AI engine's answers. Examples are ordered newest
    run first, then by keyword, provider and brand (keyword and brand
    case-insensitively).
    """
    examples = [example for row in rows for example in _row_examples(row, sentiment, provider, classification)]
    examples.sort(key=lambda example: (example['keyword'].lower(), example['provider'], example['brand'].lower()))
    examples.sort(key=lambda example: example['timestamp'], reverse=True)
    return len(examples), examples[:limit]


__all__ = [
    'ANSWER_TEXT_CAP',
    'DEFAULT_LIMIT',
    'EXAMPLE_ATTRIBUTE_NAMES',
    'EXAMPLE_CLASSIFICATIONS',
    'EXAMPLE_PROJECTION',
    'MAX_LIMIT',
    'ExampleClassification',
    'sentiment_examples',
]
