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

from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from typing import Any

from shared.kpi_engine import (
    KPI_IDS,
    answers_from_rows,
    kpi_changes,
    kpi_trends,
    percent,
)
from shared.kpi_tally import RunTally, run_tallies, tally_kpis, tally_models

#: Coverage (percent of the group's keywords answered) a run needs to count
#: as a group run: a scheduled run covers them all, a one-keyword rerun does not.
GROUP_RUN_MIN_COVERAGE = 50.0

#: The group KPIs each driver's share of the move is reported for.
DRIVER_IMPACT_KPIS = ('mention_rate', 'visibility_score')


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
    runs = {keyword: run_tallies(keyword, answers_from_rows(rows_by_keyword.get(keyword, ())), domains) for keyword in keywords}
    return group_kpi_history_from_runs(keywords, runs, domains)


def _runs_by_timestamp(runs: Iterable[RunTally]) -> dict[str, RunTally]:
    """A keyword's run tallies with answers, by run timestamp."""
    return {run.timestamp: run for run in runs if run.timestamp and run.answers}


def _kpis_by_run(runs: Mapping[str, RunTally], domains: list[str]) -> dict[str, dict[str, Any]]:
    """Each run's KPIs (``brand_kpis`` of its answers), by run timestamp."""
    return {timestamp: tally_kpis([run], domains) for timestamp, run in runs.items()}


def keyword_run_histories(keywords: list[str], runs_by_keyword: Mapping[str, Iterable[RunTally]], owned_domains: Sequence[str]) -> list[dict[str, Any]]:
    """Each keyword's drill-down (``keyword_history``): the ``keywords`` of ``build_group_kpi_history`` without the group runs."""
    domains = list(owned_domains)
    return [keyword_history(keyword, _kpis_by_run(_runs_by_timestamp(runs_by_keyword.get(keyword, ())), domains)) for keyword in keywords]


def _group_runs(
    keywords: list[str], tallies: Mapping[str, Mapping[str, RunTally]], domains: list[str], keyword_kpis: Callable[[str, str], dict[str, Any]],
) -> Iterator[dict[str, Any]]:
    """Every run of the group, oldest first, each with its ``keyword_kpis`` and its ``change`` against the previous group run.

    Only the previous group run is held for the comparison: a caller that drops ``keyword_kpis`` holds one run's.
    """
    previous_group_run = None
    for timestamp in sorted({timestamp for runs in tallies.values() for timestamp in runs}):
        answered = [keyword for keyword in keywords if timestamp in tallies[keyword]]
        run_tallies_of = [tallies[keyword][timestamp] for keyword in answered]
        # A run timestamp exists only when some keyword was answered, so `keywords` is never empty here.
        coverage = percent(len(answered), len(keywords)) or 0.0
        run: dict[str, Any] = {
            'timestamp': timestamp,
            'keywords_with_data': len(answered),
            'keywords_total': len(keywords),
            'coverage': coverage,
            'is_group_run': coverage >= GROUP_RUN_MIN_COVERAGE,
            'kpis': tally_kpis(run_tallies_of, domains),
            'models': tally_models(run_tallies_of),
            'change': None,
            'keyword_kpis': {keyword: keyword_kpis(keyword, timestamp) for keyword in answered},
        }
        if run['is_group_run']:
            if previous_group_run is not None:
                run['change'] = compare_group_runs(previous_group_run, run)
            previous_group_run = run
        yield run


def _tallies_of(
    keywords: list[str], runs_by_keyword: Mapping[str, Iterable[RunTally]], owned_domains: Iterable[str],
) -> tuple[list[str], dict[str, dict[str, RunTally]]]:
    """The owned domains as a list and each keyword's answered runs by timestamp."""
    return list(owned_domains), {keyword: _runs_by_timestamp(runs_by_keyword.get(keyword, ())) for keyword in keywords}


def _without_keyword_kpis(run: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in run.items() if key != 'keyword_kpis'}


