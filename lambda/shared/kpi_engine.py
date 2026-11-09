"""
The visibility KPIs, computed one way for every page.

`docs/kpi-definitions.md` is the specification: every KPI here is defined
there, with its formula and edge cases. Change the two together;
`test_kpi_contract.py` fails when they drift.

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
from decimal import Decimal
from fractions import Fraction
from typing import Any
from urllib.parse import urlparse

from shared.brand_names import COMPETITOR, FIRST_PARTY, normalize_brand_key
from shared.config import LLM_PROVIDERS, Provider, asks_plain_keyword
from shared.constants import UNRANKED_SENTINEL
from shared.markets import GLOBAL_MARKET_ID

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
POSITION_DECAY = 0.9

#: A mention whose position is unknown (or beyond 10th) earns the 10th-position weight.
POSITION_WEIGHT_CAP = 10

#: Noise band of the trend direction: changes smaller than this are "stable".
TREND_BAND_POINTS = 2.0
TREND_BAND_POSITIONS = 0.5

#: The brand classifications (``FIRST_PARTY`` and ``COMPETITOR`` are those of ``shared.brand_names``).
OTHER = 'other'
#: The sentiment labels a brand mention can carry; any other label counts as unlabelled.
SENTIMENT_LABELS: tuple[str, ...] = ('positive', 'neutral', 'mixed', 'negative')

#: The SearchResults attributes an answer is read from (`#ts` = timestamp, `#st` = status, `#md` = metadata).
ANSWER_PROJECTION = (
    'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model, branded, market_id, citations_version'
)

#: The citation rule an answer row was stored under (``citations_version``, written since 2.43.0; D2, D3). 2: only
#: the sources the answer cites count (``citations``), the pages an engine only read are ``retrieved_urls``, and
#: Perplexity and Claude are asked to cite. A row without the field predates it and counted every source the engine
#: returned: it is "unversioned", a definition of its own. The search Lambda writes this value on every answer.
CITATIONS_VERSION = 2
#: How a citation version is named in ``citation_versions`` (``docs/kpi-definitions.md``, Conventions).
UNVERSIONED_CITATIONS = 'unversioned (pre-2.43.0)'

#: The ``branded`` filters of a pool of answers: answers to queries that do not name the brand
#: (``neutral``), that do (``branded``), or every answer (``all``).
BRANDED_FILTERS: tuple[str, ...] = ('neutral', 'branded', 'all')
ANSWER_ATTRIBUTE_NAMES = {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata'}


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Sighting:
    """One brand named in one answer."""

    key: str
    """Case-, accent- and whitespace-insensitive identity (``normalize_brand_key``): "SKY Airline" and "Sky Airline" are one brand."""
    name: str
    classification: str
    rank: int | None
    """Order of first appearance among the brands named (1 = first); ``None`` when unknown."""
    sentiment: str | None
    reason: str | None = None
    """Why the answer words the brand as it does (the stored ``sentiment_reason``); ``None`` when not given."""


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
    cited_urls: tuple[str, ...] = ()
    """The URLs the answer cites, each once, in the order cited (``cited_domains`` are their hosts)."""
    branded: bool = False
    """Whether the query named the tracked brand (fixed when the row was written; rows from before 2.43 are neutral)."""
    branded_classified: bool = True
    """Whether the row carried a ``branded`` flag at all; rows from before 2.43 did not, so their ``branded`` is a default."""
    market_id: str = GLOBAL_MARKET_ID
    citations_version: int | None = None
    """The citation rule the row was stored under (``CITATIONS_VERSION``); ``None`` for a row from before 2.43.0."""

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


def sighting_from_brand(brand: object) -> Sighting | None:
    """The sighting one stored brand dict makes, or ``None`` for a brand without a name (a blank, or marks alone)."""
    if not isinstance(brand, Mapping):
        return None
    name = str(brand.get('name') or '').strip()
    key = normalize_brand_key(name)
    if not key:
        return None
    classification = brand.get('classification')
    sentiment = brand.get('sentiment')
    label = sentiment.lower() if isinstance(sentiment, str) else None
    reason = brand.get('sentiment_reason')
    return Sighting(
        key=key,
        name=name,
        classification=classification if classification in {FIRST_PARTY, COMPETITOR} else OTHER,
        rank=_rank(brand.get('rank')),
        sentiment=label if label in SENTIMENT_LABELS else None,
        reason=(reason.strip() or None) if isinstance(reason, str) else None,
    )


def normalize_domain(value: object) -> str | None:
    """The host of a URL or domain: lower-case, without userinfo, port, edge dots or a leading ``www.``.

    ``None`` when there is no host, including a URL ``urlparse`` rejects
    (an unclosed IPv6 bracket). ``test-fixtures/domain-identity.json`` pins
    the cases for every runtime.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().lower()
    try:
        host = urlparse(text if '//' in text else f'//{text}').hostname or ''
    except ValueError:
        return None
    host = host.lstrip('.').removeprefix('www.').rstrip('.')
    return host or None


