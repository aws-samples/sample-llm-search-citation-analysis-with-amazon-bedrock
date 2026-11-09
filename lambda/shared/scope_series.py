"""
A scope's per-run series (design 2.45.0 §2.2): one pooled row per run, kept up to date by deltas.

``row(scope, ts)`` is the sum of ``tally(k, ts)`` over the member keywords ``k``
in the row's bitmap. Every field is invertible, so a member can be added or
removed exactly: counts are summed, and what a ``RunTally`` keeps as a set or
a minimum (models, a brand's engines, its best rank) is kept as a count per
value. The build keeps the series fresh without re-reading history:

- a new run (or a late write, or a rerun of an old run): ``add`` the tally of
  every member whose bit is not set in that run's row yet;
- a member added to the scope: ``add`` its KeywordRunKpis (+ KeywordRunBrands) rows;
- a member removed: ``subtract`` them; a bit left set (a row missing from the
  history) marks the series ``dirty`` and the next build rebuilds it whole.

**Brands.** A stored row keeps the first-party and tracked brands and the
``SERIES_BRANDS`` most visible others; ``threshold`` is an upper bound on the
points of every brand it does not keep (0 while the row is complete). Adding a
member to a truncated row raises the bound by the most points one of its
unkept brands adds; subtracting never raises it. ``leaderboard_certificate``
proves a multi-run top-N exact with these bounds (the threshold algorithm), or
says it cannot (``exact: False``: a view job recomputes it from KeywordRunBrands).
"""

from __future__ import annotations

import base64
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from shared.kpi_engine import SPLIT_LABELS
from shared.kpi_tally import COUNT_FIELDS, BrandTally, RunTally

#: 2 (2.52.0): the counts carry ``citations_v2`` and ``citations_unversioned`` (``shared.kpi_tally.COUNT_FIELDS``); a version-1 series is read
#: as absent and rebuilt from the answers (the next snapshot build rebuilds it in full).
SERIES_VERSION = 2
SERIES_BRANDS = 500
SERIES_RUNS = 365
#: A row holding more brands than this while a build adds to it is cut to ``COMPACT_KEEP`` (the threshold keeps it sound).
COMPACT_BRANDS = 3 * SERIES_BRANDS
COMPACT_KEEP = 2 * SERIES_BRANDS

_MENTIONING = COUNT_FIELDS.index('mentioning')

# A stored brand: [key, name, classification, mentions, points, rank_sum, rank_count, split, engines {p: n}, best {rank: n}, n]
_KEY, _NAME, _CLASS, _MENTIONS, _POINTS, _RANK_SUM, _RANK_COUNT, _SPLIT, _ENGINES, _BEST, _COUNT = range(11)


def _bump(counts: dict[str, int], key: str, sign: int) -> None:
    value = counts.get(key, 0) + sign
    if value:
        counts[key] = value
    else:
        counts.pop(key, None)


def _new_brand(brand: BrandTally) -> list[Any]:
    return [brand.key, brand.name, brand.classification, 0, 0, 0, 0, [0] * len(SPLIT_LABELS), {}, {}, 0]


def _add_brand(stored: list[Any], brand: BrandTally, sign: int) -> None:
    stored[_MENTIONS] += sign * brand.mentions
    stored[_POINTS] += sign * brand.points
    stored[_RANK_SUM] += sign * brand.rank_sum
    stored[_RANK_COUNT] += sign * brand.rank_count
    stored[_SPLIT] = [total + sign * added for total, added in zip(stored[_SPLIT], brand.split, strict=True)]
    for engine in brand.engines:
        _bump(stored[_ENGINES], engine, sign)
    if brand.best_rank is not None:
        _bump(stored[_BEST], str(brand.best_rank), sign)
    stored[_COUNT] += sign


def brand_leaderboard_key(stored: Sequence[Any]) -> tuple[int, int, str]:
    """``shared.kpi_tally``'s brand order: visibility points, then mentions, then name."""
    return (-int(stored[_POINTS]), -int(stored[_MENTIONS]), str(stored[_NAME]).lower())


