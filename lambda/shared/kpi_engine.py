"""
The market-aligned visibility KPIs, computed one way for every page.

`docs/kpi-definitions.md` is the specification: every KPI here is defined
there, with its formula, edge cases and the market definitions it follows
(Otterly, Peec, Profound, Scrunch, Semrush, Ahrefs, Evertune). Change the
two together; `test_kpi_contract.py` fails when they drift.

The unit of measurement is the **answer**: one successful response from one
AI engine (LLM provider) to one query (a keyword, optionally rewritten by a
persona) in one analysis run. Rows from the optional web-search providers
(Brave, Tavily, ...) and failed provider calls are not answers — they cannot
mention a brand, so counting them would dilute every rate.

Group values (a keyword group, several runs) are **pooled**: counts are
added up across the answers and divided once, so every answer weighs the
same. Percentages are never averaged.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from shared.config import LLM_PROVIDERS

#: The KPIs a scope (keyword, group, run, period) reports for the tracked brand.
KPI_IDS: tuple[str, ...] = (
    'answers',
    'mentions',
    'mention_rate',
    'share_of_voice',
    'average_position',
    'top_1_share',
    'top_3_share',
    'visibility_score',
    'citations',
    'citation_rate',
    'citation_share',
    'net_sentiment',
    'engine_coverage',
    'keyword_coverage',
)

#: The KPIs that are percentages (0-100) or points; their changes are in points.
PERCENT_KPIS = frozenset({
    'mention_rate', 'share_of_voice', 'top_1_share', 'top_3_share', 'visibility_score',
    'citation_rate', 'citation_share', 'engine_coverage', 'keyword_coverage',
})

#: The KPIs a trend (improving / declining / stable) is called for: every rate and score, not the counts.
TRENDED_KPIS: tuple[str, ...] = tuple(kpi for kpi in KPI_IDS if kpi in PERCENT_KPIS | {'average_position', 'net_sentiment'})

#: Visibility score weight of each position: 1st = 1.0, 2nd = 0.9, 3rd = 0.81 ...
#: (Evertune's published position weighting).
POSITION_DECAY = 0.9

#: A mention whose position is unknown (or beyond 10th) earns the 10th-position weight.
POSITION_WEIGHT_CAP = 10

#: Ranks at or above this are the extractor's "not ranked" sentinel.
UNRANKED_SENTINEL = 999

#: Noise band of the trend direction: changes smaller than this are "stable".
TREND_BAND_POINTS = 2.0
TREND_BAND_POSITIONS = 0.5

FIRST_PARTY = 'first_party'
COMPETITOR = 'competitor'
OTHER = 'other'
_SENTIMENTS = frozenset({'positive', 'neutral', 'negative', 'mixed'})

#: The SearchResults attributes an answer is read from (`#ts` = timestamp, `#st` = status, `#md` = metadata).
ANSWER_PROJECTION = 'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model'
ANSWER_ATTRIBUTE_NAMES = {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata'}


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Sighting:
    """One brand named in one answer."""

    key: str
    """Case-insensitive identity: the same brand under two spellings of case is one brand."""
    name: str
    classification: str
    rank: int | None
    """Order of first appearance among the brands named (1 = first); ``None`` when unknown."""
    sentiment: str | None


@dataclass(frozen=True)
class Answer:
    """One successful answer of one AI engine to one query in one run."""

    keyword: str
    provider: str
    persona: str
    timestamp: str
    sightings: tuple[Sighting, ...]
    cited_domains: frozenset[str]
    model: str | None

    def first_party(self) -> tuple[Sighting, ...]:
        return tuple(sighting for sighting in self.sightings if sighting.classification == FIRST_PARTY)

    def best_first_party_rank(self) -> int | None:
        ranks = [sighting.rank for sighting in self.first_party() if sighting.rank is not None]
        return min(ranks) if ranks else None


def _rank(value: object) -> int | None:
    """A valid 1-based position, or ``None`` for missing, malformed and sentinel ranks."""
    if isinstance(value, bool):
        return None
    try:
        rank = int(str(value))
    except (TypeError, ValueError):
        return None
    return rank if 1 <= rank < UNRANKED_SENTINEL else None


def _sighting(brand: object) -> Sighting | None:
    if not isinstance(brand, Mapping):
        return None
    name = str(brand.get('name') or '').strip()
    if not name:
        return None
    classification = brand.get('classification')
    sentiment = brand.get('sentiment')
    label = sentiment.lower() if isinstance(sentiment, str) else None
    return Sighting(
        key=name.lower(),
        name=name,
        classification=classification if classification in {FIRST_PARTY, COMPETITOR} else OTHER,
        rank=_rank(brand.get('rank')),
        sentiment=label if label in _SENTIMENTS else None,
    )


def normalize_domain(value: object) -> str | None:
    """The host of a URL or domain, lower-case, without ``www.`` or a port; ``None`` when there is none."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().lower()
    host = urlparse(text if '//' in text else f'//{text}').hostname or ''
    host = host.removeprefix('www.').removesuffix('.')
    return host or None


