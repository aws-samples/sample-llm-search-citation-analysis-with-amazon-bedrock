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

from shared.config import PROVIDERS
from shared.utils import get_dynamodb_resource

logger = logging.getLogger(__name__)


def get_enabled_provider_count(table_name: str | None = None) -> int:
    """Return the number of providers currently enabled in the config table.

    Fallback rules:
    - If ``DYNAMODB_TABLE_PROVIDER_CONFIG`` (or legacy ``PROVIDER_CONFIG_TABLE``,
      or the passed ``table_name``) is not set, return ``len(PROVIDERS)``
      (treat all providers as enabled).
    - If the table scan raises, log and return ``len(PROVIDERS)`` —
      provider-count is a denominator in visibility-score math and
      returning zero would produce div-by-zero or useless metrics.
    - If the table is empty, return ``len(PROVIDERS)``.
    - Otherwise count entries that are explicitly enabled (missing
      ``enabled`` field defaults to True, matching the dashboard's
      convention).

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
        return len(PROVIDERS)

    try:
        table = get_dynamodb_resource().Table(resolved)
        response = table.scan(ProjectionExpression='provider_id, enabled')
        items = response.get('Items', [])

        if not items:
            # No config entries means all providers are enabled by default.
            return len(PROVIDERS)

        # Count providers that are explicitly enabled OR absent from the
        # table (default-on). Matches the dashboard's opt-out semantics.
        configured = {item['provider_id']: item.get('enabled', True) for item in items}
        enabled_count = sum(1 for p in PROVIDERS if configured.get(p, True))
        return enabled_count if enabled_count > 0 else len(PROVIDERS)
    except Exception as e:
        logger.warning(f"Error getting provider config: {e}")
        return len(PROVIDERS)
