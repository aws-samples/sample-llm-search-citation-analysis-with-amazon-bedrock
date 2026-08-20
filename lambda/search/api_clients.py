"""
Search-Lambda client facade and citation URL helpers.

The retrying provider clients moved verbatim to ``shared.ai_clients``
(bugs.md 3.1) so the keyword-research Lambda reuses them instead of
carrying drifted simplified copies. This module re-exports them for its
existing importers (``handler.py``, ``search_clients.py``) and keeps the
search-specific citation URL helpers.
"""

import logging

from shared.ai_clients import (
    ClaudeClient,
    GeminiClient,
    OpenAIClient,
    PerplexityClient,
    retry_with_backoff,
)
from shared.utils import normalize_url

__all__ = [
    "ClaudeClient",
    "GeminiClient",
    "OpenAIClient",
    "PerplexityClient",
    "clean_url",
    "extract_citations_from_response",
    "retry_with_backoff",
]

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def clean_url(url: str) -> str:
    """Return the canonical citation URL form shared with deduplication.

    Delegates to :func:`shared.utils.normalize_url` so citation URLs stored
    on search results are byte-identical to the ``normalized_url`` keys the
    deduplication Lambda writes to the Citations table. The previous local
    implementation kept fragments and blank query values and did not strip
    ``ref``/``source``, so the same citation could exist in two forms across
    tables (bugs.md 1.1).
    """
    return normalize_url(url)


def extract_citations_from_response(response_text: str) -> list[str]:
    """Extract URLs from response text."""
    import re

    url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
    urls = re.findall(url_pattern, response_text)

    cleaned_urls = []
    for url in urls:
        url = url.rstrip('.,;:!?)')
        if url:
            cleaned_urls.append(clean_url(url))

    return list(set(cleaned_urls))
