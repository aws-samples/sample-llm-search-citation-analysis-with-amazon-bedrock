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

#: The brand-name rule an answer row's ``brands`` were stored under (``brands_version`` on the row, D2, D3). 2 (2.54.6):
#: a location named after a tracked brand keeps its own name under that brand. A row without it is from before 2.54.6,
#: when every name starting with a tracked brand was stored as that brand (2.38.1 to 2.54.5) or no name was mapped.
BRANDS_VERSION = 2

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


#: Trailing words that never tell two companies apart: legal forms and organisation words ("Sky Airline S.A.",
#: "Example Hotel Company"). Compared without dots.
_LEGAL_WORDS = frozenset({
    'sa', 'sl', 'sas', 'slu', 'sau', 'srl', 'spa', 'ltda', 'inc', 'ltd', 'llc', 'plc', 'gmbh', 'ag', 'nv', 'bv',
    'corp', 'corporation', 'co', 'company', 'group', 'grupo', 'holding', 'holdings', 'international',
})
#: Trailing industry words, by family. Two names equal without them are one company only within one family: "Sky
#: Airline" and "Sky Airlines" are, "Sky Airline" and "Sky Hotels" are two businesses.
_INDUSTRY_FAMILIES = {
    **dict.fromkeys(('air', 'airline', 'airlines', 'airways'), 'air'),
    **dict.fromkeys(('hotel', 'hotels', 'hoteles', 'resorts'), 'hotel'),
}


def _company_core(key: str) -> tuple[str, str | None]:
    """``key`` without its trailing legal and industry words, and the industry family those named (or ``None``).

    ``"sky airline s.a"`` → ``("sky", "air")``; never an empty core when ``key`` is not empty.
    """
    words = key.split()
    family: str | None = None
    while len(words) > 1:
        word = words[-1].replace('.', '').rstrip(',')
        if word in _LEGAL_WORDS:
            words.pop()
        elif word in _INDUSTRY_FAMILIES and family in (None, _INDUSTRY_FAMILIES[word]):
            family = _INDUSTRY_FAMILIES[word]
            words.pop()
        else:
            break
    return ' '.join(words), family


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
        they are equal without their trailing legal and industry words ("Sky
        Airline S.A.", "Altiplano Airlines"), industry words only within one
        industry ("Sky Hotels" is not "Sky Airline"), or when ``name`` is the
        first word(s) of exactly one tracked brand ("Sky" for "Sky Airline").
        Aliases of one brand all answer its first configured name. A name that only
        starts with a tracked brand ("Example Hotels Old Town" with
        "Example Hotels" tracked) is another entity of that brand, not the brand:
        see ``owner``. Two fitting brands match nothing: the model's name stays.
        """
        key = normalize_brand_key(name)
        if not key:
            return None
        aliases = self._aliases(key)
        exact = self._brands.get(key)
        if exact is not None:
            # An exact name is shown as the first configured alias of its brand, so one brand is one leaderboard row.
            return next(brand for brand in aliases if brand[1] == exact[1])
        if aliases:
            # Tracked names equal without their company words are aliases of one brand ("Example", "Example
            # Hotels", "Example Hotel Company"): the first configured one names it, unless they are on both sides.
            return aliases[0] if len({classification for _name, classification in aliases}) == 1 else None
        shorter = [brand for brand_key, brand in self._brands.items() if _is_word_prefix(key, brand_key)]
        return shorter[0] if len(shorter) == 1 else None

    def _aliases(self, key: str) -> list[tuple[str, str]]:
        """The tracked brands ``key`` names once legal and industry words are dropped, in configured order.

        A tracked name of the same core matches when ``key`` names no industry,
        when both name the same one, or when the tracked name names none and no
        other tracked name of that core names a different one ("Sky Hotels" is
        not "Sky Airline"; "Altiplano Hotels" is not the "altiplano" alias of
        "Altiplano Air").
        """
        core, family = _company_core(key)
        same = [(brand, _company_core(brand_key)[1]) for brand_key, brand in self._brands.items() if _company_core(brand_key)[0] == core]
        return [brand for brand, other in same if self._same_industry(family, other, core)]

    def _same_industry(self, family: str | None, other: str | None, core: str) -> bool:
        """Whether a name of industry ``family`` can be a tracked name of industry ``other`` whose core is ``core``.

        Yes when the name names no industry, when both name the same one, or
        when the tracked name names none and no other tracked name of that core
        names a different one (the "altiplano" alias of "Altiplano Air" is an airline).
        """
        if family is None or other == family:
            return True
        if other is not None:
            return False
        named = {_company_core(brand_key)[1] for brand_key in self._brands if _company_core(brand_key)[0] == core}
        return named - {None} <= {family}

    def owner(self, name: str) -> tuple[str, str] | None:
        """``(configured spelling, classification)`` of the one tracked brand whose name ``name`` starts with, or ``None``.

        A hotel, store, branch or product line named after its brand
        ("Example Hotels Old Town", "Brisa Plaza" with "Brisa"
        tracked) belongs to that brand but is a separate entity: it keeps its
        own name and takes the brand's classification. Of nested tracked names
        ("Sky" and "Sky Andes" for "Sky Andes Express") the longest owns it. A
        name of another industry is not the brand's ("Costamar Airlines" is no
        hotel of "Costamar").
        """
        key = normalize_brand_key(name)
        if not key:
            return None
        family = _company_core(key)[1]
        longer = []
        for brand_key, brand in self._brands.items():
            brand_core, brand_family = _company_core(brand_key)
            if _is_word_prefix(brand_key, key) and self._same_industry(family, brand_family, brand_core):
                longer.append((brand_key, brand))
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
    'BRANDS_VERSION',
    'COMPETITOR',
    'FIRST_PARTY',
    'BrandIndex',
    'canonicalize_brands',
    'normalize_brand_key',
]