def matches_domain(domain: str, domains: Iterable[str]) -> bool:
    """Whether ``domain`` is one of ``domains`` or a subdomain of one."""
    for listed in domains:
        normalized = normalize_domain(listed)
        if normalized and (domain == normalized or domain.endswith(f'.{normalized}')):
            return True
    return False


def is_owned_domain(domain: str, owned_domains: Iterable[str]) -> bool:
    """Whether ``domain`` is one of ``owned_domains`` or a subdomain of one."""
    return matches_domain(domain, owned_domains)


def owned_domains_from(brand_config: Mapping[str, Any]) -> list[str]:
    """The owned domains of a brand configuration (``first_party_domains``), normalized and without repeats."""
    configured = brand_config.get('first_party_domains')
    values = configured if isinstance(configured, (list, tuple, set)) else []
    return sorted({domain for domain in map(normalize_domain, values) if domain})


def _cited_urls(citations: object) -> tuple[str, ...]:
    """Every cited URL with a host, stripped and once each, in citation order."""
    values = citations if isinstance(citations, (list, tuple)) else []
    urls = (value.strip() for value in values if isinstance(value, str) and normalize_domain(value))
    return tuple(dict.fromkeys(urls))


#: The persona of an unpersonalised answer (``query_prompt_id`` ``default``, or none on older rows).
DEFAULT_PERSONA = 'default'


def engines_not_covered(persona: str | None, answered_engines: Iterable[str]) -> list[str]:
    """The AI engines that answered in the scope (``answered_engines``) but that a figure narrowed to ``persona``
    cannot include.

    An engine that ``asks_plain_keyword`` (Google AI Overviews) is asked once per keyword and run under the
    default prompt, never a persona's wording, so a persona's figures hold none of its answers: it is named here
    and left out of their engine count (``engines``, ``engine_coverage``) rather than read as zero coverage. An
    engine with no answer in the scope (switched off, never run) is missing from every figure alike and is not
    named. Every answer (``None``) and the default persona cover every engine.
    """
    if persona is None or persona == DEFAULT_PERSONA:
        return []
    answered = set(answered_engines)
    return [provider for provider in LLM_PROVIDERS if asks_plain_keyword(provider) and provider in answered]


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
    for sighting in filter(None, (sighting_from_brand(brand) for brand in row.get('brands') or [])):
        kept = by_key.get(sighting.key)
        if kept is None or (sighting.rank is not None and (kept.rank is None or sighting.rank < kept.rank)):
            by_key[sighting.key] = sighting
    metadata = row.get('metadata')
    model = metadata.get('model') if isinstance(metadata, Mapping) else None
    return Answer(
        keyword=str(row.get('keyword') or ''),
        provider=str(row['provider']),
        persona=str(row.get('query_prompt_id') or DEFAULT_PERSONA),
        timestamp=str(row.get('timestamp') or ''),
        sightings=tuple(by_key.values()),
        cited_domains=frozenset(filter(None, (normalize_domain(url) for url in row.get('citations') or []))),
        model=model if isinstance(model, str) and model else None,
        cited_urls=_cited_urls(row.get('citations')),
        branded=row.get('branded') is True,
        branded_classified='branded' in row,
        market_id=str(row.get('market_id') or GLOBAL_MARKET_ID),
        citations_version=_citations_version(row.get('citations_version')),
    )


def _citations_version(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | Decimal) or value != int(value):
        return None
    return int(value)


def citation_versions(answers: int, current: int) -> dict[str, Any]:
    """Which citation rules the answers of a figure were stored under, and whether it mixes them (tenet 2).

    ``current`` of ``answers`` carry ``CITATIONS_VERSION``; the rest are unversioned. A citation KPI over a mix
    adds up two definitions, so the figure says so (``citation_versions_mixed``) with the answers of each.
    """
    counted = [(str(CITATIONS_VERSION), current), (UNVERSIONED_CITATIONS, answers - current)]
    versions = [{'version': version, 'answers': count} for version, count in counted if count > 0]
    return {'citation_versions': versions, 'citation_versions_mixed': len(versions) > 1}


def answers_from_rows(rows: Iterable[Mapping[str, Any]]) -> list[Answer]:
    return [answer for answer in map(answer_from_row, rows) if answer is not None]


