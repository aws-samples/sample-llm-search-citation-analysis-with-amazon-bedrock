"""
The KPIs of ``shared.kpi_engine`` kept as additive counts, one tally per keyword run.

Every KPI is a ratio of counts over answers (``docs/kpi-definitions.md``):
pooled values add the counts up and divide once. A ``RunTally`` holds those
counts for one keyword in one run, per AI engine, and per brand named, so a
history window sums small tallies instead of re-reading every answer. The
functions here compute from summed tallies exactly what ``brand_kpis``,
``brand_table`` and ``run_models`` compute from the answers themselves
(``test_kpi_tally.py`` proves it with hypothesis); the definitions live in
``shared.kpi_engine`` only.

Two things a tally fixes when it is built:

- the owned domains of the citation KPIs (``owned_fingerprint``): a tally
  built for other owned domains cannot answer them, and a reader rebuilds
  that run from its answers instead (``matches_owned``);
- with ``brand_cap``, the brands kept: every first-party brand, every tracked
  brand, then the most visible up to the cap, so a stored row stays small
  (``brands_total`` counts them all). Share of voice is unaffected: the
  mentions of every brand are counted per engine.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from shared.brand_names import FIRST_PARTY, normalize_brand_key
from shared.kpi_engine import (
    SPLIT_LABELS,
    UNVERSIONED_CITATIONS,
    Answer,
    Sighting,
    citation_rule,
    citation_versions,
    is_owned_domain,
    leaderboard,
    normalize_domain,
    percent,
    position_points,
    sentiment_fields,
    visibility_percent,
)

#: The counts of one engine's answers in a ``RunTally``, in this order.
COUNT_FIELDS: tuple[str, ...] = (
    'answers',
    'mentioning',
    'first_party_mentions',
    'total_mentions',
    'rank_sum',
    'rank_count',
    'top_1',
    'top_3',
    'points',
    *SPLIT_LABELS,
    'citing',
    'owned_pairs',
    'all_pairs',
    # Answers per citation rule they were stored under (``kpi_engine.citation_rule``), one count per rule.
    'citations_v2',
    'citations_unversioned',
)
#: The citation rules the tallies count, each by its ``COUNT_FIELDS`` entry. A rule a tally cannot name (a version
#: no count exists for) would be wrong in every pooled figure, so ``CITATIONS_VERSION`` must be one of these.
TALLIED_CITATION_RULES: Mapping[str, str] = {'2': 'citations_v2', UNVERSIONED_CITATIONS: 'citations_unversioned'}
_INDEX = {name: index for index, name in enumerate(COUNT_FIELDS)}
_SPLIT = tuple(_INDEX[label] for label in SPLIT_LABELS)
_TOTAL_MENTIONS = _INDEX['total_mentions']

Counts = tuple[int, ...]


def owned_fingerprint(owned_domains: Iterable[str]) -> str:
    """A short digest of a set of owned domains ('' for none): what a tally's citation counts were counted against."""
    domains = sorted({domain for domain in map(normalize_domain, owned_domains) if domain})
    if not domains:
        return ''
    return hashlib.sha256(json.dumps(domains).encode()).hexdigest()[:16]


class BrandTally(NamedTuple):
    """One brand's sightings in one keyword run (``brand_table``'s counts).

    A named tuple, not a dataclass: a year's window builds millions of them.
    """

    key: str
    name: str
    classification: str
    mentions: int
    points: int
    rank_sum: int
    rank_count: int
    best_rank: int | None
    split: Counts
    engines: tuple[str, ...]


@dataclass(frozen=True)
class RunTally:
    """The additive KPI counts of one keyword's answers in one run."""

    keyword: str
    timestamp: str
    engines: Mapping[str, Counts]
    """Each AI engine's counts (``COUNT_FIELDS``); only engines that answered."""
    models: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    brands: tuple[BrandTally, ...] = ()
    """The brands named, in the order first named."""
    brands_total: int = 0
    owned: str = ''
    """``owned_fingerprint`` of the owned domains the citation counts were counted against."""

    @property
    def answers(self) -> int:
        return sum(counts[0] for counts in self.engines.values())

    def matches_owned(self, fingerprint: str) -> bool:
        """Whether this tally's citation counts answer for owned domains of ``fingerprint`` (none configured needs none)."""
        return fingerprint in {'', self.owned}