def is_owned_domain(domain: str, owned_domains: Iterable[str]) -> bool:
    """Whether ``domain`` is one of ``owned_domains`` or a subdomain of one."""
    for owned in owned_domains:
        normalized = normalize_domain(owned)
        if normalized and (domain == normalized or domain.endswith(f'.{normalized}')):
            return True
    return False


def owned_domains_from(brand_config: Mapping[str, Any]) -> list[str]:
    """The owned domains of a brand configuration (``first_party_domains``), normalized and without repeats."""
    configured = brand_config.get('first_party_domains')
    values = configured if isinstance(configured, (list, tuple, set)) else []
    return sorted({domain for domain in map(normalize_domain, values) if domain})


def _is_answer_row(row: Mapping[str, Any]) -> bool:
    # The provider decides the type: web-search providers never write an answer.
    # Rows written before `status` existed were only stored for answers.
    return row.get('provider') in LLM_PROVIDERS and row.get('status', 'success') == 'success'


def answer_from_row(row: Mapping[str, Any]) -> Answer | None:
    """The answer a SearchResults row holds, or ``None`` when the row is not an answer.

    A brand named twice in one answer is one sighting (its best position):
    counting it twice would let a verbose answer outweigh a concise one.
    """
    if not _is_answer_row(row):
        return None
    by_key: dict[str, Sighting] = {}
    for sighting in filter(None, (_sighting(brand) for brand in row.get('brands') or [])):
        kept = by_key.get(sighting.key)
        if kept is None or (sighting.rank is not None and (kept.rank is None or sighting.rank < kept.rank)):
            by_key[sighting.key] = sighting
    metadata = row.get('metadata')
    model = metadata.get('model') if isinstance(metadata, Mapping) else None
    return Answer(
        keyword=str(row.get('keyword') or ''),
        provider=str(row['provider']),
        persona=str(row.get('query_prompt_id') or 'default'),
        timestamp=str(row.get('timestamp') or ''),
        sightings=tuple(by_key.values()),
        cited_domains=frozenset(filter(None, (normalize_domain(url) for url in row.get('citations') or []))),
        model=model if isinstance(model, str) and model else None,
    )


def answers_from_rows(rows: Iterable[Mapping[str, Any]]) -> list[Answer]:
    return [answer for answer in map(answer_from_row, rows) if answer is not None]


# ---------------------------------------------------------------------------
# KPIs of the tracked brand
# ---------------------------------------------------------------------------

def _percent(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator * 100, 1) if denominator else None


def position_weight(rank: int | None) -> float:
    """Visibility score weight of a mention at ``rank`` (1st = 1.0, then x0.9 per position)."""
    capped = POSITION_WEIGHT_CAP if rank is None else min(rank, POSITION_WEIGHT_CAP)
    return POSITION_DECAY ** (capped - 1)


def _mention_counts(answers: Iterable[Answer]) -> dict[str, int]:
    """Answers naming each brand (by brand key)."""
    counts: dict[str, int] = defaultdict(int)
    for answer in answers:
        for sighting in answer.sightings:
            counts[sighting.key] += 1
    return counts


def _net_sentiment(sightings: Iterable[Sighting]) -> dict[str, Any]:
    split = {label: 0 for label in ('positive', 'neutral', 'negative', 'mixed')}
    for sighting in sightings:
        if sighting.sentiment is not None:
            split[sighting.sentiment] += 1
    labelled = sum(split.values())
    net = round((split['positive'] - split['negative']) / labelled * 100, 1) if labelled else None
    return {'net_sentiment': net, 'sentiment_split': split}


def _citation_kpis(answers: list[Answer], owned_domains: list[str]) -> dict[str, Any]:
    if not owned_domains:
        return {'citations': None, 'citation_rate': None, 'citation_share': None}
    citing = 0
    owned_pairs = 0
    all_pairs = 0
    for answer in answers:
        owned = [domain for domain in answer.cited_domains if is_owned_domain(domain, owned_domains)]
        citing += bool(owned)
        owned_pairs += len(owned)
        all_pairs += len(answer.cited_domains)
    return {
        'citations': citing,
        'citation_rate': _percent(citing, len(answers)),
        'citation_share': _percent(owned_pairs, all_pairs),
    }