def filter_branded(answers: Iterable[Answer], branded: str = 'all') -> list[Answer]:
    """The answers one ``BRANDED_FILTERS`` value keeps: ``neutral`` (not branded), ``branded``, or ``all``.

    An answer to a query naming the brand mentions it almost by construction,
    so the neutral answers are the ones that measure unprompted visibility.
    """
    if branded == 'all':
        return list(answers)
    keep = branded == 'branded'
    return [answer for answer in answers if answer.branded is keep]


# ---------------------------------------------------------------------------
# KPIs of the tracked brand
# ---------------------------------------------------------------------------

def percent(numerator: int, denominator: int) -> float | None:
    """``numerator`` as a percentage of ``denominator``, to one decimal; ``None`` when there is nothing to divide by."""
    return round(numerator / denominator * 100, 1) if denominator else None


_DECAY = Fraction(str(POSITION_DECAY))

#: ``position_points(rank) / POSITION_POINTS_SCALE`` is the position weight ``POSITION_DECAY ** (rank - 1)``, exactly.
POSITION_POINTS_SCALE = _DECAY.denominator ** (POSITION_WEIGHT_CAP - 1)


def position_points(rank: int | None) -> int:
    """Visibility score weight of a mention at ``rank`` (1st = 1.0, then x0.9 per position) in integer points.

    Integers add up exactly in any order, so a visibility score pooled from
    per-run sums (``shared.kpi_tally``) equals the one pooled from answers.
    """
    capped = POSITION_WEIGHT_CAP if rank is None else min(rank, POSITION_WEIGHT_CAP)
    return _DECAY.numerator ** (capped - 1) * _DECAY.denominator ** (POSITION_WEIGHT_CAP - capped)


def visibility_percent(points: int, answers: int) -> float | None:
    """The visibility score of ``points`` (``position_points`` summed) over ``answers``: the mean weight x 100, to one decimal."""
    return round(points * 100 / (POSITION_POINTS_SCALE * answers), 1) if answers else None


def _mention_counts(answers: Iterable[Answer]) -> dict[str, int]:
    """Answers naming each brand (by brand key)."""
    counts: dict[str, int] = defaultdict(int)
    for answer in answers:
        for sighting in answer.sightings:
            counts[sighting.key] += 1
    return counts


#: The order of a ``sentiment_split``.
SPLIT_LABELS: tuple[str, ...] = ('positive', 'neutral', 'negative', 'mixed')


def _net_sentiment(sightings: Iterable[Sighting]) -> dict[str, Any]:
    split: dict[str, int] = dict.fromkeys(SPLIT_LABELS, 0)
    for sighting in sightings:
        if sighting.sentiment is not None:
            split[sighting.sentiment] += 1
    return sentiment_fields(split)


def sentiment_fields(split: dict[str, int]) -> dict[str, Any]:
    """``net_sentiment`` and ``sentiment_split`` of a count of labelled sightings per label (``SPLIT_LABELS``)."""
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
        'citation_rate': percent(citing, len(answers)),
        'citation_share': percent(owned_pairs, all_pairs),
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
    visibility = sum(position_points(answer.best_first_party_rank()) for answer in mentioning)
    return {
        'answers': len(pool),
        'mentions': len(mentioning),
        'mention_rate': percent(len(mentioning), len(pool)),
        'share_of_voice': percent(first_party_mentions, total_mentions),
        'average_position': round(sum(ranks) / len(ranks), 2) if ranks else None,
        'top_1_share': percent(sum(rank == 1 for rank in ranks), len(pool)),
        'top_3_share': percent(sum(rank <= 3 for rank in ranks), len(pool)),
        'visibility_score': visibility_percent(visibility, len(pool)),
        **_citation_kpis(pool, domains),
        **citation_versions(len(pool), sum(answer.citations_version == CITATIONS_VERSION for answer in pool)),
        **_net_sentiment(sighting for answer in mentioning for sighting in answer.first_party()),
        'engine_coverage': percent(len({answer.provider for answer in mentioning}), len(engines)),
        'keyword_coverage': percent(len({answer.keyword for answer in mentioning}), len(keywords)),
        'engines': len(engines),
        'keywords': len(keywords),
    }


# ---------------------------------------------------------------------------
# Google AI Overviews presence (a coverage figure, not a KPI)
# ---------------------------------------------------------------------------

#: The row status of a Google results page that showed no AI Overview: not an answer.
NO_ANSWER = 'no_answer'