# ---------------------------------------------------------------------------
# Building tallies from answers
# ---------------------------------------------------------------------------

def _answer_counts(answer: Answer, domains: Sequence[str]) -> list[int]:
    counts = [0] * len(COUNT_FIELDS)
    first_party = answer.first_party()
    counts[_INDEX['answers']] = 1
    rule_count = TALLIED_CITATION_RULES.get(citation_rule(answer.citations_version))
    if rule_count is not None:
        counts[_INDEX[rule_count]] = 1
    counts[_INDEX['first_party_mentions']] = len(first_party)
    counts[_INDEX['total_mentions']] = len(answer.sightings)
    if first_party:
        best = answer.best_first_party_rank()
        counts[_INDEX['mentioning']] = 1
        counts[_INDEX['points']] = position_points(best)
        if best is not None:
            counts[_INDEX['rank_sum']] = best
            counts[_INDEX['rank_count']] = 1
            counts[_INDEX['top_1']] = int(best == 1)
            counts[_INDEX['top_3']] = int(best <= 3)
        for sighting in first_party:
            if sighting.sentiment is not None:
                counts[_INDEX[sighting.sentiment]] += 1
    if domains:
        owned = sum(1 for domain in answer.cited_domains if is_owned_domain(domain, domains))
        counts[_INDEX['citing']] = int(owned > 0)
        counts[_INDEX['owned_pairs']] = owned
        counts[_INDEX['all_pairs']] = len(answer.cited_domains)
    return counts


def _add(total: list[int], counts: Iterable[int]) -> None:
    for index, value in enumerate(counts):
        total[index] += value


class _BrandSum:
    """A brand's counts while they are being added up."""

    __slots__ = ('best_rank', 'classification', 'engines', 'key', 'keywords', 'mentions', 'name', 'points', 'rank_count', 'rank_sum', 'split')

    def __init__(self, key: str, name: str, classification: str) -> None:
        self.key, self.name, self.classification = key, name, classification
        self.mentions = self.points = self.rank_sum = self.rank_count = 0
        self.best_rank: int | None = None
        self.split = [0] * len(SPLIT_LABELS)
        self.engines: set[str] = set()
        self.keywords: set[str] = set()

    def add_sighting(self, sighting: Sighting, provider: str) -> None:
        self.mentions += 1
        self.points += position_points(sighting.rank)
        if sighting.rank is not None:
            self.rank_sum += sighting.rank
            self.rank_count += 1
            self.best_rank = sighting.rank if self.best_rank is None else min(self.best_rank, sighting.rank)
        if sighting.sentiment is not None:
            self.split[SPLIT_LABELS.index(sighting.sentiment)] += 1
        self.engines.add(provider)

    def add_tally(self, brand: BrandTally, keyword: str) -> None:
        self.mentions += brand.mentions
        self.points += brand.points
        self.rank_sum += brand.rank_sum
        self.rank_count += brand.rank_count
        best = brand.best_rank
        if best is not None and (self.best_rank is None or best < self.best_rank):
            self.best_rank = best
        split, added = self.split, brand.split
        split[0] += added[0]
        split[1] += added[1]
        split[2] += added[2]
        split[3] += added[3]
        self.engines.update(brand.engines)
        self.keywords.add(keyword)

    def add_sum(self, other: _BrandSum) -> None:
        self.mentions += other.mentions
        self.points += other.points
        self.rank_sum += other.rank_sum
        self.rank_count += other.rank_count
        if other.best_rank is not None and (self.best_rank is None or other.best_rank < self.best_rank):
            self.best_rank = other.best_rank
        _add(self.split, other.split)
        self.engines.update(other.engines)
        self.keywords.update(other.keywords)

    def row(self, answers: int, total_mentions: int, keywords: int | None = None) -> dict[str, Any]:
        """The brand's ``brand_table`` row among ``answers`` answers naming ``total_mentions`` brands.

        ``keywords`` overrides the count of keywords naming it (a pool that kept counts, not names).
        """
        return {
            'name': self.name,
            'classification': self.classification,
            'mentions': self.mentions,
            'mention_rate': percent(self.mentions, answers),
            'share_of_voice': percent(self.mentions, total_mentions),
            'average_position': round(self.rank_sum / self.rank_count, 2) if self.rank_count else None,
            'best_position': self.best_rank,
            'visibility_score': visibility_percent(self.points, answers),
            'engines': sorted(self.engines),
            'keywords': len(self.keywords) if keywords is None else keywords,
            **sentiment_fields(dict(zip(SPLIT_LABELS, self.split, strict=True))),
        }

    def tally(self) -> BrandTally:
        return BrandTally(
            self.key, self.name, self.classification, self.mentions, self.points,
            self.rank_sum, self.rank_count, self.best_rank, tuple(self.split), tuple(sorted(self.engines)),
        )

    def leaderboard_key(self) -> tuple[int, int, str]:
        """``brand_table``'s order: visibility (points), then mentions, then name."""
        return (-self.points, -self.mentions, self.name.lower())


