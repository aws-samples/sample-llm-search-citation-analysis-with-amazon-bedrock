"""
Artifact ``sentiment/index`` (track S3): which keywords of a large scope hold sentiment examples, and how many.

The fold keeps, per keyword with a latest run, the ``sentiment`` counts of
its ``mentions`` partial (``classification|sentiment|provider``); the
artifact lists the keywords in the examples' order (newest run first, then
keyword: ``sentiment_examples.order_keywords``) with those counts.

``serve`` answers ``GET /visibility/sentiment-examples`` from it: ``total``
is the sum of the matching counts, exact as of the build, and a page reads
the rows of only the keywords it covers, each at the run the build counted
(``SentimentReaders.run_rows``), then the text of the page's answers.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared.keyword_major_pages import PageRequest, Slot, list_fingerprint, snapshot_page_fields
from shared.kpi_engine import FIRST_PARTY
from shared.partial_contract import KeywordLatest
from shared.partial_mentions import sentiment_key
from shared.sentiment_examples import AnswerTexts, ExampleFilter, examples_page, order_keywords, ordered_examples
from shared.snapshot_artifacts import ArtifactBuilder, KeywordCursor, SnapshotArtifacts, SnapshotScope

INDEX_KEY = 'sentiment/index'


@dataclass(frozen=True)
class SentimentReaders:
    """The reads a page needs: one keyword's sightings of one run (no answer text), and answer texts by row key."""

    run_rows: Callable[[str, str], Sequence[Mapping[str, Any]]]
    answer_texts: AnswerTexts


SentimentAcc = dict[str, list[Any]]
"""keyword -> [latest run timestamp, sentiment counts]."""


def matching_count(counts: Mapping[str, int], classification: str, sentiment: str, provider: str | None) -> int:
    """The examples a keyword's counts promise for the filters (every provider when ``provider`` is ``None``)."""
    prefix = f'{classification}|{sentiment}|'
    if provider is not None:
        return counts.get(sentiment_key(classification, sentiment, provider), 0)
    return sum(count for key, count in counts.items() if key.startswith(prefix))


def snapshot_fingerprint(build_id: str, params: Mapping[str, Any]) -> str:
    """The ``f`` of a cursor over the build ``build_id`` for these filters."""
    return list_fingerprint('sentiment', build_id, params.get('classification'), params.get('sentiment'), params.get('provider'))


@dataclass(frozen=True)
class SentimentIndexBuilder:
    """``sentiment/index``: keywords in examples order with their sentiment counts."""

    name: str = 'sentiment'

    def fold(self, acc: SentimentAcc | None, latest: KeywordLatest, scope: SnapshotScope) -> SentimentAcc:
        del scope
        acc = {} if acc is None else acc
        run = latest.get('latest')
        part = None if run is None else run['parts'].get('mentions')
        if run is not None and part is not None and part.get('sentiment'):
            acc[latest['keyword']] = [run['timestamp'], dict(part['sentiment'])]
        return acc

    def finalize(self, acc: SentimentAcc | None) -> dict[str, Any]:
        entries = acc or {}
        ordered = order_keywords((keyword, value[0]) for keyword, value in entries.items())
        return {INDEX_KEY: {'keywords': [[keyword, timestamp, entries[keyword][1]] for keyword, timestamp in ordered]}}

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
        """The examples page of ``params`` (``sentiment``, ``classification``, ``provider``, ``limit``, ``cursor``, ``readers``)."""
        index = artifacts.load(INDEX_KEY)
        if index is None:
            return None
        readers: SentimentReaders = params['readers']
        wanted = ExampleFilter(params['sentiment'], params.get('provider'), params.get('classification') or FIRST_PARTY)
        keywords: list[list[Any]] = index['keywords']
        slots = [
            Slot(position, count) for position, (_keyword, _timestamp, counts) in enumerate(keywords)
            if (count := matching_count(counts, wanted.classification, wanted.sentiment, wanted.provider)) > 0
        ]

        def read(position: int) -> list[Any]:
            keyword, timestamp, _counts = keywords[position]
            return ordered_examples(readers.run_rows(keyword, timestamp), wanted)

        cursor: KeywordCursor = params['cursor']
        examples, token = examples_page(PageRequest(slots, cursor, params['limit'], read, len(keywords)), readers.answer_texts)
        return {
            'sentiment': wanted.sentiment,
            'provider': wanted.provider,
            'classification': wanted.classification,
            'total': sum(slot.count for slot in slots),
            'examples': examples,
            **snapshot_page_fields(token),
        }


#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (SentimentIndexBuilder(),)

__all__ = ['BUILDERS', 'INDEX_KEY', 'SentimentIndexBuilder', 'SentimentReaders', 'matching_count', 'snapshot_fingerprint']
