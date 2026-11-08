"""Orders shared by the action-list rules, so a scope's lists never depend on the order its keywords were read or merged in."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from typing import Any

from shared.dynamo_decimal import to_int

#: Rank of a brand named without one: below every real rank.
UNRANKED = 999


def keyword_order(keyword: str) -> tuple[str, str]:
    """A keyword's place in a scope: case-insensitive, then exact (the order ``ReportScope.keywords`` holds)."""
    return keyword.casefold(), keyword


def brand_rank(brand: Mapping[str, Any]) -> int:
    """A brand mention's rank as an integer (``UNRANKED`` when it has none)."""
    return to_int(brand.get('rank'), UNRANKED)


def brand_mentions(rows: Iterable[Mapping[str, Any]]) -> Iterator[tuple[str, Mapping[str, Any]]]:
    """Every extracted brand of ``rows`` with the provider whose answer named it."""
    for row in rows:
        provider = str(row.get('provider', ''))
        for brand in row.get('brands') or []:
            yield provider, brand


__all__ = ['UNRANKED', 'brand_mentions', 'brand_rank', 'keyword_order']