def _kept_brands(brands: list[_BrandSum], cap: int | None, tracked: frozenset[str]) -> list[_BrandSum]:
    """``brands`` (first named first) without the least visible beyond ``cap``; first-party and tracked brands always stay."""
    if cap is None or len(brands) <= cap:
        return brands
    always = [brand for brand in brands if brand.classification == FIRST_PARTY or brand.key in tracked]
    others = sorted((brand for brand in brands if brand not in always), key=_BrandSum.leaderboard_key)
    kept = {id(brand) for brand in [*always, *others[:max(0, cap - len(always))]]}
    return [brand for brand in brands if id(brand) in kept]


def run_tally(
    keyword: str,
    timestamp: str,
    answers: Iterable[Answer],
    owned_domains: Iterable[str] = (),
    *,
    brand_cap: int | None = None,
    tracked_brands: Iterable[str] = (),
) -> RunTally:
    """The tally of ``answers`` (one keyword, one run), citation counts against ``owned_domains``."""
    domains = [domain for domain in owned_domains if normalize_domain(domain)]
    engines: dict[str, list[int]] = {}
    models: dict[str, set[str]] = defaultdict(set)
    brands: dict[str, _BrandSum] = {}
    for answer in answers:
        _add(engines.setdefault(answer.provider, [0] * len(COUNT_FIELDS)), _answer_counts(answer, domains))
        if answer.model is not None:
            models[answer.provider].add(answer.model)
        for sighting in answer.sightings:
            brand = brands.get(sighting.key) or brands.setdefault(sighting.key, _BrandSum(sighting.key, sighting.name, sighting.classification))
            brand.add_sighting(sighting, answer.provider)
    kept = _kept_brands(list(brands.values()), brand_cap, frozenset(map(normalize_brand_key, tracked_brands)))
    return RunTally(
        keyword=keyword,
        timestamp=timestamp,
        engines={provider: tuple(counts) for provider, counts in engines.items()},
        models={provider: tuple(sorted(names)) for provider, names in models.items()},
        brands=tuple(brand.tally() for brand in kept),
        brands_total=len(brands),
        owned=owned_fingerprint(domains),
    )


def run_tallies(keyword: str, answers: Iterable[Answer], owned_domains: Iterable[str] = (), **brand_options: Any) -> list[RunTally]:
    """One tally per run of one keyword's ``answers``, oldest run first; answers without a timestamp are dropped.

    ``brand_options`` (``brand_cap``, ``tracked_brands``) keep the brands of each run as ``run_tally`` does.
    """
    domains = list(owned_domains)
    runs: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        if answer.timestamp:
            runs[answer.timestamp].append(answer)
    return [run_tally(keyword, timestamp, runs[timestamp], domains, **brand_options) for timestamp in sorted(runs)]


