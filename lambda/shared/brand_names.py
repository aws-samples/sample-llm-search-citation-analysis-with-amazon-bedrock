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


#: Trailing words that name the same company in another form: legal forms and the words a company name ends with
#: ("Sky Airline S.A." and "Altiplano Airlines" name Sky Airline and Altiplano). Compared without dots.
_COMPANY_SUFFIXES = frozenset({
    'sa', 'sl', 'sas', 'slu', 'sau', 'srl', 'spa', 'ltda', 'inc', 'ltd', 'llc', 'plc', 'gmbh', 'ag', 'nv', 'bv',
    'corp', 'corporation', 'co', 'company', 'group', 'grupo', 'holding', 'holdings', 'international',
    'air', 'airline', 'airlines', 'airways', 'hotel', 'hotels', 'hoteles', 'resorts',
})


def _company_core(key: str) -> str:
    """``key`` without its trailing company words (``"sky airline s.a"`` → ``"sky"``); never empty when ``key`` is not."""
    words = key.split()
    while len(words) > 1 and words[-1].replace('.', '').rstrip(',') in _COMPANY_SUFFIXES:
        words.pop()
    return ' '.join(words)


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
        """``(configured spelling, classification)`` of the tracked brand ``name`` is another spelling of, or ``None``.

        ``name`` is a tracked brand when their keys are equal; otherwise when
        they are equal without their trailing company words ("Sky Airline
        S.A.", "Altiplano Airlines"), or when ``name`` is the first word(s) of
        exactly one tracked brand ("Sky" for "Sky Airline"). A name that only
        starts with a tracked brand ("Example Hotels Old Town" with
        "Example Hotels" tracked) is another entity of that brand, not the brand:
        see ``owner``. Two fitting brands match nothing: the model's name stays.
        """
        key = normalize_brand_key(name)
        if not key:
            return None
        exact = self._brands.get(key)
        if exact is not None:
            return exact
        core = _company_core(key)
        same = [brand for brand_key, brand in self._brands.items() if _company_core(brand_key) == core]
        if same:
            # Tracked names equal without their company words are aliases of one brand ("Example", "Example
            # Hotels", "Example Hotel Company"): the first configured one names it, unless they are on both sides.
            return same[0] if len({classification for _name, classification in same}) == 1 else None
        shorter = [brand for brand_key, brand in self._brands.items() if _is_word_prefix(key, brand_key)]
        return shorter[0] if len(shorter) == 1 else None

    def owner(self, name: str) -> tuple[str, str] | None:
        """``(configured spelling, classification)`` of the one tracked brand whose name ``name`` starts with, or ``None``.

        A hotel, store, branch or product line named after its brand
        ("Example Hotels Old Town", "Brisa Plaza" with "Brisa"
        tracked) belongs to that brand but is a separate entity: it keeps its
        own name and takes the brand's classification. Of nested tracked names
        ("Sky" and "Sky Andes" for "Sky Andes Express") the longest owns it.
        """
        key = normalize_brand_key(name)
        if not key:
            return None
        longer = [(brand_key, brand) for brand_key, brand in self._brands.items() if _is_word_prefix(brand_key, key)]
        return max(longer, key=lambda fit: len(fit[0]))[1] if longer else None


def canonicalize_brands(brands: list[dict[str, Any]], index: BrandIndex) -> list[dict[str, Any]]:
    """``brands`` (in place) with every tracked brand under its configured spelling and classification.

    Another spelling of a tracked brand takes its configured name. An entity
    named after a tracked brand (a hotel of the chain) keeps its own name,
    takes the brand's classification, and names the brand as its
    ``parent_company`` when the model gave none. A brand the index does not
    know keeps the model's name and classification. Two entries that now share
    a name are not merged here: the KPI engine counts a brand once per answer by key.
    """
    for brand in brands:
        name = brand.get('name')
        if not isinstance(name, str):
            continue
        match = index.canonical(name)
        if match is not None:
            brand['name'], brand['classification'] = match
            continue
        owner = index.owner(name)
        if owner is not None:
            brand['classification'] = owner[1]
            if not brand.get('parent_company'):
                brand['parent_company'] = owner[0]
    return brands


__all__ = [
    'COMPETITOR',
    'FIRST_PARTY',
    'BrandIndex',
    'canonicalize_brands',
    'normalize_brand_key',
]