def brand_kpis(answers: Iterable[Answer], owned_domains: Iterable[str] = ()) -> dict[str, Any]:
    """Every KPI of the tracked brand (all first-party brands together) over ``answers``.

    Rates are ``None`` when there is no answer to divide by, and the
    citation KPIs are ``None`` until owned domains are configured.
    """
    pool = list(answers)
    domains = [domain for domain in owned_domains if normalize_domain(domain)]
    mentioning = [answer for answer in pool if answer.first_party()]
    ranks = [rank for answer in mentioning if (rank := answer.best_first_party_rank()) is not None]
    first_party_mentions = sum(len(answer.first_party()) for answer in pool)
    total_mentions = sum(len(answer.sightings) for answer in pool)
    engines = {answer.provider for answer in pool}
    keywords = {answer.keyword for answer in pool}
    visibility = sum(position_weight(answer.best_first_party_rank()) for answer in mentioning)
    return {
        'answers': len(pool),
        'mentions': len(mentioning),
        'mention_rate': _percent(len(mentioning), len(pool)),
        'share_of_voice': _percent(first_party_mentions, total_mentions),
        'average_position': round(sum(ranks) / len(ranks), 2) if ranks else None,
        'top_1_share': _percent(sum(rank == 1 for rank in ranks), len(pool)),
        'top_3_share': _percent(sum(rank <= 3 for rank in ranks), len(pool)),
        'visibility_score': round(visibility / len(pool) * 100, 1) if pool else None,
        **_citation_kpis(pool, domains),
        **_net_sentiment(sighting for answer in mentioning for sighting in answer.first_party()),
        'engine_coverage': _percent(len({answer.provider for answer in mentioning}), len(engines)),
        'keyword_coverage': _percent(len({answer.keyword for answer in mentioning}), len(keywords)),
        'engines': len(engines),
        'keywords': len(keywords),
    }


# ---------------------------------------------------------------------------
# Every brand named in the answers
# ---------------------------------------------------------------------------

def brand_table(answers: Iterable[Answer]) -> list[dict[str, Any]]:
    """One row per brand named in ``answers``: its mention rate, share of voice, position, score and sentiment.

    Sorted by visibility score, then mentions, then name, so the table reads
    as a leaderboard. The same formulas as ``brand_kpis`` applied to one brand.
    """
    pool = list(answers)
    counts = _mention_counts(pool)
    total_mentions = sum(counts.values())
    sightings: dict[str, list[tuple[Answer, Sighting]]] = defaultdict(list)
    for answer in pool:
        for sighting in answer.sightings:
            sightings[sighting.key].append((answer, sighting))

    rows = []
    for key, seen in sightings.items():
        ranks = [sighting.rank for _answer, sighting in seen if sighting.rank is not None]
        first = seen[0][1]
        rows.append({
            'name': first.name,
            'classification': first.classification,
            'mentions': counts[key],
            'mention_rate': _percent(counts[key], len(pool)),
            'share_of_voice': _percent(counts[key], total_mentions),
            'average_position': round(sum(ranks) / len(ranks), 2) if ranks else None,
            'best_position': min(ranks) if ranks else None,
            'visibility_score': round(sum(position_weight(sighting.rank) for _answer, sighting in seen) / len(pool) * 100, 1),
            'engines': sorted({answer.provider for answer, _sighting in seen}),
            'keywords': len({answer.keyword for answer, _sighting in seen}),
            **_net_sentiment(sighting for _answer, sighting in seen),
        })
    rows.sort(key=lambda row: (-row['visibility_score'], -row['mentions'], row['name'].lower()))
    return rows


# ---------------------------------------------------------------------------
# Changes
# ---------------------------------------------------------------------------

def kpi_changes(current: Mapping[str, Any], previous: Mapping[str, Any]) -> dict[str, float | None]:
    """``current - previous`` for every KPI both sides know (points for percentages, positions for position)."""
    return {kpi: _change(current.get(kpi), previous.get(kpi)) for kpi in KPI_IDS}


def _change(now: object, before: object) -> float | None:
    if isinstance(now, (int, float)) and isinstance(before, (int, float)):
        return round(now - before, 2)
    return None


def trend_direction(change: float | None, kpi: str) -> str:
    """``improving`` / ``declining`` / ``stable`` for a change of ``kpi`` between two comparable periods.

    Average position improves when it falls; every other KPI when it rises.
    Changes inside the noise band (2 points, or half a position) are stable.
    """
    if change is None:
        return 'stable'
    lower_is_better = kpi == 'average_position'
    band = TREND_BAND_POSITIONS if lower_is_better else TREND_BAND_POINTS
    gain = -change if lower_is_better else change
    if gain >= band:
        return 'improving'
    if gain <= -band:
        return 'declining'
    return 'stable'


def kpi_trends(changes: Mapping[str, float | None]) -> dict[str, str]:
    """The trend of every rate and score KPI, from the output of ``kpi_changes``."""
    return {kpi: trend_direction(changes.get(kpi), kpi) for kpi in TRENDED_KPIS}


__all__ = [
    'ANSWER_ATTRIBUTE_NAMES',
    'ANSWER_PROJECTION',
    'COMPETITOR',
    'KPI_IDS',
    'PERCENT_KPIS',
    'TRENDED_KPIS',
    'Answer',
    'Sighting',
    'answer_from_row',
    'answers_from_rows',
    'brand_kpis',
    'brand_table',
    'is_owned_domain',
    'kpi_changes',
    'kpi_trends',
    'normalize_domain',
    'owned_domains_from',
    'position_weight',
    'trend_direction',
]
