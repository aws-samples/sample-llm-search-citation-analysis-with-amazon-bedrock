"""
The Visibility tab's two views of a scope (one keyword, a keyword group or
every keyword), built from answers with ``shared.kpi_engine``:

- ``visibility_view``: where the brand stands now — every KPI over each
  keyword's latest run, pooled, its change since each keyword's previous
  run, the brand leaderboard, every KPI per AI engine, the most cited
  domains and a row per keyword.
- ``trend_view``: how it moved (from per-run tallies, ``shared.kpi_tally``) — every KPI per day, week or month, the
  latest period against the previous one, each keyword's own move, and the
  tracked brand against its leading competitors over time.

Definitions: ``docs/kpi-definitions.md``.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from shared.kpi_engine import (
    COMPETITOR,
    FIRST_PARTY,
    Answer,
    brand_kpis,
    brand_table,
    combined_citation_versions,
    engine_breakdown,
    kpi_changes,
    kpi_trends,
    source_table,
)
from shared.kpi_tally import BrandPool, RunTally, brands_truncated, tally_brand_table, tally_kpis, tally_mentions

#: The format of each trend period: a calendar day, an ISO week (Monday to Sunday) or a calendar month.
_PERIOD_FORMATS = {'day': '%Y-%m-%d', 'week': '%G-W%V', 'month': '%Y-%m'}

#: The trend periods.
PERIODS = tuple(_PERIOD_FORMATS)

#: The most cited domains a visibility view lists.
SOURCES_LIMIT = 25

#: The most visible brands a visibility view lists (first-party and tracked brands are listed wherever they rank).
BRANDS_LIMIT = 100

#: The competitors whose share of voice is followed over time, next to the tracked brand.
BRAND_TREND_COMPETITORS = 5

#: The brands of the latest leaderboard of a trend view.
LATEST_BRANDS_LIMIT = 10

#: The per-brand KPIs followed over time.
_BRAND_TREND_KPIS = ('share_of_voice', 'mention_rate', 'visibility_score', 'average_position')


def _latest_timestamp(answers: Iterable[Answer]) -> str | None:
    return max((answer.timestamp for answer in answers), default=None)


def _of_persona(answers: Iterable[Answer], persona: str | None) -> list[Answer]:
    return [answer for answer in answers if persona is None or answer.persona == persona]


def _listed_brands(rows: list[dict[str, Any]], tracked_brands: Iterable[str]) -> list[dict[str, Any]]:
    """The first ``BRANDS_LIMIT`` leaderboard rows, then the first-party and tracked brands ranked below them."""
    tracked = {name.lower() for name in tracked_brands}
    beyond = [
        row for row in rows[BRANDS_LIMIT:]
        if row['classification'] == FIRST_PARTY or row['name'].lower() in tracked
    ]
    return rows[:BRANDS_LIMIT] + beyond


def _run_change(
    latest_by_keyword: Mapping[str, list[Answer]],
    previous_by_keyword: Mapping[str, list[Answer]],
    domains: list[str],
) -> dict[str, Any] | None:
    """Latest against previous run, like for like: only the keywords with answers in both runs are compared."""
    compared = [keyword for keyword, answers in latest_by_keyword.items() if answers and previous_by_keyword.get(keyword)]
    if not compared:
        return None
    latest = brand_kpis((answer for keyword in compared for answer in latest_by_keyword[keyword]), domains)
    previous = brand_kpis((answer for keyword in compared for answer in previous_by_keyword[keyword]), domains)
    return {'keywords_compared': len(compared), **run_change_fields(latest, previous)}


def visibility_view(
    keywords: list[str],
    answers_by_keyword: Mapping[str, Iterable[Answer]],
    owned_domains: Iterable[str] = (),
    *,
    previous_by_keyword: Mapping[str, Iterable[Answer]] | None = None,
    persona: str | None = None,
    brand: str | None = None,
    tracked_brands: Iterable[str] = (),
) -> dict[str, Any]:
    """Every KPI over the given latest-run answers of each keyword, pooled.

    ``previous_by_keyword`` holds each keyword's run before its latest one;
    ``change`` then compares the two runs over the keywords answered in both
    (``None`` without such a keyword). ``persona`` keeps the answers of one
    persona; ``brand`` narrows the leaderboard to brands whose name contains
    it (the KPIs are unchanged). A keyword whose latest run has no answer is
    reported without KPIs. ``brands`` lists the ``BRANDS_LIMIT`` most visible
    brands (of ``brands_total``), then every first-party brand and every
    ``tracked_brands`` name ranked below them; each row's ``position`` is its
    place in the whole leaderboard. ``engines`` breaks every KPI down by AI
    engine; ``sources`` lists the ``SOURCES_LIMIT`` most cited domains (of
    ``sources_total``).
    """
    domains = list(owned_domains)
    latest = {keyword: _of_persona(answers_by_keyword.get(keyword, ()), persona) for keyword in keywords}
    previous = {keyword: _of_persona((previous_by_keyword or {}).get(keyword, ()), persona) for keyword in keywords}
    pooled = [answer for answers in latest.values() for answer in answers]
    rows = [
        {
            'keyword': keyword,
            'timestamp': _latest_timestamp(answers),
            'has_data': bool(answers),
            'kpis': brand_kpis(answers, domains) if answers else None,
        }
        for keyword, answers in latest.items()
    ]
    brands = [{**row, 'position': index + 1} for index, row in enumerate(brand_table(pooled))]
    if brand:
        brands = [row for row in brands if brand.lower() in row['name'].lower()]
    sources = source_table(pooled, domains)
    return {
        'timestamp': _latest_timestamp(pooled),
        'keywords_analyzed': len(keywords),
        'keywords_with_data': sum(row['has_data'] for row in rows),
        'kpis': brand_kpis(pooled, domains),
        'change': _run_change(latest, previous, domains),
        'brands': _listed_brands(brands, tracked_brands),
        'brands_total': len(brands),
        'engines': engine_breakdown(pooled, domains),
        'sources': sources[:SOURCES_LIMIT],
        'sources_total': len(sources),
        'keywords': rows,
    }


def period_key(timestamp: str, period: str) -> str | None:
    """The day (``2026-09-28``), ISO week (``2026-W40``) or month (``2026-09``) of a run timestamp."""
    try:
        parsed = datetime.fromisoformat(timestamp)
    except ValueError:
        return None
    return parsed.strftime(_PERIOD_FORMATS[period])


def _by_period(runs: Iterable[RunTally], period: str) -> dict[str, list[RunTally]]:
    """Runs with answers grouped by ``period``, periods in order (a run of no answer has no period)."""
    buckets: dict[str, list[RunTally]] = defaultdict(list)
    for run in runs:
        key = period_key(run.timestamp, period)
        if key is not None and run.answers:
            buckets[key].append(run)
    return dict(sorted(buckets.items()))


def run_change_fields(current: Mapping[str, Any], previous: Mapping[str, Any]) -> dict[str, Any]:
    """``deltas`` and ``trends`` of the KPIs ``current`` against ``previous``: the body of every ``change``."""
    deltas = kpi_changes(current, previous)
    return {'deltas': deltas, 'trends': kpi_trends(deltas)}




def _keyword_trend(keyword: str, periods: dict[str, list[RunTally]], domains: list[str]) -> dict[str, Any]:
    """One keyword's latest period, and its change since the keyword's previous period."""
    keys = list(periods)
    latest = tally_kpis(periods[keys[-1]], domains)
    change = None
    if len(keys) > 1:
        change = {'previous_period': keys[-2], **run_change_fields(latest, tally_kpis(periods[keys[-2]], domains))}
    return {'keyword': keyword, 'period': keys[-1], 'kpis': latest, 'change': change}


def _group_change(per_keyword: Mapping[str, dict[str, list[RunTally]]], domains: list[str]) -> dict[str, Any] | None:
    """Latest against previous period, like for like: only the keywords measured in both are compared."""
    compared = [periods for periods in per_keyword.values() if len(periods) > 1]
    if not compared:
        return None
    latest = [run for periods in compared for run in list(periods.values())[-1]]
    previous = [run for periods in compared for run in list(periods.values())[-2]]
    return {'keywords_compared': len(compared), **run_change_fields(tally_kpis(latest, domains), tally_kpis(previous, domains))}


def _brand_point(period: str, kpis: Mapping[str, Any]) -> dict[str, Any]:
    return {'period': period, **{kpi: kpis[kpi] for kpi in _BRAND_TREND_KPIS}}


def _absent_brand(runs: list[RunTally]) -> dict[str, Any]:
    """The KPIs of a brand no answer of the period names."""
    named = tally_mentions(runs) > 0
    return {'share_of_voice': 0.0 if named else None, 'mention_rate': 0.0, 'visibility_score': 0.0, 'average_position': None}


def _period_tables(series: Mapping[str, list[RunTally]]) -> tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]]:
    """The window's leaderboard and each period's brand rows by lower-cased name."""
    pools = {key: BrandPool.of(runs) for key, runs in series.items()}
    window = BrandPool()
    for pool in pools.values():
        window.add_pool(pool)
    return window.table(), {key: {row['name'].lower(): row for row in pool.table()} for key, pool in pools.items()}


def _brand_trends(
    series: Mapping[str, list[RunTally]], tracked_kpis: Mapping[str, Mapping[str, Any]],
    tables: tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]],
) -> dict[str, Any]:
    """Share of voice, mention rate, visibility score and position per period: the tracked brand and its leading competitors.

    The competitors are the ``BRAND_TREND_COMPETITORS`` with the best
    visibility score over the whole window; a period whose answers do not
    name one scores it 0 (no position).
    """
    window, periods = tables
    leaders = [row['name'] for row in window if row['classification'] == COMPETITOR][:BRAND_TREND_COMPETITORS]
    return {
        'tracked': [_brand_point(key, tracked_kpis[key]) for key in series],
        'competitors': [
            {
                'name': name,
                'points': [_brand_point(key, periods[key].get(name.lower()) or _absent_brand(series[key])) for key in series],
            }
            for name in leaders
        ],
    }


def brand_series(tables: tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]]) -> list[dict[str, Any]]:
    """Every brand of the window, in leaderboard order, with its KPIs in each period whose answers name it (2.45.0: S4)."""
    window, periods = tables
    return [
        {
            'name': row['name'],
            'classification': row['classification'],
            'points': [_brand_point(key, table[row['name'].lower()]) for key, table in periods.items() if row['name'].lower() in table],
        }
        for row in window
    ]


def trend_view(
    keywords: list[str],
    runs_by_keyword: Mapping[str, Iterable[RunTally]],
    period: str,
    owned_domains: Iterable[str] = (),
    *,
    with_brand_series: bool = False,
) -> dict[str, Any]:
    """Every KPI per period, the scope's latest standing and move, and each keyword's move.

    ``runs_by_keyword`` holds each keyword's run tallies (``shared.kpi_tally``),
    oldest first, counted against ``owned_domains``.

    - ``trend_data``: one point per period holding every answer of the scope in it.
    - ``latest``: every KPI over each keyword's latest period, pooled; ``latest_brands``: its whole leaderboard
      (a body lists its first ``LATEST_BRANDS_LIMIT``, ``shared.artifact_trends.trend_answer``).
    - ``change``: the latest period against the previous one, over the keywords measured in both.
    - ``keyword_trends``: each keyword's latest period and change, best visibility score first.
    - ``overall``: how many keywords improve, decline or hold on the visibility score.
    - ``brand_trends``: the tracked brand and its leading competitors per period.
    - ``brand_series`` (only ``with_brand_series``): every brand of the window and its KPIs per period (``brand_series``).
    - ``citation_versions`` / ``citation_versions_mixed``: the citation rules of every answer of the window
      (``shared.kpi_engine.combined_citation_versions``); periods of one rule each can still mix two over the window.
    - ``brands_truncated``: some run kept only its top brands (``shared.keyword_run_kpis.BRANDS_PER_RUN``, first-party
      and tracked brands always), so a competitor outside them reads as not named in that run.
    """
    domains = list(owned_domains)
    per_keyword = {
        keyword: periods for keyword in keywords
        if (periods := _by_period(runs_by_keyword.get(keyword, ()), period))
    }
    series = _by_period((run for periods in per_keyword.values() for bucket in periods.values() for run in bucket), period)
    series_kpis = {key: tally_kpis(runs, domains) for key, runs in series.items()}
    keyword_trends = [_keyword_trend(keyword, periods, domains) for keyword, periods in per_keyword.items()]
    keyword_trends.sort(key=lambda row: (-row['kpis']['visibility_score'], row['keyword'].lower()))
    directions = [row['change']['trends']['visibility_score'] if row['change'] else 'stable' for row in keyword_trends]
    latest = [run for periods in per_keyword.values() for run in list(periods.values())[-1]]
    tables = _period_tables(series)
    body = {
        'keywords_with_data': len(per_keyword),
        'trend_data': [
            {
                'period': key,
                'runs': len({run.timestamp for run in runs}),
                'keywords_with_data': len({run.keyword for run in runs}),
                'kpis': series_kpis[key],
            }
            for key, runs in series.items()
        ],
        'latest': tally_kpis(latest, domains),
        'latest_brands': tally_brand_table(latest),
        'change': _group_change(per_keyword, domains),
        'keyword_trends': keyword_trends,
        'overall': {
            'improving_count': directions.count('improving'),
            'declining_count': directions.count('declining'),
            'stable_count': directions.count('stable'),
        },
        'brand_trends': _brand_trends(series, series_kpis, tables),
        'brands_truncated': brands_truncated(run for periods in per_keyword.values() for bucket in periods.values() for run in bucket),
        # The window's citation rules (every period together), so a client sees a mix across periods too.
        **combined_citation_versions(series_kpis.values()),
    }
    if with_brand_series:
        body['brand_series'] = brand_series(tables)
    return body


__all__ = [
    'BRANDS_LIMIT',
    'BRAND_TREND_COMPETITORS',
    'LATEST_BRANDS_LIMIT',
    'PERIODS',
    'SOURCES_LIMIT',
    'brand_series',
    'period_key',
    'run_change_fields',
    'trend_view',
    'visibility_view',
]