def overview_presence(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """How often Google showed an AI Overview: "Overview shown for n of m queries".

    ``aio_queries`` counts the Google AI Overviews rows whose page was read
    (``success`` + ``no_answer``; errors measured nothing), ``aio_overviews``
    the ``success`` ones and ``aio_presence_rate`` their percentage. It is
    reported next to ``answers`` and is not in ``KPI_IDS``: it says nothing
    about the brand, and a ``no_answer`` row is never an answer.
    """
    statuses = [row.get('status') for row in rows if row.get('provider') == Provider.GOOGLE_AI_OVERVIEW]
    read = [status for status in statuses if status in ('success', NO_ANSWER)]
    shown = sum(status == 'success' for status in read)
    return {
        'aio_overviews': shown,
        'aio_queries': len(read),
        'aio_presence_rate': percent(shown, len(read)),
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
            'mention_rate': percent(counts[key], len(pool)),
            'share_of_voice': percent(counts[key], total_mentions),
            'average_position': round(sum(ranks) / len(ranks), 2) if ranks else None,
            'best_position': min(ranks) if ranks else None,
            'visibility_score': visibility_percent(sum(position_points(sighting.rank) for _answer, sighting in seen), len(pool)),
            'engines': sorted({answer.provider for answer, _sighting in seen}),
            'keywords': len({answer.keyword for answer, _sighting in seen}),
            **_net_sentiment(sighting for _answer, sighting in seen),
        })
    return leaderboard(rows)


def leaderboard(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Brand rows in ``brand_table``'s order: visibility score, then mentions, then name."""
    rows.sort(key=lambda row: (-row['visibility_score'], -row['mentions'], row['name'].lower()))
    return rows


# ---------------------------------------------------------------------------
# Breakdowns: per AI engine, per cited domain
# ---------------------------------------------------------------------------

def engine_breakdown(answers: Iterable[Answer], owned_domains: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Every KPI of the tracked brand per AI engine, engines in name order."""
    domains = list(owned_domains)
    by_engine: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        by_engine[answer.provider].append(answer)
    return [{'engine': engine, 'kpis': brand_kpis(by_engine[engine], domains)} for engine in sorted(by_engine)]


def source_table(answers: Iterable[Answer], owned_domains: Iterable[str] = ()) -> list[dict[str, Any]]:
    """One row per domain cited in ``answers``, most cited first.

    ``citations`` counts the answers citing the domain; ``citation_rate`` is
    their share of all answers and ``citation_share`` the domain's share of
    every (answer, domain) citation — the tracked-brand citation formulas
    applied to one domain. ``owned`` marks the brand's own domains.
    """
    pool = list(answers)
    citing: dict[str, list[Answer]] = defaultdict(list)
    for answer in pool:
        for domain in answer.cited_domains:
            citing[domain].append(answer)
    counted = {
        domain: DomainCount(
            citations=len(answers_citing),
            engines=frozenset(answer.provider for answer in answers_citing),
            keywords=len({answer.keyword for answer in answers_citing}),
        )
        for domain, answers_citing in citing.items()
    }
    return source_rows(counted, len(pool), owned_domains)


@dataclass(frozen=True)
class DomainCount:
    """How some answers cite one domain: the answers citing it, their engines and their keywords."""

    citations: int
    engines: frozenset[str]
    keywords: int


def source_rows(citing: Mapping[str, DomainCount], answers: int, owned_domains: Iterable[str] = ()) -> list[dict[str, Any]]:
    """``source_table``'s rows from per-domain counts over ``answers`` answers, most cited first."""
    domains = [domain for domain in owned_domains if normalize_domain(domain)]
    all_pairs = sum(count.citations for count in citing.values())
    rows = [
        {
            'domain': domain,
            'owned': is_owned_domain(domain, domains),
            'citations': count.citations,
            'citation_rate': percent(count.citations, answers),
            'citation_share': percent(count.citations, all_pairs),
            'engines': sorted(count.engines),
            'keywords': count.keywords,
        }
        for domain, count in citing.items()
    ]
    rows.sort(key=lambda row: (-row['citations'], row['domain']))
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
    'BRANDED_FILTERS',
    'CITATIONS_VERSION',
    'COMPETITOR',
    'DEFAULT_PERSONA',
    'KPI_IDS',
    'NO_ANSWER',
    'PERCENT_KPIS',
    'POSITION_POINTS_SCALE',
    'SENTIMENT_LABELS',
    'SPLIT_LABELS',
    'TRENDED_KPIS',
    'UNVERSIONED_CITATIONS',
    'Answer',
    'DomainCount',
    'Sighting',
    'answer_from_row',
    'answers_from_rows',
    'brand_kpis',
    'brand_table',
    'citation_versions',
    'engine_breakdown',
    'engines_not_covered',
    'filter_branded',
    'is_owned_domain',
    'kpi_changes',
    'kpi_trends',
    'leaderboard',
    'matches_domain',
    'normalize_domain',
    'overview_presence',
    'owned_domains_from',
    'percent',
    'position_points',
    'sentiment_fields',
    'sighting_from_brand',
    'source_rows',
    'source_table',
    'trend_direction',
    'visibility_percent',
]
