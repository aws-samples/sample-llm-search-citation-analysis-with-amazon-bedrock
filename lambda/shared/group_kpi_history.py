"""
Per-run KPI history of a keyword group (one hotel) and its keywords.

The Brand Visibility report shows how the group's three headline KPIs move
from one analysis run to the next:

- **Citation rate** (API field ``coverage_rate``): the share of the group's
  keywords, among those with data in the run, where at least one AI answer
  mentions a first-party brand. Keyword-level: a keyword counts once however
  many providers mention the brand. It does not look at cited URLs.
- **Share of voice** (``first_party_avg_sov``): per keyword, first-party
  mentions / all brand mentions across the run's answers; the group value is
  the mean over keywords with data, each keyword weighing the same.
- **Prominence** (``rank_1_share``, ``top_3_share``, ``mean_rank``): where the
  first-party brand is placed within each answer. Rank shares divide by every
  answer, including those that do not mention the brand; mean rank covers
  answers that rank it. Group values are equal-keyword means.

Every number comes from the functions behind ``/visibility``
(``shared.visibility_metrics`` / ``shared.visibility_score``), applied to one
exact run at a time. A run is one ``SearchResults.timestamp``: ParseKeywords
stamps a single timestamp on every keyword of an execution.

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
from shared.visibility_metrics import calculate_keyword_visibility
from shared.visibility_score import summarize_group_visibility, summarize_keyword_visibility

#: Coverage (percent of the group's keywords with data) a run needs to count
#: as a group run: a scheduled run covers them all, a one-keyword rerun does not.
GROUP_RUN_MIN_COVERAGE = 50.0

#: The group KPIs compared between consecutive group runs.
GROUP_KPI_FIELDS = ('coverage_rate', 'first_party_avg_sov', 'rank_1_share', 'top_3_share', 'mean_rank')

#: The per-keyword values shown in the drill-down, one row per run.
KEYWORD_RUN_FIELDS = (
    'first_party_mentioned',
    'first_party_sov',
    'rank_1_share',
    'top_3_share',
    'mean_rank',
    'first_party_best_rank',
    'answers',
    'mentioned_answers',
    'first_party_score',
)

#: Per-keyword values whose run-to-run difference is reported.
KEYWORD_DELTA_FIELDS = ('first_party_sov', 'rank_1_share', 'top_3_share', 'mean_rank')

_HISTORY_PROJECTION = '#ts, provider, brands, query_prompt_id, #md.model'


def query_keyword_rows_since(table: Any, keyword: str, since: str) -> list[dict[str, Any]]:
    """Every projected SearchResults row of ``keyword`` from ``since`` (an ISO timestamp) on.

    The sort key starts with the run timestamp (``<ts>#<provider>#<persona>``),
    so the window is a key condition: only the requested days are read, not
    the keyword's whole history.
    """
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').gte(since),
        ProjectionExpression=_HISTORY_PROJECTION,
        ExpressionAttributeNames={'#ts': 'timestamp', '#md': 'metadata'},
    )


def _rows_by_run(rows: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """``rows`` grouped by run timestamp; rows without one are dropped."""
    runs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        timestamp = row.get('timestamp')
        if isinstance(timestamp, str) and timestamp:
            runs[timestamp].append(row)
    return runs


def _row_model(row: Mapping[str, Any]) -> str | None:
    metadata = row.get('metadata')
    model = metadata.get('model') if isinstance(metadata, Mapping) else None
    return model if isinstance(model, str) and model else None


def run_models(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[str]]:
    """The models each provider answered with in ``rows``, so a model change is visible on the chart."""
    models: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        model = _row_model(row)
        if model is not None:
            models[str(row.get('provider', 'unknown'))].add(model)
    return {provider: sorted(names) for provider, names in sorted(models.items())}


def delta(current: float | None, previous: float | None, digits: int = 2) -> float | None:
    """``current - previous`` rounded, or ``None`` when either side is unknown."""
    if current is None or previous is None:
        return None
    return round(current - previous, digits)



def _mention_change(current: bool, previous: bool) -> str | None:
    """``'gained'`` / ``'lost'`` when the first-party mention flipped between two runs."""
    if current == previous:
        return None
    return 'gained' if current else 'lost'


def _keyword_changes(current: Mapping[str, Any], previous: Mapping[str, Any]) -> dict[str, Any]:
    return {
        'mention': _mention_change(bool(current['first_party_mentioned']), bool(previous['first_party_mentioned'])),
        **{field: delta(current[field], previous[field]) for field in KEYWORD_DELTA_FIELDS},
    }


def _keyword_run(row: Mapping[str, Any]) -> dict[str, Any]:
    return {'timestamp': row['timestamp'], **{field: row[field] for field in KEYWORD_RUN_FIELDS}}


def keyword_history(keyword: str, metrics_by_run: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
    """The drill-down for one keyword: its values per run, oldest first, each with its change since the previous run.

    Every entry of ``metrics_by_run`` was computed from that run's rows, so
    every run has data.
    """
    runs: list[dict[str, Any]] = []
    for timestamp in sorted(metrics_by_run):
        run = _keyword_run(summarize_keyword_visibility(keyword, metrics_by_run[timestamp]))
        run['change'] = (
            {'previous_timestamp': runs[-1]['timestamp'], **_keyword_changes(run, runs[-1])} if runs else None
        )
        runs.append(run)
    return {'keyword': keyword, 'runs': runs}


def _keyword_driver(keyword: str, current: Mapping[str, Any], previous: Mapping[str, Any], keyword_count: int) -> dict[str, Any] | None:
    """How one keyword moved between two group runs, and what that did to the group; ``None`` when it did not move.

    ``impact`` is the keyword's change divided by the keywords with data in
    the later run: its exact share of the group's move when both runs cover
    the same keywords, an estimate when they do not.
    """
    changes = _keyword_changes(current, previous)
    if changes['mention'] is None and all(changes[field] in (None, 0) for field in KEYWORD_DELTA_FIELDS):
        return None
    mention_points = (int(bool(current['first_party_mentioned'])) - int(bool(previous['first_party_mentioned']))) * 100
    sov_points = float(current['first_party_sov']) - float(previous['first_party_sov'])
    return {
        'keyword': keyword,
        'changes': changes,
        'impact': {
            'coverage_rate': round(mention_points / keyword_count, 2),
            'first_party_avg_sov': round(sov_points / keyword_count, 2),
        },
    }


def _by_name(keywords: Iterable[str]) -> list[str]:
    return sorted(keywords, key=lambda keyword: (keyword.lower(), keyword))


def compare_group_runs(previous: Mapping[str, Any], current: Mapping[str, Any]) -> dict[str, Any]:
    """What changed from one group run to the next: KPI deltas and the keywords that drove them."""
    before = previous['keyword_rows']
    after = current['keyword_rows']
    drivers = [
        driver
        for keyword in _by_name(set(before) & set(after))
        if (driver := _keyword_driver(keyword, after[keyword], before[keyword], len(after))) is not None
    ]
    drivers.sort(key=lambda driver: (
        -abs(driver['impact']['coverage_rate']),
        -abs(driver['impact']['first_party_avg_sov']),
        driver['keyword'].lower(),
    ))
    return {
        'previous_timestamp': previous['timestamp'],
        'deltas': {field: delta(current['summary'][field], previous['summary'][field]) for field in GROUP_KPI_FIELDS},
        'drivers': drivers,
        'keywords_entered': _by_name(set(after) - set(before)),
        'keywords_left': _by_name(set(before) - set(after)),
    }


def _group_run(
    timestamp: str,
    keywords: list[str],
    per_keyword: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    total_providers: int,
) -> dict[str, Any]:
    """One run of the group: its KPIs, coverage and models (``keyword_rows`` is internal).

    Only called for a timestamp some keyword has rows at, so ``keywords`` is
    never empty here.
    """
    group = summarize_group_visibility(keywords, per_keyword, total_providers)
    with_data = group['keywords_with_data']
    coverage = round(with_data / len(keywords) * 100, 1)
    return {
        'timestamp': timestamp,
        'keywords_with_data': with_data,
        'keywords_total': len(keywords),
        'coverage': coverage,
        'is_group_run': coverage >= GROUP_RUN_MIN_COVERAGE,
        'summary': group['summary'],
        'models': run_models(rows),
        'keyword_rows': {row['keyword']: row for row in group['keywords'] if row['has_data']},
    }


def build_group_kpi_history(
    keywords: list[str],
    rows_by_keyword: Mapping[str, Iterable[dict[str, Any]]],
    total_providers: int,
) -> dict[str, Any]:
    """Every run of the group in the window, oldest first, plus the per-keyword drill-down.

    Each group run carries ``change``: its deltas and drivers against the
    previous group run. Partial runs carry ``change: None`` and are never the
    base of a comparison.
    """
    metrics: dict[str, dict[str, dict[str, Any]]] = {}
    rows_at: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for keyword in keywords:
        by_run = _rows_by_run(rows_by_keyword.get(keyword, ()))
        metrics[keyword] = {
            timestamp: calculate_keyword_visibility(keyword, rows, total_providers, exact_timestamp=timestamp)
            for timestamp, rows in by_run.items()
        }
        for timestamp, rows in by_run.items():
            rows_at[timestamp].extend(rows)

    runs: list[dict[str, Any]] = []
    group_runs: list[dict[str, Any]] = []
    for timestamp in sorted(rows_at):
        # `{}` is "no data in this run" to the group summary.
        per_keyword = [metrics[keyword].get(timestamp, {}) for keyword in keywords]
        run = _group_run(timestamp, keywords, per_keyword, rows_at[timestamp], total_providers)
        run['change'] = compare_group_runs(group_runs[-1], run) if run['is_group_run'] and group_runs else None
        if run['is_group_run']:
            group_runs.append(run)
        runs.append(run)

    return {
        'runs': [{key: value for key, value in run.items() if key != 'keyword_rows'} for run in runs],
        'keywords': [keyword_history(keyword, metrics[keyword]) for keyword in keywords],
    }


__all__ = [
    'GROUP_KPI_FIELDS',
    'GROUP_RUN_MIN_COVERAGE',
    'KEYWORD_DELTA_FIELDS',
    'KEYWORD_RUN_FIELDS',
    'build_group_kpi_history',
    'compare_group_runs',
    'delta',
    'keyword_history',
    'query_keyword_rows_since',
    'run_models',
]
