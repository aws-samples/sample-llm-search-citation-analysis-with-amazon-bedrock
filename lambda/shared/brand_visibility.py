"""
Shared building blocks for the brand-visibility analysis handlers.

``get-recommendations`` and ``content-studio`` both walk the most recent
SearchResults rows for the active keywords and sort every extracted brand
mention into first-party, competitor, or neither. These helpers are the
single home for that pipeline, so the two handlers cannot drift apart on
keyword discovery, query limits, or the matching rules (audit items 9 and
22 replaced substring matching with `shared.utils.brand_names_match`).
"""

from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.keyword_groups import ACTIVE_KEYWORD_STATUS
from shared.utils import brand_names_match

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Most recent SearchResults rows fetched per keyword.
RESULTS_PER_KEYWORD = 20
# Bound on the fallback scan used when no keyword is known.
FALLBACK_SCAN_LIMIT = 500
# The Keywords-table GSI keyed by status, sorted by keyword text.
_STATUS_INDEX = 'StatusIndex'


def _first_active_keywords(keywords_table: Any, max_keywords: int) -> list[str]:
    """The first ``max_keywords`` active keyword texts in keyword order.

    One StatusIndex query page: the key condition selects exactly the active
    rows (no filter runs after ``Limit``), so the page holds ``max_keywords``
    of them whenever that many exist, and the index's ``keyword`` sort key
    makes the choice the same on every call. A scan with a status filter
    applied ``Limit`` before the filter and returned an arbitrary handful, or
    none, once the table held thousands of keywords.
    """
    if max_keywords < 1:
        return []
    response = keywords_table.query(
        IndexName=_STATUS_INDEX,
        KeyConditionExpression=Key('status').eq(ACTIVE_KEYWORD_STATUS),
        ProjectionExpression='keyword',
        Limit=max_keywords,
    )
    return [item['keyword'] for item in response.get('Items', []) if item.get('keyword')]


def tracked_brand_names(config: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return the configured ``(first_party, competitors)`` names, lowercased.

    An empty ``first_party`` list is the handlers' signal that brand tracking
    has not been configured yet.
    """
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors = [b.lower() for b in tracked_brands.get("competitors", [])]
    return first_party, competitors


def classify_brand(
    brand: dict[str, Any],
    first_party: list[str],
    competitors: list[str],
) -> str | None:
    """Return ``'first_party'``, ``'competitor'`` or ``None`` for one brand mention.

    The LLM-assigned ``classification`` is preferred whenever present (any
    other value, such as ``'other'``, classifies as neither). Only a missing
    classification falls back to an exact brand-name match against the
    tracked lists — never a substring match (audit items 9 and 22). A name
    matching both lists counts as first-party.
    """
    name = brand.get('name', '').lower()
    classification = brand.get('classification')
    if classification is not None:
        return classification if classification in ('first_party', 'competitor') else None

    if any(brand_names_match(name, fp) for fp in first_party):
        return 'first_party'
    if any(brand_names_match(name, c) for c in competitors):
        return 'competitor'
    return None


def load_recent_search_results(
    dynamodb: Any,
    search_table_name: str,
    *,
    max_keywords: int,
    keywords: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """Return recent SearchResults rows for the keywords under analysis.

    Keyword discovery: ``keywords`` when given, otherwise the first
    ``max_keywords`` active keywords, in keyword order, from the StatusIndex
    of the Keywords table named by ``DYNAMODB_TABLE_KEYWORDS`` (read per call
    so a caller-scoped environment applies). With no keyword at all the
    function falls back to a bounded scan of the search table.

    The first ``max_keywords`` keywords are each queried by partition key
    for their most recent rows; a failing keyword is logged and skipped so
    one bad partition cannot sink the whole analysis.

    Args:
        dynamodb: The caller's boto3 DynamoDB resource (tests patch it on the
            handler module, so it is passed in rather than created here).
        search_table_name: Name of the SearchResults table.
        max_keywords: Cap on how many keywords are queried.
        keywords: Explicit keyword texts (e.g. a keyword group); ``None`` or
            empty means "discover the active keywords".
    """
    search_table = dynamodb.Table(search_table_name)

    keywords = list(keywords) if keywords is not None else []
    keywords_table_name = os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    if not keywords and keywords_table_name:
        keywords = _first_active_keywords(dynamodb.Table(keywords_table_name), max_keywords)

    if not keywords:
        response = search_table.scan(Limit=FALLBACK_SCAN_LIMIT)
        return response.get('Items', [])

    items: list[dict[str, Any]] = []
    for keyword in keywords[:max_keywords]:
        try:
            response = search_table.query(
                KeyConditionExpression=Key('keyword').eq(keyword),
                ScanIndexForward=False,
                Limit=RESULTS_PER_KEYWORD,
            )
            items.extend(response.get('Items', []))
        except Exception:
            logger.exception('Error querying keyword %r', keyword)
            continue
    return items
