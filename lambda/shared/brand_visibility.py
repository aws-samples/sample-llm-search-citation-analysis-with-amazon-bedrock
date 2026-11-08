"""
Shared building blocks for the brand-visibility analysis handlers.

The tracked brand names of a brand configuration, and the one rule that sorts
an extracted brand mention into first-party, competitor, or neither, shared
by the action-list rules (``shared.recommendation_rules``,
``shared.content_idea_rules``) so they cannot drift apart on the matching
rules (audit items 9 and 22 replaced substring matching with
`shared.utils.brand_names_match`).
"""

from __future__ import annotations

import logging
from typing import Any

from shared.utils import brand_names_match

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

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
