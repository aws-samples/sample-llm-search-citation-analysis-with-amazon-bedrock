"""
Per-provider run counters: the ``{'queries', 'citations', 'failures',
'error_categories'}`` bucket the deduplication step rolls up per keyword and
GenerateSummary folds into the run's ``providers_breakdown``.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def empty_provider_counts() -> dict[str, Any]:
    """A fresh bucket: nothing queried, cited or failed yet."""
    return {
        'queries': 0,
        'citations': 0,
        'failures': 0,
        'error_categories': [],
    }


def add_error_categories(counts: dict[str, Any], categories: Iterable[str]) -> None:
    """Record each failure category once, in first-seen order.

    Kept as a list so a provider failing two different ways in one run
    reports both rather than the last one silently winning.
    """
    for category in categories:
        if category not in counts['error_categories']:
            counts['error_categories'].append(category)