def brands_truncated(runs: Iterable[RunTally]) -> bool:
    """Whether any run kept fewer brands than its answers named (a capped row): a leaderboard over them is cut short."""
    return any(run.brands_total > len(run.brands) for run in runs)


# ---------------------------------------------------------------------------
# KPIs of summed tallies
# ---------------------------------------------------------------------------

@dataclass
class _Pool:
    counts: list[int] = field(default_factory=lambda: [0] * len(COUNT_FIELDS))
    engines: set[str] = field(default_factory=set)
    engines_naming: set[str] = field(default_factory=set)
    keywords: set[str] = field(default_factory=set)
    keywords_naming: set[str] = field(default_factory=set)

    def add(self, tally: RunTally) -> None:
        for provider, counts in tally.engines.items():
            if not counts[0]:
                continue
            _add(self.counts, counts)
            self.engines.add(provider)
            self.keywords.add(tally.keyword)
            if counts[_INDEX['mentioning']]:
                self.engines_naming.add(provider)
                self.keywords_naming.add(tally.keyword)

    def count(self, name: str) -> int:
        return self.counts[_INDEX[name]]


def _citation_fields(pool: _Pool, configured: bool) -> dict[str, Any]:
    if not configured:
        return {'citations': None, 'citation_rate': None, 'citation_share': None}
    return {
        'citations': pool.count('citing'),
        'citation_rate': percent(pool.count('citing'), pool.count('answers')),
        'citation_share': percent(pool.count('owned_pairs'), pool.count('all_pairs')),
    }


@dataclass(frozen=True)
class PooledCounts:
    """Answer counts already summed over some keywords' runs, with how many engines and keywords they span.

    What ``pooled_kpis`` reads; a mergeable scope accumulator (``shared.partial_kpi``)
    keeps these numbers instead of the tallies themselves.
    """

    counts: Sequence[int]
    """The summed ``COUNT_FIELDS``."""
    engines: int
    """Engines with at least one answer."""
    engines_naming: int
    """Engines with at least one answer naming a first-party brand."""
    keywords: int
    """Keywords with at least one answer."""
    keywords_naming: int
    """Keywords with at least one answer naming a first-party brand."""


def pooled_kpis(pooled: PooledCounts, citations_configured: bool) -> dict[str, Any]:
    """``brand_kpis`` of the answers ``pooled`` counts (``citations_configured``: owned domains are set)."""
    pool = _Pool(counts=list(pooled.counts))
    answers = pool.count('answers')
    rank_count = pool.count('rank_count')
    return {
        'answers': answers,
        'mentions': pool.count('mentioning'),
        'mention_rate': percent(pool.count('mentioning'), answers),
        'share_of_voice': percent(pool.count('first_party_mentions'), pool.count('total_mentions')),
        'average_position': round(pool.count('rank_sum') / rank_count, 2) if rank_count else None,
        'top_1_share': percent(pool.count('top_1'), answers),
        'top_3_share': percent(pool.count('top_3'), answers),
        'visibility_score': visibility_percent(pool.count('points'), answers),
        **_citation_fields(pool, citations_configured),
        **citation_versions({rule: pool.count(field) for rule, field in TALLIED_CITATION_RULES.items()}),
        **sentiment_fields({label: pool.counts[index] for label, index in zip(SPLIT_LABELS, _SPLIT, strict=True)}),
        'engine_coverage': percent(pooled.engines_naming, pooled.engines),
        'keyword_coverage': percent(pooled.keywords_naming, pooled.keywords),
        'engines': pooled.engines,
        'keywords': pooled.keywords,
    }


def tally_kpis(tallies: Iterable[RunTally], owned_domains: Iterable[str] = ()) -> dict[str, Any]:
    """``brand_kpis`` of every answer the ``tallies`` count (each built against ``owned_domains``)."""
    pool = _Pool()
    for tally in tallies:
        pool.add(tally)
    pooled = PooledCounts(
        counts=pool.counts, engines=len(pool.engines), engines_naming=len(pool.engines_naming),
        keywords=len(pool.keywords), keywords_naming=len(pool.keywords_naming),
    )
    return pooled_kpis(pooled, any(normalize_domain(domain) for domain in owned_domains))


