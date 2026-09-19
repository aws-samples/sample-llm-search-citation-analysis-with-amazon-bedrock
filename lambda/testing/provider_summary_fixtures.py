"""Builders for the two shapes that cross the deduplication -> summary boundary.

``deduplication/handler.py`` rolls the search step's provider result rows up
into one bucket per provider (``summarize_providers``), and
``generate-summary/handler.py`` folds those buckets into the execution report.
The two suites used to build the same shapes from opposite ends; this is the
single copy.
"""

from __future__ import annotations

from typing import Any


def provider_row(
    provider: str,
    citations: list[str],
    query_prompt_id: str = 'default',
) -> dict[str, Any]:
    """One search-step result row, as ``search/handler.py`` slims it for Step Functions."""
    return {
        'provider': provider,
        'provider_type': 'llm',
        'status': 'success',
        'citation_count': len(citations),
        'citations': citations,
        'query_prompt_id': query_prompt_id,
    }


def provider_bucket(
    queries: int = 1,
    citations: int = 4,
    failures: int = 0,
    error_categories: list[str] | None = None,
) -> dict[str, Any]:
    """One per-provider rollup bucket, in the shape the dedup rollup produces and the summary reads."""
    return {
        'queries': queries,
        'citations': citations,
        'failures': failures,
        'error_categories': error_categories if error_categories is not None else [],
    }
