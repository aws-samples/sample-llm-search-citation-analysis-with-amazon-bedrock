"""
The Visibility tab's two views of a scope (one keyword, a keyword group or
every keyword), built from answers with ``shared.kpi_engine``:

- ``visibility_view``: where the brand stands now — every KPI over each
  keyword's latest run, pooled, its change since each keyword's previous
  run, the brand leaderboard and a row per keyword.
- ``trend_view``: how it moved — every KPI per day, week or month, the
  latest period against the previous one, and each keyword's own move.

Definitions: ``docs/kpi-definitions.md``.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from shared.kpi_engine import Answer, brand_kpis, brand_table, kpi_changes, kpi_trends

#: The trend periods: a calendar day, an ISO week (Monday to Sunday) or a calendar month.
PERIODS = ('day', 'week', 'month')

_PERIOD_FORMATS = {'day': '%Y-%m-%d', 'week': '%G-W%V', 'month': '%Y-%m'}


def _latest_timestamp(answers: Iterable[Answer]) -> str | None:
    return max((answer.timestamp for answer in answers), default=None)


def _of_persona(answers: Iterable[Answer], persona: str | None) -> list[Answer]:
    return [answer for answer in answers if persona is None or answer.persona == persona]


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
    return {'keywords_compared': len(compared), **_change(latest, previous)}


def visibility_view(
    keywords: list[str],
    answers_by_keyword: Mapping[str, Iterable[Answer]],
    owned_domains: Iterable[str] = (),
    *,
    previous_by_keyword: Mapping[str, Iterable[Answer]] | None = None,
    persona: str | None = None,
    brand: str | None = None,
) -> dict[str, Any]:
    """Every KPI over the given latest-run answers of each keyword, pooled.

    ``previous_by_keyword`` holds each keyword's run before its latest one;
    ``change`` then compares the two runs over the keywords answered in both
    (``None`` without such a keyword). ``persona`` keeps the answers of one
    persona; ``brand`` narrows the leaderboard to brands whose name contains
    it (the KPIs are unchanged). A keyword whose latest run has no answer is
    reported without KPIs.
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
    brands = brand_table(pooled)
    if brand:
        brands = [row for row in brands if brand.lower() in row['name'].lower()]
    return {
        'timestamp': _latest_timestamp(pooled),
        'keywords_analyzed': len(keywords),
        'keywords_with_data': sum(row['has_data'] for row in rows),
        'kpis': brand_kpis(pooled, domains),
        'change': _run_change(latest, previous, domains),
        'brands': brands,
        'keywords': rows,
    }


def period_key(timestamp: str, period: str) -> str | None:
    """The day (``2026-09-28``), ISO week (``2026-W40``) or month (``2026-09``) of a run timestamp."""
    try:
        parsed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed.strftime(_PERIOD_FORMATS[period])


def _by_period(answers: Iterable[Answer], period: str) -> dict[str, list[Answer]]:
    buckets: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        key = period_key(answer.timestamp, period)
        if key is not None:
            buckets[key].append(answer)
    return dict(sorted(buckets.items()))


def _change(current: Mapping[str, Any], previous: Mapping[str, Any]) -> dict[str, Any]:
    deltas = kpi_changes(current, previous)
    return {'deltas': deltas, 'trends': kpi_trends(deltas)}


def _keyword_trend(keyword: str, periods: dict[str, list[Answer]], domains: list[str]) -> dict[str, Any]:
    """One keyword's latest period, and its change since the keyword's previous period."""
    keys = list(periods)
    latest = brand_kpis(periods[keys[-1]], domains)
    change = None
    if len(keys) > 1:
        change = {'previous_period': keys[-2], **_change(latest, brand_kpis(periods[keys[-2]], domains))}
    return {'keyword': keyword, 'period': keys[-1], 'kpis': latest, 'change': change}


def _group_change(per_keyword: Mapping[str, dict[str, list[Answer]]], domains: list[str]) -> dict[str, Any] | None:
    """Latest against previous period, like for like: only the keywords measured in both are compared."""
    compared = [periods for periods in per_keyword.values() if len(periods) > 1]
    if not compared:
        return None
    latest = [answer for periods in compared for answer in list(periods.values())[-1]]
    previous = [answer for periods in compared for answer in list(periods.values())[-2]]
    return {'keywords_compared': len(compared), **_change(brand_kpis(latest, domains), brand_kpis(previous, domains))}


def trend_view(
    keywords: list[str],
    answers_by_keyword: Mapping[str, Iterable[Answer]],
    period: str,
    owned_domains: Iterable[str] = (),
) -> dict[str, Any]:
    """Every KPI per period, the scope's latest standing and move, and each keyword's move.

    - ``trend_data``: one point per period holding every answer of the scope in it.
    - ``latest``: every KPI over each keyword's latest period, pooled.
    - ``change``: the latest period against the previous one, over the keywords measured in both.
    - ``keyword_trends``: each keyword's latest period and change, best visibility score first.
    - ``overall``: how many keywords improve, decline or hold on the visibility score.
    """
    domains = list(owned_domains)
    per_keyword = {
        keyword: periods for keyword in keywords
        if (periods := _by_period(answers_by_keyword.get(keyword, ()), period))
    }
    series = _by_period((answer for periods in per_keyword.values() for bucket in periods.values() for answer in bucket), period)
    keyword_trends = [_keyword_trend(keyword, periods, domains) for keyword, periods in per_keyword.items()]
    keyword_trends.sort(key=lambda row: (-(row['kpis']['visibility_score'] or 0), row['keyword'].lower()))
    directions = [row['change']['trends']['visibility_score'] if row['change'] else 'stable' for row in keyword_trends]
    latest = [answer for periods in per_keyword.values() for answer in list(periods.values())[-1]]
    return {
        'keywords_with_data': len(per_keyword),
        'trend_data': [
            {
                'period': key,
                'runs': len({answer.timestamp for answer in answers}),
                'keywords_with_data': len({answer.keyword for answer in answers}),
                'kpis': brand_kpis(answers, domains),
            }
            for key, answers in series.items()
        ],
        'latest': brand_kpis(latest, domains),
        'change': _group_change(per_keyword, domains),
        'keyword_trends': keyword_trends,
        'overall': {
            'improving_count': directions.count('improving'),
            'declining_count': directions.count('declining'),
            'stable_count': directions.count('stable'),
        },
    }


__all__ = ['PERIODS', 'period_key', 'trend_view', 'visibility_view']
