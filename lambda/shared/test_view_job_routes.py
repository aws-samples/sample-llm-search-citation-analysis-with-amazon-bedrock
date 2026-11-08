"""Tests for the window view jobs' history reads (``shared.view_job_routes.window_tallies``)."""

from __future__ import annotations

from dataclasses import dataclass, field

from shared.kpi_tally import RunTally
from shared.scope_params import ReportScope
from shared.view_job_routes import window_tallies
from shared.view_jobs import JobContext, JobRequest
from testing.scale_data import ScaleSpec, keyword_text, run_timestamp
from testing.scope_snapshot_fixtures import full_tally

_SPEC = ScaleSpec(keywords=2, groups=1, largest_group=2, markets=0, personas=1, engines=('openai',), runs=60, long_tail=10)
_SCOPE = ReportScope(kind='group', keywords=(keyword_text(0), keyword_text(1)), scope={'mode': 'group', 'group_id': 'coruna'}, label='Coruña')
#: Day 59 of the generated runs at noon: a 30-day window starts at run 29's day.
_BUILT_AT = '2025-12-04T12:00:00+00:00'


@dataclass
class _WindowHistory:
    """A ``HistoryReader`` that records the ``since`` of each read and returns the generated runs from then on."""

    sinces: list[str] = field(default_factory=list)

    def __call__(self, keyword: str, since: str) -> list[RunTally]:
        self.sinces.append(since)
        index = int(keyword.rsplit(' ', 1)[-1])
        return [full_tally(_SPEC, index, run) for run in range(_SPEC.runs) if run_timestamp(run) >= since]


def test_a_30_day_job_asks_the_history_for_the_window_only():
    history = _WindowHistory()
    since, _ = window_tallies(JobRequest('trends', {'days': 30}, _SCOPE), JobContext(None, 'bucket', 'job', _BUILT_AT), history)
    assert (history.sinces, since[:10]) == ([since, since], '2025-11-04')


def test_a_30_day_job_keeps_each_keywords_runs_of_the_window():
    _, tallies = window_tallies(JobRequest('trends', {'days': 30}, _SCOPE), JobContext(None, 'bucket', 'job', _BUILT_AT), _WindowHistory())
    assert {keyword: len(runs) for keyword, runs in tallies.items()} == dict.fromkeys(_SCOPE.keywords, 30)
