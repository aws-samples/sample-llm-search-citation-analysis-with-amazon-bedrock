"""
The facts behind the Insights report and the typed insights they support.

Every fact is a pure function of ``shared.kpi_engine`` output, so its numbers
agree with every other page:

* **engines** — the tracked brand's KPIs per AI engine
  (``kpi_engine.engine_breakdown``) and the *play* each engine calls for.
  The top-1 share says whether the brand is ranked first often enough, the
  citation rate whether its site is cited often enough; the play names what
  is missing (``get_cited``, ``get_ranked_first``,
  ``get_mentioned_and_cited``) or ``defend`` when nothing is.
* **portfolio** — the first-party brands (``kpi_engine.brand_table``) with
  enough mentions to compare, each measured against the best of them: how
  many positions behind, how many sentiment points below, and whether one of
  the gaps makes it *weak*.
* **stability** — per keyword of a group, how far the brand's average
  position swung across the runs of the window
  (``shared.group_kpi_history``) and how often its mention flipped.
* **prompt-by-engine** — per keyword of the latest runs, the brand's best
  position on each AI engine that answered it, the weakest keywords first.
* **citation ownership** and **owned pages** — who the engines cite and
  which of the brand's own pages (``shared.insights_citations``).
* **competitor caveats** — per competitor, how many of its mentions are
  worded mixed or negative, and the reasons the answers give.

An insight is derived from the facts alone, and its ``evidence`` repeats the
fact numbers it rests on, so what an insight says is what the report shows.
Positions are rounded to hundredths and points to tenths, as
``kpi_engine.brand_kpis`` does; a value that cannot be computed is ``None``.
"""

from __future__ import annotations

import bisect
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from shared.insights_citations import (
    CompetitorDomains,
    citation_ownership_from,
    merge_owned_pages,
    merge_ownership,
    owned_pages_from,
    owned_pages_partial,
    ownership_partial,
)
from shared.insights_pages import PROMPT_ENGINE_MAX_KEYWORDS, listed_facts
from shared.kpi_engine import COMPETITOR, FIRST_PARTY, Answer, brand_kpis, normalize_domain, percent
from shared.kpi_tally import BrandTally, RunTally, run_tally, tally_brand_table, tally_kpis

#: Top-1 share (percent of answers ranking the brand first) from which an engine already ranks the brand first.
ENGINE_TOP1_MIN = 50.0
#: Citation rate (percent of answers citing an owned domain) from which an engine already cites the brand.
ENGINE_CITED_MIN = 30.0
#: Mentions a first-party brand needs before it is compared with the others.
SUBBRAND_MIN_MENTIONS = 3
#: Positions behind the best first-party brand that make a brand weak.
SUBBRAND_POSITION_GAP = 2.0
#: Net sentiment points below the best first-party brand that make a brand weak.
SUBBRAND_SENTIMENT_GAP = 30.0
#: Swing of a keyword's average position across the window's runs that makes the keyword unstable.
UNSTABLE_POSITION_RANGE = 3.0
#: Answers an engine needs before its play is a high-severity insight.
ENGINE_HIGH_MIN_ANSWERS = 10
#: Share (percent) of a competitor's mentions worded mixed or negative from which its caveats are an insight.
CAVEAT_SHARE_MIN = 30.0
#: Mentions a competitor needs before its caveats are an insight.
CAVEAT_MIN_MENTIONS = 5
#: Caveat share from which a competitor caveat is high severity.
CAVEAT_HIGH_SHARE = 50.0
#: Reasons a competitor caveat row lists (``reasons_total`` counts them all; the ``caveat_reasons`` fact holds every one).
CAVEAT_MAX_REASONS = 3
#: The worst position a prompt-by-engine cell may hold before it is a lost cell (worse than 3rd, or not named).
PROMPT_TOP_POSITION = 3
#: How many times the trailing count the leading count must be for a competitor-sites or documents insight to be high.
LEAD_HIGH_RATIO = 2.0
#: Citations the leading count needs for a competitor-sites or documents insight to be high.
LEAD_HIGH_MIN_CITATIONS = 10

