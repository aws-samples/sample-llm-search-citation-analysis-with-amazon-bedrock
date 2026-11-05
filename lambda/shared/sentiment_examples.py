"""
The answers behind one sentiment count of the Sentiment report.

The report's per-engine sentiment split counts, over each keyword's latest
run, every first-party sighting ``shared.kpi_engine`` builds (one per brand
per answer, at its best rank) by its label; the competitor caveats count the
competitor sightings the same way. ``sentiment_examples`` lists the
sightings behind one of those counts, so its ``total`` is that count: the
sightings come from ``answer_from_row`` itself, and the quote, reason and
ranking context from the stored brand dict that sighting was built from.

The answer text is read in a second phase: the sightings come from rows
without it (``SIGHTING_PROJECTION``), and only the rows of the page asked for
are read again for their text (``answer_texts``), so a page never reads the
text of every answer in the scope.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
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
from shared.response_budget import PAGE_BUDGET_BYTES, take_within_budget

#: The brand classifications an example can be read for; first-party by default.
ExampleClassification = Literal['first_party', 'competitor']
EXAMPLE_CLASSIFICATIONS: tuple[ExampleClassification, ...] = (FIRST_PARTY, COMPETITOR)

#: How many examples a request returns by default, and at most.
DEFAULT_LIMIT = 20
MAX_LIMIT = 50

#: The most characters of an answer's text an example carries.
ANSWER_TEXT_CAP = 20_000

#: What the sightings are read from: an answer's attributes, its row's key and the persona's name, without the answer text.
SIGHTING_PROJECTION = f'{ANSWER_PROJECTION}, timestamp_provider, query_prompt_name'
SIGHTING_ATTRIBUTE_NAMES = dict(ANSWER_ATTRIBUTE_NAMES)

#: What an example's answer text is read from: the row's key (to join it back) and the answer.
ANSWER_TEXT_PROJECTION = 'keyword, timestamp_provider, #rsp'
ANSWER_TEXT_ATTRIBUTE_NAMES = {'#rsp': 'response'}

RowKey = tuple[str, str]
"""A SearchResults row's primary key: ``(keyword, timestamp_provider)``."""

AnswerTexts = Callable[[list[RowKey]], Mapping[RowKey, str]]
"""Reads the answer text of the rows at the given keys (a missing key has no text)."""


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
    """An example without its answer text (``_answer_fields`` adds it)."""
    brand = _kept_brand(row, sighting)
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
    }


def _answer_fields(response: object) -> dict[str, Any]:
    """An example's ``answer`` (at most ``ANSWER_TEXT_CAP`` characters) and whether it was cut."""
    text = response if isinstance(response, str) else ''
    return {'answer': text[:ANSWER_TEXT_CAP], 'answer_truncated': len(text) > ANSWER_TEXT_CAP}


def _row_key(row: Mapping[str, Any]) -> RowKey | None:
    keyword, sort_key = row.get('keyword'), row.get('timestamp_provider')
    return (keyword, sort_key) if isinstance(keyword, str) and isinstance(sort_key, str) else None


def _answer_texts(rows: list[Mapping[str, Any]], answer_texts: AnswerTexts | None) -> list[object]:
    """Each row's answer text: its own ``response``, or read by key through ``answer_texts`` (each row once)."""
    if answer_texts is None:
        return [row.get('response') for row in rows]
    keys = [_row_key(row) for row in rows]
    texts = answer_texts(list(dict.fromkeys(key for key in keys if key is not None)))
    return [None if key is None else texts.get(key) for key in keys]


def _row_examples(
    row: Mapping[str, Any],
    sentiment: str,
    provider: str | None,
    classification: ExampleClassification,
) -> list[tuple[Mapping[str, Any], dict[str, Any]]]:
    """The ``classification`` sightings labelled ``sentiment`` in the answer ``row`` holds, each with ``row`` (none when it is no answer)."""
    answer = answer_from_row(row)
    if answer is None or provider not in (None, answer.provider):
        return []
    return [
        (row, _example(row, answer, sighting))
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
    offset: int = 0,
    max_bytes: int = PAGE_BUDGET_BYTES,
    answer_texts: AnswerTexts | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """How many ``classification`` sightings in ``rows`` are labelled ``sentiment``, and one page of them.

    ``classification`` is each sighting's stored classification, first-party
    by default. ``provider`` keeps one AI engine's answers. Examples are ordered newest
    run first, then by keyword, provider and brand (keyword and brand
    case-insensitively). The page starts at ``offset`` and holds at most
    ``limit`` examples, fewer when their JSON would pass ``max_bytes`` (an
    answer carries up to ``ANSWER_TEXT_CAP`` characters, 6 bytes each once
    escaped when non-ASCII); it always holds one example when any is left.

    The answer text comes from each row's ``response``; with ``answer_texts``
    the rows are sightings without it (``SIGHTING_PROJECTION``) and only the
    page's rows are read for it, so the text of every other answer is never read.
    """
    found = [pair for row in rows for pair in _row_examples(row, sentiment, provider, classification)]
    found.sort(key=lambda pair: (pair[1]['keyword'].lower(), pair[1]['provider'], pair[1]['brand'].lower()))
    found.sort(key=lambda pair: pair[1]['timestamp'], reverse=True)
    candidates = found[offset:offset + limit]
    texts = _answer_texts([row for row, _example in candidates], answer_texts)
    examples = [{**example, **_answer_fields(text)} for (_row, example), text in zip(candidates, texts, strict=True)]
    page, _truncated = take_within_budget(examples, max_bytes=max_bytes, max_items=limit)
    return len(found), page


__all__ = [
    'ANSWER_TEXT_CAP',
    'DEFAULT_LIMIT',
    'EXAMPLE_CLASSIFICATIONS',
    'MAX_LIMIT',
    'SIGHTING_ATTRIBUTE_NAMES',
    'SIGHTING_PROJECTION',
    'AnswerTexts',
    'ExampleClassification',
    'RowKey',
    'sentiment_examples',
]
