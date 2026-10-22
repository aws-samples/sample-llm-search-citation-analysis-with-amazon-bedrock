"""
Response-size budgets for API handlers.

A synchronous Lambda invocation may return at most 6 MiB, measured on the
proxy envelope the runtime posts back (``{"statusCode", "headers", "body"}``),
not on the data: the body is a JSON string inside that JSON, so every quote
and backslash in it is escaped a second time, and ``json.dumps`` writes every
non-ASCII character as a 6-byte ``\\uXXXX`` escape. A 1 MB DynamoDB page of
Spanish answer text can therefore become several MB on the wire.

Two budgets follow from that:

- ``PAGE_BUDGET_BYTES``: what one page of a paginated or top-N list should
  stay under. Handlers cut their lists with ``take_within_budget`` and hand
  the rest out through a ``next_token`` (``shared.cursors``).
- ``SPILL_THRESHOLD_BYTES``: above this, ``shared.response_spill`` moves the
  body to S3 instead of letting the runtime fail with RequestEntityTooLarge
  (API Gateway answers that with a bare 502). Reaching it means a route
  outgrew its design; it is a safety net, not a pagination strategy.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from shared.dynamo_decimal import DecimalEncoder

# The Lambda synchronous response cap (6 MiB). The runtime's error reports
# 6291556, the cap plus its own framing; the envelope itself is held to 6 MiB.
LAMBDA_RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024

# Room under the cap for the runtime's framing and for headers the measurement
# cannot see (API Gateway adds its own): about 5 MB. Every response above it
# is spilled.
SPILL_THRESHOLD_BYTES = LAMBDA_RESPONSE_LIMIT_BYTES * 4 // 5

# One page of a list. Small enough for a fast first paint and far below the
# spill threshold even after the envelope's second round of escaping.
PAGE_BUDGET_BYTES = 1_000_000

# Responses at or above this size are logged with their size as a metric, so
# a route growing towards the threshold is visible before it is spilled.
LARGE_RESPONSE_BYTES = 1_000_000


def json_bytes(value: Any) -> int:
    """UTF-8 length of ``value`` serialized the way ``shared.api_response`` writes bodies."""
    return len(json.dumps(value, cls=DecimalEncoder, default=str).encode('utf-8'))


def envelope_bytes(response: dict[str, Any]) -> int:
    """UTF-8 length of a whole proxy response as the Lambda runtime posts it.

    The body string is escaped a second time here, which is what the 6 MiB cap
    is measured against.
    """
    return len(json.dumps(response, cls=DecimalEncoder, default=str).encode('utf-8'))


def take_within_budget[T](
    items: Sequence[T],
    max_bytes: int = PAGE_BUDGET_BYTES,
    max_items: int | None = None,
) -> tuple[list[T], bool]:
    """The longest prefix of ``items`` whose JSON fits ``max_bytes``, and whether any were left out.

    The first item is always kept, however large, so a cursor over the list
    always advances; a single oversized item is the spill guard's job. Sizes
    are measured with the body serializer (each item plus its separator), which
    is what the page will cost before the envelope's escaping.
    """
    limit = len(items) if max_items is None else max(0, min(max_items, len(items)))
    taken: list[T] = []
    used = 2  # the enclosing [ ]
    for item in items[:limit]:
        # json.dumps separates list items with ', ' (2 bytes).
        cost = json_bytes(item) + 2
        if taken and used + cost > max_bytes:
            return taken, True
        taken.append(item)
        used += cost
    return taken, len(taken) < len(items)
