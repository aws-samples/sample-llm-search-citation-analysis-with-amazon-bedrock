"""Builders for SearchResults rows as the search step stores them."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

#: ``(name, classification, rank)`` of one brand mentioned in an answer.
BrandSpec = tuple[str, str, int]


def ranked_brands(brands: Iterable[BrandSpec]) -> list[dict[str, Any]]:
    """The ``brands`` list of a row: one name/classification/rank dict per spec."""
    return [{'name': name, 'classification': classification, 'rank': rank} for name, classification, rank in brands]


def successful_answer_row(
    *,
    keyword: str,
    timestamp: str,
    provider: str,
    brands: Iterable[BrandSpec],
    citations: list[str],
) -> dict[str, Any]:
    """One successful engine answer to ``keyword`` in the run stamped ``timestamp``."""
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'provider': provider,
        'status': 'success',
        'brands': ranked_brands(brands),
        'citations': citations,
    }
