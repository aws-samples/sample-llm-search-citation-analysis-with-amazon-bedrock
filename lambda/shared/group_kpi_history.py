"""
Per-run KPI history of a keyword group (one hotel) and its keywords.

The per-hotel report shows how the group's KPIs move from one analysis run
to the next. Every KPI is computed by ``shared.kpi_engine`` and defined in
``docs/kpi-definitions.md``: a run's value pools the answers of all its
keywords, so every AI answer weighs the same.

A run is one ``SearchResults.timestamp``: ParseKeywords stamps a single
timestamp on every keyword of an execution.

Runs are not all comparable. A scheduled or group run covers the group's
keywords; re-running one keyword creates a run holding that keyword alone,
and a group value computed from it is not the hotel's visibility. Each run
therefore carries its coverage, and ``is_group_run`` marks runs covering at
least ``GROUP_RUN_MIN_COVERAGE`` percent of the keywords. Only group runs are
compared with each other; every run still appears in the keyword drill-down.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamodb_batch import collect_all_items
from shared.kpi_engine import (
    ANSWER_ATTRIBUTE_NAMES,
    ANSWER_PROJECTION,
    KPI_IDS,
    Answer,
    answers_from_rows,
    brand_kpis,
    kpi_changes,
    kpi_trends,
)

#: Coverage (percent of the group's keywords answered) a run needs to count
#: as a group run: a scheduled run covers them all, a one-keyword rerun does not.
GROUP_RUN_MIN_COVERAGE = 50.0

#: The group KPIs each driver's share of the move is reported for.
DRIVER_IMPACT_KPIS = ('mention_rate', 'visibility_score')


def query_keyword_rows_since(table: Any, keyword: str, since: str) -> list[dict[str, Any]]:
    """Every projected SearchResults row of ``keyword`` from ``since`` (an ISO timestamp) on.

    The sort key starts with the run timestamp (``<ts>#<provider>#<persona>``),
    so the window is a key condition: only the requested days are read, not
    the keyword's whole history.
    """
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').gte(since),
        ProjectionExpression=ANSWER_PROJECTION,
        ExpressionAttributeNames=ANSWER_ATTRIBUTE_NAMES,
    )


def query_keyword_run_rows(table: Any, keyword: str, timestamp: str) -> list[dict[str, Any]]:
    """Every projected SearchResults row of ``keyword`` in the run stamped ``timestamp``."""
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{timestamp}#'),
        ProjectionExpression=ANSWER_PROJECTION,
        ExpressionAttributeNames=ANSWER_ATTRIBUTE_NAMES,
    )


def answers_by_run(answers: Iterable[Answer]) -> dict[str, list[Answer]]:
    """``answers`` grouped by run timestamp; answers without one are dropped."""
    runs: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        if answer.timestamp:
            runs[answer.timestamp].append(answer)
    return runs


def run_models(answers: Iterable[Answer]) -> dict[str, list[str]]:
    """The models each engine answered with, so a model change is visible on the chart."""
    models: dict[str, set[str]] = defaultdict(set)
    for answer in answers:
        if answer.model is not None:
            models[answer.provider].add(answer.model)
    return {provider: sorted(names) for provider, names in sorted(models.items())}


def mention_change(current: Mapping[str, Any], previous: Mapping[str, Any]) -> str | None:
    """``'gained'`` / ``'lost'`` when the brand started or stopped being mentioned between two runs."""
    now, before = bool(current['mentions']), bool(previous['mentions'])
    if now == before:
        return None
    return 'gained' if now else 'lost'


def keyword_history(keyword: str, kpis_by_run: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
    """The drill-down for one keyword: its KPIs per run, oldest first, each with its change since the previous run."""
    runs: list[dict[str, Any]] = []
    for timestamp in sorted(kpis_by_run):
        kpis = kpis_by_run[timestamp]
        previous = runs[-1] if runs else None
        runs.append({
            'timestamp': timestamp,
            'kpis': kpis,
            'change': None if previous is None else {
                'previous_timestamp': previous['timestamp'],
                'mention': mention_change(kpis, previous['kpis']),
                'deltas': kpi_changes(kpis, previous['kpis']),
            },
        })
    return {'keyword': keyword, 'runs': runs}


def _driver(keyword: str, current: Mapping[str, Any], previous: Mapping[str, Any], run_answers: int) -> dict[str, Any] | None:
    """How one keyword moved between two group runs, and its share of the group's move; ``None`` when it did not move.

    ``impact`` is the keyword's change weighted by its share of the later
    run's answers. The impacts add up to the group's change when every
    keyword has as many answers in both runs, and estimate it otherwise.
    """
    deltas = kpi_changes(current, previous)
    mention = mention_change(current, previous)
    if mention is None and all(deltas[kpi] in (None, 0) for kpi in KPI_IDS):
        return None
    share = current['answers'] / run_answers
    return {
        'keyword': keyword,
        'mention': mention,
        'deltas': deltas,
        'impact': {kpi: round((deltas[kpi] or 0) * share, 2) for kpi in DRIVER_IMPACT_KPIS},
    }


def _by_name(keywords: Iterable[str]) -> list[str]:
    return sorted(keywords, key=lambda keyword: (keyword.lower(), keyword))


def compare_group_runs(previous: Mapping[str, Any], current: Mapping[str, Any]) -> dict[str, Any]:
    """What changed from one group run to the next: KPI deltas, trends and the keywords that drove them.

    Each run carries ``keyword_kpis``: the KPIs of every keyword it answered.
    """
    before = previous['keyword_kpis']
    after = current['keyword_kpis']
    drivers = [
        driver
        for keyword in _by_name(set(before) & set(after))
        if (driver := _driver(keyword, after[keyword], before[keyword], current['kpis']['answers'])) is not None
    ]
    drivers.sort(key=lambda driver: (
        *(-abs(driver['impact'][kpi]) for kpi in DRIVER_IMPACT_KPIS),
        driver['keyword'].lower(),
    ))
    deltas = kpi_changes(current['kpis'], previous['kpis'])
    return {
        'previous_timestamp': previous['timestamp'],
        'deltas': deltas,
        'trends': kpi_trends(deltas),
        'drivers': drivers,
        'keywords_entered': _by_name(set(after) - set(before)),
        'keywords_left': _by_name(set(before) - set(after)),
    }


def build_group_kpi_history(
    keywords: list[str],
    rows_by_keyword: Mapping[str, Iterable[Mapping[str, Any]]],
    owned_domains: Iterable[str] = (),
) -> dict[str, Any]:
    """Every run of the group in the window, oldest first, plus the per-keyword drill-down.

    A keyword is answered in a run when at least one AI engine answered it
    successfully. Each group run carries ``change``: its deltas, trends and
    drivers against the previous group run. Partial runs carry ``change: None``
    and are never the base of a comparison.
    """
    domains = list(owned_domains)
    answers = {keyword: answers_by_run(answers_from_rows(rows_by_keyword.get(keyword, ()))) for keyword in keywords}
    kpis = {
        keyword: {timestamp: brand_kpis(run, domains) for timestamp, run in runs.items()}
        for keyword, runs in answers.items()
    }

    runs: list[dict[str, Any]] = []
    previous_group_run: dict[str, Any] | None = None
    for timestamp in sorted({timestamp for runs in answers.values() for timestamp in runs}):
        answered = [keyword for keyword in keywords if timestamp in answers[keyword]]
        run_answers = [answer for keyword in answered for answer in answers[keyword][timestamp]]
        coverage = round(len(answered) / len(keywords) * 100, 1)
        run: dict[str, Any] = {
            'timestamp': timestamp,
            'keywords_with_data': len(answered),
            'keywords_total': len(keywords),
            'coverage': coverage,
            'is_group_run': coverage >= GROUP_RUN_MIN_COVERAGE,
            'kpis': brand_kpis(run_answers, domains),
            'models': run_models(run_answers),
            'change': None,
            'keyword_kpis': {keyword: kpis[keyword][timestamp] for keyword in answered},
        }
        if run['is_group_run']:
            if previous_group_run is not None:
                run['change'] = compare_group_runs(previous_group_run, run)
            previous_group_run = run
        runs.append(run)

    return {
        'runs': [{key: value for key, value in run.items() if key != 'keyword_kpis'} for run in runs],
        'keywords': [keyword_history(keyword, kpis[keyword]) for keyword in keywords],
    }


__all__ = [
    'DRIVER_IMPACT_KPIS',
    'GROUP_RUN_MIN_COVERAGE',
    'answers_by_run',
    'build_group_kpi_history',
    'compare_group_runs',
    'keyword_history',
    'mention_change',
    'query_keyword_rows_since',
    'query_keyword_run_rows',
    'run_models',
]
