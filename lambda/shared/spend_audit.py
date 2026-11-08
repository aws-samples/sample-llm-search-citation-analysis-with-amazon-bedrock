"""
The audit record of a write or spend call (TENETS.md, D4): who, when, what, how it ended, and why.

One item per call in ``CitationAnalysis-McpState`` (``audit#<actor>`` / ``<at>#<operation>#<nonce>``, kept 365
days). The MCP server writes one for every MCP write and spend tool call (``mcp/state.py``), and the SEO router one
for every paid one-off SEO request, whatever client sent it (``shared.seo_spend_limit``). ``tool`` says which:
the MCP tool name, or ``seo-api``.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

AUDIT_TTL = timedelta(days=365)


def audit_item(actor: str, tool: str, operation: str, outcome: str, at: datetime, **details: Any) -> dict[str, Any]:
    """The audit item; ``details`` with a ``None`` value are left out."""
    item: dict[str, Any] = {
        'pk': f'audit#{actor}',
        'sk': f'{at.isoformat().replace("+00:00", "Z")}#{operation}#{secrets.token_hex(4)}',
        'tool': tool,
        'operation': operation,
        'outcome': outcome,
        'ttl': int((at + AUDIT_TTL).timestamp()),
    }
    item.update({name: value for name, value in details.items() if value is not None})
    return item


def put_audit(table: Any, item: dict[str, Any]) -> None:
    """Write ``item``; best effort: a failed write is logged, never raised (the call it records already ran)."""
    try:
        table.put_item(Item=item)
    except (BotoCoreError, ClientError):
        logger.exception('Could not write the audit record of %s', item.get('operation'))