#: The plays an engine calls for; ``defend`` is the one that raises no insight.
DEFEND = 'defend'
GET_CITED = 'get_cited'
GET_RANKED_FIRST = 'get_ranked_first'
GET_MENTIONED_AND_CITED = 'get_mentioned_and_cited'

HIGH = 'high'
MEDIUM = 'medium'
LOW = 'low'
#: Most severe first: the order insights are ranked in.
SEVERITIES: tuple[str, ...] = (HIGH, MEDIUM, LOW)

ENGINE_PLAY = 'engine_play'
WEAK_SUBBRAND = 'weak_subbrand'
UNSTABLE_KEYWORD = 'unstable_keyword'
COMPETITOR_SITES = 'competitor_sites'
DOCUMENTS_CITED = 'documents_cited'
COMPETITOR_CAVEAT = 'competitor_caveat'
PROMPT_GAP = 'prompt_gap'
#: The insight kinds in the order their rules run; insights of equal rank keep it.
INSIGHT_KINDS: tuple[str, ...] = (
    ENGINE_PLAY, WEAK_SUBBRAND, UNSTABLE_KEYWORD, COMPETITOR_SITES, DOCUMENTS_CITED, COMPETITOR_CAVEAT, PROMPT_GAP,
)
#: The report block that shows the detail behind each kind of insight.
BLOCK_BY_KIND: dict[str, str] = {
    ENGINE_PLAY: 'insights_engine_playbook',
    WEAK_SUBBRAND: 'insights_brand_portfolio',
    UNSTABLE_KEYWORD: 'insights_run_stability',
    COMPETITOR_SITES: 'insights_citation_ownership',
    DOCUMENTS_CITED: 'insights_owned_pages',
    COMPETITOR_CAVEAT: 'insights_competitor_caveats',
    PROMPT_GAP: 'insights_prompt_engine',
}

#: The sentiment labels that count as a caveat.
CAVEAT_LABELS = frozenset({'mixed', 'negative'})

#: The mention changes of ``group_kpi_history.mention_change`` that count as a flip.
MENTION_FLIPS = frozenset({'gained', 'lost'})


# ---------------------------------------------------------------------------
# Engine facts
# ---------------------------------------------------------------------------

def _play(top_1_share: float, citation_rate: float | None) -> str:
    """The play an engine's numbers call for.

    Without owned domains the citation rate is unknown and the play rests on
    the top-1 share alone: nothing to fix, or get ranked first.
    """
    ranked_first = top_1_share >= ENGINE_TOP1_MIN
    if citation_rate is None:
        return DEFEND if ranked_first else GET_RANKED_FIRST
    cited = citation_rate >= ENGINE_CITED_MIN
    if ranked_first:
        return DEFEND if cited else GET_CITED
    return GET_RANKED_FIRST if cited else GET_MENTIONED_AND_CITED


def _engine_row(engine: str, kpis: dict[str, Any]) -> dict[str, Any]:
    return {'engine': engine, 'play': _play(kpis['top_1_share'], kpis['citation_rate']), 'kpis': kpis}


def _engine_facts(tallies: Mapping[str, Mapping[str, Any]], owned_domains: list[str]) -> list[dict[str, Any]]:
    """Every KPI of the tracked brand per AI engine (``tally_kpis`` of each keyword's counts of that engine), engines in name order."""
    engines = sorted({engine for tally in tallies.values() for engine in tally['engines']})
    return [
        _engine_row(engine, tally_kpis(
            (RunTally(keyword, '', {engine: tuple(tally['engines'][engine])}) for keyword, tally in tallies.items() if engine in tally['engines']),
            owned_domains,
        ))
        for engine in engines
    ]


# ---------------------------------------------------------------------------
# Portfolio facts
# ---------------------------------------------------------------------------

def _gap(value: float | None, baseline: float | None, digits: int) -> float | None:
    """``value - baseline`` rounded to ``digits``, or ``None`` when either side is unknown."""
    if value is None or baseline is None:
        return None
    return round(value - baseline, digits)


