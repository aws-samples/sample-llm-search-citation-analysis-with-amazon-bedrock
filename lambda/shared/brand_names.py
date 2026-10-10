"""Brand names: one identity for every spelling of a brand, and the configured spelling of a tracked one.

The extraction model names a brand as the answer spells it ("SKY Airline", "Sky",
"American"); the brand configuration spells each tracked brand once ("Sky Airline",
"American Airlines"). ``normalize_brand_key`` gives two spellings of one brand the
same key, and ``BrandIndex`` maps a model's name onto the configured brand, so the
KPIs, the leaderboard and the alerts count one brand once, under its configured
spelling. Ships in both Lambda layers (``lambda/shared``).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any

FIRST_PARTY = 'first_party'
COMPETITOR = 'competitor'

#: Removed wherever they appear: a mark never distinguishes two brands, and NFKD would spell ``™`` as ``TM``.
_TRADEMARK_MARKS = ('®', '™', '℠')
#: Stripped from the end of a key (with the spaces around them): "Sky Airline." names Sky Airline.
_TRAILING_PUNCTUATION = ' .,;:!?'


def normalize_brand_key(name: str) -> str:
    """The identity of a brand name: case-, accent- and whitespace-insensitive, without trailing punctuation or ®/™.

    NFKD compatibility decomposition (so a ligature or a full-width letter reads
    as its plain letters), combining marks dropped, case folded, inner
    whitespace collapsed to one space, outer whitespace and trailing punctuation
    stripped. Idempotent: a key is its own key.
    """
    for mark in _TRADEMARK_MARKS:
        name = name.replace(mark, '')
    decomposed = unicodedata.normalize('NFKD', name)
    plain = ''.join(char for char in decomposed if unicodedata.category(char) != 'Mn')
    return ' '.join(plain.casefold().split()).rstrip(_TRAILING_PUNCTUATION)


def _is_word_prefix(prefix: str, key: str) -> bool:
    """Whether ``prefix`` is the first word(s) of ``key`` (``"sky"`` of ``"sky airline"``, not of ``"skyline"``)."""
    return key.startswith(f'{prefix} ')


def _configured_names(value: object) -> list[str]:
    """The strings of one stored tracked-brands list (anything else is not a name)."""
    values = value if isinstance(value, (list, tuple)) else []
    return [name for name in values if isinstance(name, str)]


class BrandIndex:
    """The tracked brands of a brand configuration, found under any spelling of their names."""

    def __init__(self, first_party: Iterable[str], competitors: Iterable[str]) -> None:
        self._brands: dict[str, tuple[str, str]] = {}
        # First-party names go in first: a name configured on both sides is first-party.
        # A blank name has no key and is skipped.
        for classification, names in ((FIRST_PARTY, first_party), (COMPETITOR, competitors)):
            for name in names:
                key = normalize_brand_key(name)
                if key:
                    self._brands.setdefault(key, (name.strip(), classification))

    @classmethod
    def from_config(cls, config: Mapping[str, Any] | None) -> BrandIndex:
        """The index of a brand configuration's ``tracked_brands`` (``first_party`` and ``competitors``)."""
        tracked = (config or {}).get('tracked_brands')
        lists = tracked if isinstance(tracked, Mapping) else {}
        return cls(_configured_names(lists.get('first_party')), _configured_names(lists.get('competitors')))

    def canonical(self, name: str) -> tuple[str, str] | None:
        """``(configured spelling, classification)`` of the tracked brand ``name`` spells, or ``None``.

        ``name`` matches a tracked brand when their keys are equal; otherwise
        when one key is the first word(s) of the other ("Sky" and "Sky Airline
        S.A." both name "Sky Airline") and exactly one tracked brand fits. Two
        fitting brands ("Sky" with "Sky Andes" and "Sky Peru" tracked) match
        nothing: the model's name stays.
        """
        key = normalize_brand_key(name)
        if not key:
            return None
        exact = self._brands.get(key)
        if exact is not None:
            return exact
        fitting = [
            brand for brand_key, brand in self._brands.items()
            if _is_word_prefix(key, brand_key) or _is_word_prefix(brand_key, key)
        ]
        return fitting[0] if len(fitting) == 1 else None


def canonicalize_brands(brands: list[dict[str, Any]], index: BrandIndex) -> list[dict[str, Any]]:
    """``brands`` (in place) with every tracked brand under its configured spelling and classification.

    A brand the index does not know keeps the model's name and classification.
    Two entries that now share a name are not merged here: the KPI engine
    counts a brand once per answer by key.
    """
    for brand in brands:
        name = brand.get('name')
        match = index.canonical(name) if isinstance(name, str) else None
        if match is not None:
            brand['name'], brand['classification'] = match
    return brands


__all__ = [
    'COMPETITOR',
    'FIRST_PARTY',
    'BrandIndex',
    'canonicalize_brands',
    'normalize_brand_key',
]