def group_kpi_history_from_runs(
    keywords: list[str],
    runs_by_keyword: Mapping[str, Iterable[RunTally]],
    owned_domains: Iterable[str] = (),
) -> dict[str, Any]:
    """``build_group_kpi_history`` over run tallies already read (``shared.kpi_tally``), counted against ``owned_domains``."""
    domains, tallies = _tallies_of(keywords, runs_by_keyword, owned_domains)
    kpis = {keyword: _kpis_by_run(runs, domains) for keyword, runs in tallies.items()}
    runs = list(_group_runs(keywords, tallies, domains, lambda keyword, timestamp: kpis[keyword][timestamp]))
    return {
        'runs': [_without_keyword_kpis(run) for run in runs],
        'keywords': [keyword_history(keyword, kpis[keyword]) for keyword in keywords],
    }


def group_kpi_summary_from_runs(
    keywords: list[str], runs_by_keyword: Mapping[str, Iterable[RunTally]], owned_domains: Iterable[str] = (),
) -> dict[str, Any]:
    """``group_kpi_history_from_runs`` as the snapshot and window views keep it: every run (``summary_run``), each
    keyword's ``keyword_summary`` and every run's drivers (``run_drivers``).

    Equal to summarizing the whole history, without holding every keyword's KPIs of every run at once: one
    group run's keyword KPIs (and the previous group run's) and, per keyword, only its last two runs (whose
    latest entry's change needs only the run before): ~400 MB fewer for 5,000 keywords x 31 runs.
    """
    domains, tallies = _tallies_of(keywords, runs_by_keyword, owned_domains)
    runs: list[dict[str, Any]] = []
    drivers: list[dict[str, Any]] = []
    for run in _group_runs(keywords, tallies, domains, lambda keyword, timestamp: tally_kpis([tallies[keyword][timestamp]], domains)):
        bare = _without_keyword_kpis(run)
        drivers.extend(run_drivers([bare]))
        runs.append(summary_run(bare))
    summaries = []
    for keyword in keywords:
        last_two = {timestamp: tallies[keyword][timestamp] for timestamp in sorted(tallies[keyword])[-2:]}
        entry = keyword_history(keyword, _kpis_by_run(last_two, domains))
        summaries.append({**keyword_summary(entry), 'runs_count': len(tallies[keyword])})
    return {'runs': runs, 'keywords': summaries, 'drivers': drivers}


def summary_run(run: Mapping[str, Any]) -> dict[str, Any]:
    """A run of ``build_group_kpi_history`` with its change's drivers replaced by their count (``drivers_count``)."""
    change = run['change']
    if change is None:
        return dict(run)
    return {
        **run,
        'change': {**{key: value for key, value in change.items() if key != 'drivers'}, 'drivers_count': len(change['drivers'])},
    }


def keyword_summary(entry: Mapping[str, Any]) -> dict[str, Any]:
    """A keyword's drill-down reduced to how many runs it has and its latest run (``None`` without one)."""
    runs = entry['runs']
    return {'keyword': entry['keyword'], 'runs_count': len(runs), 'latest': runs[-1] if runs else None}


def run_drivers(runs: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The drivers of every compared group run of ``build_group_kpi_history``'s ``runs``, oldest first."""
    return [
        {'timestamp': run['timestamp'], 'previous_timestamp': run['change']['previous_timestamp'], 'drivers': run['change']['drivers']}
        for run in runs
        if run['change'] is not None
    ]


__all__ = [
    'DRIVER_IMPACT_KPIS',
    'GROUP_RUN_MIN_COVERAGE',
    'build_group_kpi_history',
    'compare_group_runs',
    'group_kpi_history_from_runs',
    'group_kpi_summary_from_runs',
    'keyword_history',
    'keyword_run_histories',
    'keyword_summary',
    'mention_change',
    'run_drivers',
    'summary_run',
]