def brand_row(brand: BrandTally, *, keywords: int, answers: int, total_mentions: int) -> dict[str, Any]:
    """``brand_table``'s row of the summed ``brand`` named in ``keywords`` keywords, among ``answers`` answers naming ``total_mentions`` brands."""
    summed = _BrandSum(brand.key, brand.name, brand.classification)
    summed.add_tally(brand, '')
    return summed.row(answers, total_mentions, keywords)


def merged_brand(first: BrandTally, other: BrandTally) -> BrandTally:
    """The counts of ``first`` and ``other`` (one brand) added up, with ``first``'s name and classification."""
    summed = _BrandSum(first.key, first.name, first.classification)
    summed.add_tally(first, '')
    summed.add_tally(other, '')
    return summed.tally()


def count_index(name: str) -> int:
    """The position of ``name`` in ``COUNT_FIELDS``."""
    return _INDEX[name]


@dataclass
class BrandPool:
    """The brand counts of some run tallies, summed: ``tally_brand_table``'s input, and mergeable.

    Merging the pools of consecutive slices (``add_pool``) equals the pool of
    their runs in that order, so a view listing brands per period and over the
    whole window adds each run's brands up once.
    """

    answers: int = 0
    total_mentions: int = 0
    brands: dict[str, _BrandSum] = field(default_factory=dict)

    @classmethod
    def of(cls, tallies: Iterable[RunTally]) -> BrandPool:
        pool = cls()
        brands = pool.brands
        for tally in tallies:
            pool.answers += tally.answers
            pool.total_mentions += sum(counts[_TOTAL_MENTIONS] for counts in tally.engines.values())
            for brand in tally.brands:
                merged = brands.get(brand.key)
                if merged is None:
                    merged = brands[brand.key] = _BrandSum(brand.key, brand.name, brand.classification)
                merged.add_tally(brand, tally.keyword)
        return pool

    def add_pool(self, other: BrandPool) -> None:
        """Add ``other``'s counts, as if its runs came after this pool's."""
        self.answers += other.answers
        self.total_mentions += other.total_mentions
        for key, counted in other.brands.items():
            merged = self.brands.get(key)
            if merged is None:
                merged = self.brands[key] = _BrandSum(key, counted.name, counted.classification)
            merged.add_sum(counted)

    def table(self) -> list[dict[str, Any]]:
        """``brand_table`` of the answers counted: the leaderboard of the brands kept."""
        return leaderboard([brand.row(self.answers, self.total_mentions) for brand in self.brands.values()])


def tally_brand_table(tallies: Iterable[RunTally]) -> list[dict[str, Any]]:
    """``brand_table`` of every answer the ``tallies`` count (over the brands they kept)."""
    return BrandPool.of(tallies).table()


def tally_models(tallies: Iterable[RunTally]) -> dict[str, list[str]]:
    """``run_models`` of the answers the ``tallies`` count: the models each engine answered with."""
    models: dict[str, set[str]] = defaultdict(set)
    for tally in tallies:
        for provider, names in tally.models.items():
            models[provider].update(names)
    return {provider: sorted(names) for provider, names in sorted(models.items())}


def tally_mentions(tallies: Iterable[RunTally]) -> int:
    """Brand sightings of every kind the ``tallies`` count: 0 when no answer names any brand."""
    return sum(counts[_INDEX['total_mentions']] for tally in tallies for counts in tally.engines.values())


__all__ = [
    'COUNT_FIELDS',
    'TALLIED_CITATION_RULES',
    'BrandPool',
    'BrandTally',
    'PooledCounts',
    'RunTally',
    'brand_row',
    'brands_truncated',
    'count_index',
    'merged_brand',
    'owned_fingerprint',
    'pooled_kpis',
    'run_tallies',
    'run_tally',
    'tally_brand_table',
    'tally_kpis',
    'tally_mentions',
    'tally_models',
]
