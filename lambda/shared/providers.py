"""
Shared helpers for querying the Provider configuration table.

Previously duplicated in ``api/get-visibility-metrics.py`` and
``api/get-historical-trends.py``. Audit item 28 called out the drift risk —
the two copies were byte-identical today but there was no guarantee they'd
stay that way after independent edits. Centralized here so every handler
that needs an enabled-provider count gets the same semantics.
"""

from __future__ import annotations

import logging
import os

from shared.config import LLM_PROVIDERS
from shared.utils import get_dynamodb_resource

logger = logging.getLogger(__name__)


def get_enabled_provider_count(table_name: str | None = None) -> int:
    """Return the number of LLM providers currently enabled in the config table.

    This is the denominator of the visibility score's provider-coverage term,
    so it must only count providers that can actually mention a brand. Brand
    extraction runs on LLM responses only (``search/handler.py`` skips it for
    the optional Brave/Tavily/Exa/SerpAPI/Firecrawl search providers), so those
    are excluded here; counting them diluted every visibility score for
    installations that never configured them.

    Fallback rules (all return ``len(LLM_PROVIDERS)``, i.e. every LLM provider
    treated as enabled):
    - ``DYNAMODB_TABLE_PROVIDER_CONFIG`` (or legacy ``PROVIDER_CONFIG_TABLE``,
      or the passed ``table_name``) is not set.
    - The table scan raises — provider-count is a denominator in
      visibility-score math and returning zero would produce useless metrics.
    - The table is empty, or every LLM provider is explicitly disabled.
    Otherwise count the LLM providers that are enabled; a provider absent from
    the table, or present without an ``enabled`` field, counts as enabled,
    matching the dashboard's opt-out convention.

    Args:
        table_name: Override the ``DYNAMODB_TABLE_PROVIDER_CONFIG`` env var for
            testing. Production callers should omit.
    """
    resolved = (
        table_name
        or os.environ.get('DYNAMODB_TABLE_PROVIDER_CONFIG')
        or os.environ.get('PROVIDER_CONFIG_TABLE')
    )
    if not resolved:
        return len(LLM_PROVIDERS)

    try:
        table = get_dynamodb_resource().Table(resolved)
        response = table.scan(ProjectionExpression='provider_id, enabled')
        items = response.get('Items', [])

        if not items:
            # No config entries means all providers are enabled by default.
            return len(LLM_PROVIDERS)

        configured = {item['provider_id']: item.get('enabled', True) for item in items}
        enabled_count = sum(1 for p in LLM_PROVIDERS if configured.get(p, True))
        return enabled_count if enabled_count > 0 else len(LLM_PROVIDERS)
    except Exception as e:
        logger.warning(f"Error getting provider config: {e}")
        return len(LLM_PROVIDERS)