@dataclass
class SeriesRow:
    """One run of a scope, pooled over the member keywords in ``members`` (a bitmap of member indices)."""

    timestamp: str
    counts: dict[str, list[int]] = field(default_factory=dict)
    models: dict[str, dict[str, int]] = field(default_factory=dict)
    keywords: int = 0
    keywords_naming: int = 0
    brands: dict[str, list[Any]] = field(default_factory=dict)
    threshold: int = 0
    truncated: bool = False
    brands_total: int | None = 0
    members: int = 0

    def has(self, index: int) -> bool:
        return bool(self.members >> index & 1)

    def apply(self, index: int, tally: RunTally, sign: int) -> bool:
        """Add (``sign`` 1) or subtract (-1) member ``index``'s tally of this run; whether the row changed."""
        if self.has(index) == (sign > 0):
            return False
        for provider, values in tally.engines.items():
            total = self.counts.setdefault(provider, [0] * len(COUNT_FIELDS))
            self.counts[provider] = [now + sign * value for now, value in zip(total, values, strict=True)]
            if not any(self.counts[provider]):
                del self.counts[provider]
        for provider, names in tally.models.items():
            for name in names:
                _bump(self.models.setdefault(provider, {}), name, sign)
            if not self.models.get(provider):
                self.models.pop(provider, None)
        self.keywords += sign * (tally.answers > 0)
        self.keywords_naming += sign * any(values[_MENTIONING] for values in tally.engines.values())
        self._apply_brands(tally.brands, sign)
        self.members ^= 1 << index
        return True

    def _apply_brands(self, brands: Iterable[BrandTally], sign: int) -> None:
        unkept_points = 0
        for brand in brands:
            stored = self.brands.get(brand.key)
            if stored is None and (sign < 0 or self.truncated):
                unkept_points = max(unkept_points, brand.points)
                continue
            if stored is None:
                stored = self.brands[brand.key] = _new_brand(brand)
            _add_brand(stored, brand, sign)
            if stored[_COUNT] <= 0:
                del self.brands[brand.key]
        if sign > 0 and self.truncated:
            self.threshold += unkept_points
        if self.truncated:
            self.brands_total = None
        else:
            self.brands_total = len(self.brands)

    def truncate(self, keep: int, always: Collection[str]) -> None:
        """Keep the first-party brands, the brands named in ``always`` (lower case) and the ``keep`` most visible others."""
        pinned = {key for key, stored in self.brands.items() if stored[_CLASS] == 'first_party' or str(stored[_NAME]).lower() in always}
        others = sorted((stored for key, stored in self.brands.items() if key not in pinned), key=brand_leaderboard_key)
        if len(others) <= keep:
            return
        dropped = others[keep:]
        self.threshold = max(self.threshold, int(dropped[0][_POINTS]))
        for stored in dropped:
            del self.brands[str(stored[_KEY])]
        self.truncated = True

    def to_json(self) -> dict[str, Any]:
        width = max(1, (self.members.bit_length() + 7) // 8)
        return {
            't': self.timestamp, 'c': self.counts, 'm': self.models, 'k': self.keywords, 'kn': self.keywords_naming,
            'b': list(self.brands.values()), 'th': self.threshold, 'tr': self.truncated, 'bt': self.brands_total,
            'bm': base64.b64encode(self.members.to_bytes(width, 'little')).decode('ascii'),
        }

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> SeriesRow:
        return cls(
            timestamp=str(value['t']), counts={key: list(counts) for key, counts in value['c'].items()},
            models={key: dict(names) for key, names in value['m'].items()}, keywords=int(value['k']), keywords_naming=int(value['kn']),
            brands={str(stored[_KEY]): list(stored) for stored in value['b']}, threshold=int(value['th']), truncated=bool(value['tr']),
            brands_total=value.get('bt'), members=int.from_bytes(base64.b64decode(value['bm']), 'little'),
        )

    def tally(self) -> RunTally:
        """The row as one ``RunTally`` of the kept brands (``shared.kpi_tally`` pools it like a keyword's)."""
        brands = tuple(
            BrandTally(
                str(stored[_KEY]), str(stored[_NAME]), str(stored[_CLASS]), stored[_MENTIONS], stored[_POINTS], stored[_RANK_SUM],
                stored[_RANK_COUNT], min((int(rank) for rank in stored[_BEST]), default=None), tuple(stored[_SPLIT]), tuple(sorted(stored[_ENGINES])),
            )
            for stored in sorted(self.brands.values(), key=brand_leaderboard_key)
        )
        return RunTally(
            keyword='', timestamp=self.timestamp, engines={key: tuple(counts) for key, counts in self.counts.items()},
            models={key: tuple(sorted(names)) for key, names in self.models.items()}, brands=brands,
            brands_total=len(brands) if self.brands_total is None else self.brands_total,
        )


class ScopeSeries:
    """Every run row of one scope plus the member index the bitmaps use."""

    def __init__(self, scope_key: str, doc: dict[str, Any] | None = None, *, owned: str = '') -> None:
        self.scope_key = scope_key
        usable = doc is not None and doc.get('v') == SERIES_VERSION
        self.members: list[str] = list(doc['members']) if usable and doc else []
        self.current: set[str] = set(doc.get('current', [])) if usable and doc else set()
        self.rows: dict[str, SeriesRow] = {row['t']: SeriesRow.from_json(row) for row in doc['rows']} if usable and doc else {}
        self.dirty = bool(doc.get('dirty')) if usable and doc else False
        self.full_builds_ago = int(doc.get('full_builds_ago', 0)) if usable and doc else 0
        self.owned: str = str(doc.get('owned', '')) if usable and doc else owned
        """The owned-domains fingerprint the rows' citation counts were built with (``shared.kpi_tally.owned_fingerprint``)."""
        self.always: frozenset[str] = frozenset()
        """Brand names (lower case) a row never drops: the tracked brands."""
        self._index = {keyword: position for position, keyword in enumerate(self.members)}

    def index_of(self, keyword: str) -> int:
        position = self._index.get(keyword)
        if position is None:
            position = self._index[keyword] = len(self.members)
            self.members.append(keyword)
        return position

    def add(self, keyword: str, tally: RunTally) -> bool:
        """Count ``keyword``'s run ``tally`` once (a no-op when that run already counts it)."""
        if not tally.engines:
            return False
        row = self.rows.get(tally.timestamp)
        if row is None:
            row = self.rows[tally.timestamp] = SeriesRow(tally.timestamp)
        changed = row.apply(self.index_of(keyword), tally, 1)
        if len(row.brands) > COMPACT_BRANDS:
            row.truncate(COMPACT_KEEP, self.always)
        return changed

    def subtract(self, keyword: str, tally: RunTally) -> bool:
        row = self.rows.get(tally.timestamp)
        position = self._index.get(keyword)
        if row is None or position is None:
            return False
        changed = row.apply(position, tally, -1)
        if not row.members:
            del self.rows[tally.timestamp]
        return changed

    def runs_of(self, keyword: str) -> set[str]:
        """The runs whose rows count ``keyword``."""
        position = self._index.get(keyword)
        return set() if position is None else {stamp for stamp, row in self.rows.items() if row.has(position)}

    def remove(self, keyword: str, history: Iterable[RunTally]) -> None:
        """Subtract every run of a member that left the scope; a run its history lacks makes the series dirty."""
        for tally in history:
            self.subtract(keyword, tally)
        if self.runs_of(keyword):
            self.dirty = True

    def to_json(self, *, keep_brands: int, always: Collection[str], runs: int = SERIES_RUNS) -> dict[str, Any]:
        """The stored series: the newest ``runs`` rows, each truncated to ``keep_brands`` brands."""
        kept = sorted(self.rows)[-runs:]
        for stamp in kept:
            self.rows[stamp].truncate(keep_brands, always)
        return {
            'v': SERIES_VERSION, 'scope_key': self.scope_key, 'members': self.members, 'current': sorted(self.current),
            'dirty': self.dirty, 'full_builds_ago': self.full_builds_ago, 'owned': self.owned,
            'rows': [self.rows[stamp].to_json() for stamp in kept],
        }

    def agrees_with(self, rebuilt: ScopeSeries) -> bool:
        """Whether every row equals ``rebuilt``'s (the self-check): counts, models and keywords, and every brand both keep."""
        if set(self.rows) != set(rebuilt.rows):
            return False
        for stamp, row in self.rows.items():
            other = rebuilt.rows[stamp]
            same = (row.counts, row.models, row.keywords, row.keywords_naming) == (other.counts, other.models, other.keywords, other.keywords_naming)
            if not same or any(other.brands.get(key, stored) != stored for key, stored in row.brands.items()):
                return False
        return True


# ---------------------------------------------------------------------------
# Leaderboard certificate
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Certificate:
    """The top brands of several runs by summed points (lower bounds), and whether the bounds prove them exact."""

    brands: list[tuple[str, str, int, int]]
    """``(key, name, points, mentions)`` in leaderboard order."""
    exact: bool


def leaderboard_certificate(rows: Sequence[SeriesRow], top: int = 10) -> Certificate:
    """The top ``top`` brands over ``rows`` and whether the per-run thresholds prove that list and its counts exact.

    Exact when every listed brand is kept in every row that could hold it
    (no threshold is added to it) and no unlisted brand, kept or not, could
    reach the last listed brand's points.
    """
    points: dict[str, int] = {}
    mentions: dict[str, int] = {}
    names: dict[str, str] = {}
    missing: dict[str, int] = {}
    for row in rows:
        for key, stored in row.brands.items():
            points[key] = points.get(key, 0) + int(stored[_POINTS])
            mentions[key] = mentions.get(key, 0) + int(stored[_MENTIONS])
            names[key] = str(stored[_NAME])
    never = sum(row.threshold for row in rows)
    for key in points:
        missing[key] = sum(row.threshold for row in rows if key not in row.brands)
    ranked = sorted(points, key=lambda key: (-points[key], -mentions[key], names[key].lower()))
    listed, rest = ranked[:top], ranked[top:]
    floor = points[listed[-1]] if listed else 0
    exact = (
        all(missing[key] == 0 for key in listed)
        and all(missing[key] == 0 or points[key] + missing[key] < floor for key in rest)
        and (never == 0 or (len(listed) == top and never < floor))
    )
    return Certificate([(key, names[key], points[key], mentions[key]) for key in listed], exact)


__all__ = [
    'COMPACT_BRANDS',
    'COMPACT_KEEP',
    'SERIES_BRANDS',
    'SERIES_RUNS',
    'SERIES_VERSION',
    'Certificate',
    'ScopeSeries',
    'SeriesRow',
    'brand_leaderboard_key',
    'leaderboard_certificate',
]