def _meets(value: float | None, threshold: float) -> bool:
    return value is not None and value >= threshold


def _known(rows: Iterable[Mapping[str, Any]], key: str) -> list[float]:
    return [row[key] for row in rows if row[key] is not None]


def _portfolio_row(row: Mapping[str, Any], best_position: float | None, best_sentiment: float | None) -> dict[str, Any]:
    position_gap = _gap(row['average_position'], best_position, 2)
    sentiment_gap = _gap(best_sentiment, row['net_sentiment'], 1)
    return {
        'name': row['name'],
        'mentions': row['mentions'],
        'average_position': row['average_position'],
        'net_sentiment': row['net_sentiment'],
        # The brand table attributes citations to domains, not to brands: the count stays `None` until a row carries one.
        'citations': row.get('citations'),
        'position_gap': position_gap,
        'sentiment_gap': sentiment_gap,
        'weak': _meets(position_gap, SUBBRAND_POSITION_GAP) or _meets(sentiment_gap, SUBBRAND_SENTIMENT_GAP),
    }


def _portfolio_facts(table: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The first-party brands with ``SUBBRAND_MIN_MENTIONS`` mentions or more, each measured against the best of them.

    ``table`` is the brand table (``brand_table`` order) of the scope's answers.
    ``position_gap`` is how many positions the brand trails the best (lowest)
    average position, ``sentiment_gap`` how many points it trails the best
    net sentiment; a gap at or over its threshold makes the brand ``weak``.
    Empty unless two brands qualify — a gap needs a brand to trail. A brand
    below the floor neither appears nor sets a baseline. Rows keep the
    leaderboard order.
    """
    qualifying = [row for row in table if row['classification'] == FIRST_PARTY and row['mentions'] >= SUBBRAND_MIN_MENTIONS]
    if len(qualifying) < 2:
        return []
    best_position = min(_known(qualifying, 'average_position'), default=None)
    best_sentiment = max(_known(qualifying, 'net_sentiment'), default=None)
    return [_portfolio_row(row, best_position, best_sentiment) for row in qualifying]


# ---------------------------------------------------------------------------
# Stability facts
# ---------------------------------------------------------------------------

def _stability_row(keyword: str, runs: list[Mapping[str, Any]]) -> dict[str, Any]:
    positions = [run['kpis']['average_position'] for run in runs]
    position_range = round(max(positions) - min(positions), 2)
    flips = sum((run['change'] or {}).get('mention') in MENTION_FLIPS for run in runs)
    return {
        'keyword': keyword,
        'runs': len(runs),
        'position_min': min(positions),
        'position_max': max(positions),
        'position_range': position_range,
        'flips': flips,
        'unstable': len(runs) >= 2 and (position_range >= UNSTABLE_POSITION_RANGE or flips >= 1),
    }


def stability_facts(history_keywords: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """How far each keyword's position swung across its runs, from the ``keywords`` of ``build_group_kpi_history``.

    Only runs with an average position count: a run that never ranks the
    brand has no position to compare, and a keyword without one is left out.
    ``flips`` counts the counted runs in which the brand's mention was gained
    or lost since the keyword's previous run. One run cannot swing or flip,
    so a keyword with fewer than two is never unstable.
    """
    facts: list[dict[str, Any]] = []
    for entry in history_keywords:
        positioned = [run for run in entry['runs'] if run['kpis']['average_position'] is not None]
        if positioned:
            facts.append(_stability_row(entry['keyword'], positioned))
    return facts


# ---------------------------------------------------------------------------
# Prompt-by-engine facts
# ---------------------------------------------------------------------------

def _best_position(answers: Iterable[Answer]) -> int | None:
    return min((rank for answer in answers if (rank := answer.best_first_party_rank()) is not None), default=None)


def _is_lost(position: int | None) -> bool:
    return position is None or position > PROMPT_TOP_POSITION


def _prompt_row(keyword: str, answers: list[Answer]) -> dict[str, Any]:
    engines = sorted({answer.provider for answer in answers})
    positions = {engine: _best_position(answer for answer in answers if answer.provider == engine) for engine in engines}
    return {
        'keyword': keyword,
        'visibility_score': brand_kpis(answers)['visibility_score'],
        'positions': positions,
        'lost_engines': [engine for engine in engines if _is_lost(positions[engine])],
    }


def prompt_row_order(row: Mapping[str, Any]) -> tuple[float, str, str]:
    """Lowest visibility score first, then by keyword name."""
    return row['visibility_score'], row['keyword'].lower(), row['keyword']


def _prompt_engine_facts(prompt: Mapping[str, Any]) -> dict[str, Any]:
    """Per keyword, the brand's best position on each AI engine that answered it (``None``: not named at a known position).

    ``lost_engines`` are the engines placing the brand worse than
    ``PROMPT_TOP_POSITION`` or not at all. Every keyword is listed, lowest
    visibility score first (then by name; an answer lists the first
    ``PROMPT_ENGINE_MAX_KEYWORDS``, ``shared.insights_pages``). ``engines``
    are every engine that answered, in name order.
    """
    return {'engines': list(prompt['engines']), 'keywords': [dict(row) for row in prompt['rows']]}


# ---------------------------------------------------------------------------
# Competitor caveat facts
# ---------------------------------------------------------------------------

def _caveat_partial(keyword: str, answers: Sequence[Answer]) -> dict[str, dict[str, Any]]:
    """One keyword's competitor sightings per brand: mentions, the caveats among them, the first name and reasons, with their positions.

    A position (keyword, answer index) orders sightings across keywords the way
    the scope's answers come: keywords in scope order, answers in read order.
    """
    caveats: dict[str, dict[str, Any]] = {}
    for index, answer in enumerate(answers):
        position = [keyword.casefold(), keyword, index]
        for sighting in answer.sightings:
            if sighting.classification != COMPETITOR:
                continue
            row = caveats.setdefault(sighting.key, {'name': [position, sighting.name], 'mentions': 0, 'mixed': 0, 'negative': 0, 'reasons': []})
            row['mentions'] += 1
            if sighting.sentiment in CAVEAT_LABELS:
                row[sighting.sentiment] += 1
                if sighting.reason:
                    row['reasons'] = _distinct_reasons([*row['reasons'], [position, sighting.reason]])
    return caveats


def _distinct_reasons(reasons: Iterable[list[Any]]) -> list[list[Any]]:
    """Every distinct reason, each at its first position, in position order (2.45.0 wave 5: no longer cut to ``CAVEAT_MAX_REASONS``)."""
    first: dict[str, list[Any]] = {}
    for position, reason in sorted(reasons, key=lambda entry: entry[0]):
        first.setdefault(reason, position)
    return [[position, reason] for reason, position in first.items()]


def _merge_caveats(acc: dict[str, dict[str, Any]], part: Mapping[str, Mapping[str, Any]]) -> None:
    for key, counted in part.items():
        row = acc.get(key)
        if row is None:
            acc[key] = {**counted, 'reasons': list(counted['reasons'])}
            continue
        for field in ('mentions', 'mixed', 'negative'):
            row[field] += int(counted[field])
        row['name'] = min(row['name'], counted['name'], key=lambda entry: entry[0])
        row['reasons'] = _distinct_reasons([*row['reasons'], *counted['reasons']])


def _competitor_caveat_facts(caveats: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Per competitor named in the answers, its mentions, how many are worded mixed or negative, and why.

    A mention is one answer naming the competitor (its sighting at its best
    rank, as every KPI counts it). ``caveat_share`` is the mixed and negative
    mentions' percent of all its mentions; ``reasons`` the first
    ``CAVEAT_MAX_REASONS`` distinct stored reasons of those mentions, in
    answer order, and ``reasons_total`` how many there are (every one is in
    ``_caveat_reason_facts``). Most-mentioned competitor first, then by name.
    """
    rows = [
        (row['name'][0], {
            'name': row['name'][1],
            'mentions': row['mentions'],
            'mixed': row['mixed'],
            'negative': row['negative'],
            'caveat_share': percent(row['mixed'] + row['negative'], row['mentions']),
            'reasons': [reason for _position, reason in row['reasons'][:CAVEAT_MAX_REASONS]],
            'reasons_total': len(row['reasons']),
        })
        for row in caveats.values()
    ]
    rows.sort(key=lambda entry: (-entry[1]['mentions'], entry[1]['name'].lower(), entry[0]))
    return [row for _position, row in rows]


def _caveat_reason_facts(caveats: Mapping[str, Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Every distinct reason of every competitor's mixed and negative mentions: ``{'reasons': [{competitor, reason}]}``.

    In the competitor caveats' order, each competitor's reasons in answer
    order; ``shared.insights_pages`` lists none in an answer and pages them
    with ``view=caveat_reasons`` (2.45.0 wave 5).
    """
    names = {row['name'][1]: row for row in caveats.values()}
    return {'reasons': [
        {'competitor': fact['name'], 'reason': reason}
        for fact in _competitor_caveat_facts(caveats)
        for _position, reason in names[fact['name']]['reasons']
    ]}


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

def _insight(kind: str, subject: str, severity: str, evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': f'{kind}:{subject}',
        'kind': kind,
        'severity': severity,
        'subject': subject,
        'evidence': evidence,
        'block': BLOCK_BY_KIND[kind],
    }


def _engine_play_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    kpis = row['kpis']
    severity = HIGH if kpis['answers'] >= ENGINE_HIGH_MIN_ANSWERS else MEDIUM
    evidence = {key: kpis[key] for key in ('top_1_share', 'citation_rate', 'answers')} | {'play': row['play']}
    return _insight(ENGINE_PLAY, row['engine'], severity, evidence)


def _weak_subbrand_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    both = _meets(row['position_gap'], SUBBRAND_POSITION_GAP) and _meets(row['sentiment_gap'], SUBBRAND_SENTIMENT_GAP)
    evidence = {key: row[key] for key in ('mentions', 'average_position', 'net_sentiment', 'position_gap', 'sentiment_gap')}
    return _insight(WEAK_SUBBRAND, row['name'], HIGH if both else MEDIUM, evidence)


def _unstable_keyword_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    evidence = {key: row[key] for key in ('runs', 'position_min', 'position_max', 'position_range', 'flips')}
    return _insight(UNSTABLE_KEYWORD, row['keyword'], MEDIUM if row['flips'] >= 1 else LOW, evidence)


def _lead_severity(leading: int, trailing: int) -> str:
    """High when the leading count is at least ``LEAD_HIGH_RATIO`` times the trailing one and ``LEAD_HIGH_MIN_CITATIONS`` or more."""
    return HIGH if leading >= LEAD_HIGH_RATIO * trailing and leading >= LEAD_HIGH_MIN_CITATIONS else MEDIUM


def _competitor_sites_insights(ownership: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Per engine, the most-cited competitor when its domains are cited more than the owned ones.

    Needs both owned and competitor domains: without either, the comparison
    is not measured.
    """
    if not (ownership['owned_configured'] and ownership['competitors_configured']):
        return []
    insights = []
    for row in ownership['engines']:
        # Most cited first; on a tie, the first by name.
        leader = min(row['competitors'].items(), key=lambda item: (-item[1], item[0]), default=None)
        if leader is not None and leader[1] > row['owned']:
            evidence = {'competitor': leader[0], 'competitor_citations': leader[1], 'owned_citations': row['owned'], 'answers': row['answers']}
            insights.append(_insight(COMPETITOR_SITES, row['engine'], _lead_severity(leader[1], row['owned']), evidence))
    return insights


def _documents_cited_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    evidence = {key: row[key] for key in ('document_citations', 'page_citations')}
    return _insight(DOCUMENTS_CITED, row['engine'], _lead_severity(row['document_citations'], row['page_citations']), evidence)


def _is_caveat(row: Mapping[str, Any]) -> bool:
    return row['mentions'] >= CAVEAT_MIN_MENTIONS and _meets(row['caveat_share'], CAVEAT_SHARE_MIN)


def _competitor_caveat_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    evidence = {key: row[key] for key in ('mentions', 'mixed', 'negative', 'caveat_share')}
    return _insight(COMPETITOR_CAVEAT, row['name'], HIGH if _meets(row['caveat_share'], CAVEAT_HIGH_SHARE) else MEDIUM, evidence)


def _prompt_gap_insight(row: Mapping[str, Any]) -> dict[str, Any]:
    named = [position for position in row['positions'].values() if position is not None]
    evidence = {
        'engines': len(row['positions']),
        'named_engines': len(named),
        'best_position': min(named, default=None),
        'visibility_score': row['visibility_score'],
    }
    return _insight(PROMPT_GAP, row['keyword'], LOW if named else MEDIUM, evidence)


#: Each kind's rule: the insights the facts of ``compute_insights`` support.
_RULES: dict[str, Callable[[Mapping[str, Any]], list[dict[str, Any]]]] = {
    ENGINE_PLAY: lambda facts: [_engine_play_insight(row) for row in facts['engines'] if row['play'] != DEFEND],
    WEAK_SUBBRAND: lambda facts: [_weak_subbrand_insight(row) for row in facts['portfolio'] if row['weak']],
    UNSTABLE_KEYWORD: lambda facts: [_unstable_keyword_insight(row) for row in facts['stability'] if row['unstable']],
    COMPETITOR_SITES: lambda facts: _competitor_sites_insights(facts['citation_ownership']),
    DOCUMENTS_CITED: lambda facts: [
        _documents_cited_insight(row) for row in facts['owned_pages']['engines'] if row['document_citations'] > row['page_citations']
    ],
    COMPETITOR_CAVEAT: lambda facts: [_competitor_caveat_insight(row) for row in facts['competitor_caveats'] if _is_caveat(row)],
    # Pooled over the engines: a prompt gap is a keyword every engine that answered it loses.
    PROMPT_GAP: lambda facts: [
        _prompt_gap_insight(row) for row in facts['prompt_engine']['keywords'] if len(row['lost_engines']) == len(row['positions'])
    ],
}


def _rank(insight: Mapping[str, Any]) -> tuple[int, float]:
    """Severity first, then the answers (or mentions) behind the insight, most first."""
    evidence = insight['evidence']
    return SEVERITIES.index(insight['severity']), -evidence.get('answers', evidence.get('mentions', 0))


def derive_insights(facts: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every insight the facts of ``compute_insights`` support, most severe first.

    Equal severity ranks by the answers or mentions behind the insight, most
    first; equal there too, insights keep the order of ``INSIGHT_KINDS`` and
    of the fact rows, so the same facts always give the same list.
    """
    insights = [insight for kind in INSIGHT_KINDS for insight in _RULES[kind](facts)]
    return sorted(insights, key=_rank)


# ---------------------------------------------------------------------------
# Mergeable facts: one partial per keyword, summed over a scope
# ---------------------------------------------------------------------------

def _encoded_brand(brand: BrandTally) -> list[Any]:
    return [brand.key, brand.name, brand.mentions, brand.points, brand.rank_sum, brand.rank_count, brand.best_rank, list(brand.split), list(brand.engines)]


def _decoded_brand(fields: Sequence[Any]) -> BrandTally:
    key, name, mentions, points, rank_sum, rank_count, best_rank, split, engines = fields
    return BrandTally(key, name, FIRST_PARTY, mentions, points, rank_sum, rank_count, best_rank, tuple(split), tuple(engines))


def keyword_partial(
    keyword: str, answers: Sequence[Answer], owned_domains: Iterable[str] = (), competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any] | None:
    """What one keyword's latest-run ``answers`` add to a scope's facts (JSON-serializable); ``None`` without answers.

    Additive counts per AI engine (``kpi_tally``) and per first-party brand,
    the keyword's prompt-by-engine row, its citation counts by owner and owned
    page, and its competitor sightings. ``merge_partials`` sums them and
    ``facts_from_partials`` turns the sum into the facts.
    """
    if not answers:
        return None
    owned = [domain for domain in owned_domains if normalize_domain(domain)]
    competitors = dict(competitor_domains or {})
    tally = run_tally(keyword, '', answers, owned)
    return {
        'keyword': keyword,
        'timestamp': max(answer.timestamp for answer in answers),
        # What the counts were counted against, so a stored sum is shaped with the same configuration.
        'owned': owned,
        'competitor_domains': {brand: list(domains) for brand, domains in competitors.items()},
        'tally': {
            'engines': {engine: list(counts) for engine, counts in tally.engines.items()},
            'first_party': [_encoded_brand(brand) for brand in tally.brands if brand.classification == FIRST_PARTY],
        },
        'prompt': _prompt_row(keyword, list(answers)),
        'ownership': ownership_partial(answers, owned, competitors),
        'owned_pages': owned_pages_partial(answers, owned),
        'caveats': _caveat_partial(keyword, answers),
    }


def _empty_merge() -> dict[str, Any]:
    return {
        'keywords': 0, 'timestamp': '', 'owned': [], 'competitor_domains': {}, 'tallies': {},
        'prompt': {'rows': [], 'count': 0, 'engines': []},
        'ownership': {}, 'owned_pages': {'pages': {}, 'engines': {}}, 'caveats': {},
    }


def merge_partials(acc: dict[str, Any] | None, part: Mapping[str, Any]) -> dict[str, Any]:
    """``acc`` (``None`` before the first keyword) with one keyword's ``keyword_partial`` added; associative and order-free.

    Everything is summed except the prompt rows, every one kept lowest-scored
    first (with their count), and the per-keyword tallies, which the engine and portfolio facts
    pool in the scope's keyword order. ``part`` is never changed.
    """
    merged = acc if acc is not None else _empty_merge()
    merged['keywords'] += 1
    merged['timestamp'] = max(merged['timestamp'], str(part['timestamp']))
    # Every partial of one build is counted against one configuration (the KeywordLatest ``config`` fingerprint).
    merged['owned'] = list(part['owned'])
    merged['competitor_domains'] = dict(part['competitor_domains'])
    merged['tallies'][part['keyword']] = part['tally']
    prompt = merged['prompt']
    bisect.insort(prompt['rows'], part['prompt'], key=prompt_row_order)
    prompt['count'] += 1
    prompt['engines'] = sorted({*prompt['engines'], *part['prompt']['positions']})
    merge_ownership(merged['ownership'], part['ownership'])
    merge_owned_pages(merged['owned_pages'], part['owned_pages'])
    _merge_caveats(merged['caveats'], part['caveats'])
    return merged


def _scope_order(keyword: str) -> tuple[str, str]:
    return keyword.casefold(), keyword


def _run_tallies(tallies: Mapping[str, Mapping[str, Any]]) -> list[RunTally]:
    """The per-keyword tallies as ``RunTally`` values (first-party brands only), in the scope's keyword order."""
    return [
        RunTally(
            keyword, '',
            {engine: tuple(counts) for engine, counts in tallies[keyword]['engines'].items()},
            brands=tuple(_decoded_brand(fields) for fields in tallies[keyword]['first_party']),
        )
        for keyword in sorted(tallies, key=_scope_order)
    ]


def scope_kpis(merged: Mapping[str, Any] | None, owned_domains: Iterable[str] = ()) -> dict[str, Any]:
    """``brand_kpis`` of every answer the merged partials count."""
    return tally_kpis(_run_tallies(merged['tallies']) if merged else [], list(owned_domains))


def facts_from_partials(
    merged: Mapping[str, Any] | None,
    owned_domains: Iterable[str] = (),
    history_keywords: Iterable[Mapping[str, Any]] | None = None,
    competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any]:
    """The facts of a scope from its keywords' merged partials (``None``: no keyword with answers)."""
    owned = [domain for domain in owned_domains if normalize_domain(domain)]
    base = merged if merged is not None else _empty_merge()
    tallies = base['tallies']
    ordered = {keyword: tallies[keyword] for keyword in sorted(tallies, key=_scope_order)}
    return {
        'engines': _engine_facts(ordered, owned),
        'prompt_engine': _prompt_engine_facts(base['prompt']),
        'citation_ownership': citation_ownership_from(base['ownership'], bool(owned), competitor_domains),
        'owned_pages': owned_pages_from(base['owned_pages']),
        'competitor_caveats': _competitor_caveat_facts(base['caveats']),
        'caveat_reasons': _caveat_reason_facts(base['caveats']),
        'portfolio': _portfolio_facts(tally_brand_table(_run_tallies(tallies))),
        'stability': stability_facts(history_keywords or ()),
    }


def _by_keyword(answers: Iterable[Answer]) -> dict[str, list[Answer]]:
    grouped: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        grouped[answer.keyword].append(answer)
    return grouped


def compute_insights(
    answers: Iterable[Answer],
    owned_domains: Iterable[str] = (),
    history_keywords: Iterable[Mapping[str, Any]] | None = None,
    competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any]:
    """The facts of a scope and the insights they support.

    ``answers`` are the scope's answers (its latest runs), ``owned_domains``
    the brand's own domains (without them every citation KPI is ``None``, the
    plays rest on the top-1 share alone and no owned page is listed),
    ``history_keywords`` the ``keywords`` of ``build_group_kpi_history`` for a
    group — ``None`` for any other scope, whose stability is then empty — and
    ``competitor_domains`` each tracked competitor's domains
    (``insights_citations.competitor_domains_from``); without them every
    non-owned citation is third party. Computed as a scope snapshot computes
    it: one ``keyword_partial`` per keyword, merged, then shaped.
    """
    return insights_from_facts(compute_facts(answers, owned_domains, history_keywords, competitor_domains))


def compute_facts(
    answers: Iterable[Answer],
    owned_domains: Iterable[str] = (),
    history_keywords: Iterable[Mapping[str, Any]] | None = None,
    competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any]:
    """The whole facts of ``compute_insights`` (every owned page, every keyword's prompt row), before they are listed."""
    owned = list(owned_domains)
    merged: dict[str, Any] | None = None
    for keyword, keyword_answers in _by_keyword(answers).items():
        part = keyword_partial(keyword, keyword_answers, owned, competitor_domains)
        if part is not None:
            merged = merge_partials(merged, part)
    return facts_from_partials(merged, owned, history_keywords, competitor_domains)


def insights_from_facts(facts: Mapping[str, Any]) -> dict[str, Any]:
    """The listed ``facts`` (each long list's first page, ``shared.insights_pages.listed_facts``) and the insights they support.

    The body of ``/reports/insights`` beside its coverage fields; the insights
    rest on the listed facts, as they did when the facts held only those rows.
    """
    listed = listed_facts(facts)
    return {'facts': listed, 'insights': derive_insights(listed)}


__all__ = [
    'BLOCK_BY_KIND',
    'CAVEAT_HIGH_SHARE',
    'CAVEAT_MAX_REASONS',
    'CAVEAT_MIN_MENTIONS',
    'CAVEAT_SHARE_MIN',
    'ENGINE_CITED_MIN',
    'ENGINE_TOP1_MIN',
    'INSIGHT_KINDS',
    'LEAD_HIGH_MIN_CITATIONS',
    'LEAD_HIGH_RATIO',
    'PROMPT_ENGINE_MAX_KEYWORDS',
    'PROMPT_TOP_POSITION',
    'SUBBRAND_MIN_MENTIONS',
    'SUBBRAND_POSITION_GAP',
    'SUBBRAND_SENTIMENT_GAP',
    'UNSTABLE_POSITION_RANGE',
    'compute_facts',
    'compute_insights',
    'derive_insights',
    'facts_from_partials',
    'insights_from_facts',
    'keyword_partial',
    'merge_partials',
    'scope_kpis',
    'stability_facts',
]
