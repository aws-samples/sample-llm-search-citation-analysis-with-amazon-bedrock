"""The worker's like-for-like comparison: the previous run's rows, the stored comparison state, and its alerts."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS, KPI_VERSION
from shared.request_deadline import Deadline
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.handler_fixtures import handler_fixture
from testing.kpi_alert_worker_fixtures import KPI_ALERT_WORKER_ENV, complete_run_event, hotel_row

_RUN = '2026-10-01T10:00:00Z'
_PREVIOUS = '2026-09-24T10:00:00Z'
_HOTEL = ('Hotel Mine', 'first_party', 1)

worker_module = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'handler.py', 'kpi_alert_worker_comparison', env=KPI_ALERT_WORKER_ENV,
)


class WorkerRun:
    """One worker run over one complete group, with the previous run's rows and snapshot given."""

    def __init__(self, module, current: list[dict], previous_rows: list[dict] | None, previous_snapshot: dict | None) -> None:
        self.snapshots = MagicMock()
        self.alerts = MagicMock()
        rows_by_run = {_RUN: current, _PREVIOUS: previous_rows}
        self.load_rows = MagicMock(side_effect=lambda keywords, timestamp, *_: dict.fromkeys(keywords, rows_by_run.get(timestamp)))
        with patch.multiple(
            module,
            query_active_keywords=MagicMock(return_value=[{'id': 'k1', 'keyword': 'hotel spa', 'group_ids': {'group-1'}}]),
            _load_groups=MagicMock(return_value=[{'id': 'group-1', 'name': 'Group One'}]),
            _settings=MagicMock(return_value={**DEFAULT_ALERT_SETTINGS, 'notification_emails': []}),
            get_brand_config=MagicMock(return_value={}),
            _load_run_rows=self.load_rows,
            _previous_snapshot=MagicMock(return_value=previous_snapshot),
            _content_change=MagicMock(return_value=None),
            _notify=MagicMock(return_value={'status': 'not_sent'}),
            dynamodb=fake_dynamodb_resource(by_name={'snapshots': self.snapshots, 'alerts': self.alerts}),
        ):
            self.result = module.handler(complete_run_event(_RUN, ['hotel spa']), None)

    @property
    def comparison(self) -> dict:
        return self.snapshots.put_item.call_args.kwargs['Item']['comparison']


_PREVIOUS_SNAPSHOT = {'group_id': 'group-1', 'snapshot_at': _PREVIOUS, 'kpi_version': KPI_VERSION}
#: One answer naming the hotel first, in the previous run and in the evaluated one.
_PREVIOUS_MENTION = [hotel_row(_PREVIOUS, 'openai', _HOTEL)]
_CURRENT_MENTION = [hotel_row(_RUN, 'openai', _HOTEL)]


class TestStoredComparison:
    def test_records_no_previous_for_the_first_snapshot(self, worker_module):
        run = WorkerRun(worker_module, _CURRENT_MENTION, None, None)

        assert (run.comparison['state'], run.comparison['previous_snapshot_at']) == ('no_previous', None)

    def test_records_no_previous_when_the_previous_snapshot_has_other_definitions(self, worker_module):
        stale = {**_PREVIOUS_SNAPSHOT, 'kpi_version': KPI_VERSION - 1}
        run = WorkerRun(worker_module, _CURRENT_MENTION, _PREVIOUS_MENTION, stale)

        assert run.comparison['state'] == 'no_previous'

    def test_reads_the_previous_runs_rows_at_its_snapshot_time_within_the_time_budget(self, worker_module):
        run = WorkerRun(worker_module, _CURRENT_MENTION, _PREVIOUS_MENTION, _PREVIOUS_SNAPSHOT)

        keywords, timestamp, deadline = run.load_rows.call_args_list[-1].args
        assert (keywords, timestamp, deadline is not None) == (['hotel spa'], _PREVIOUS, True)

    def test_records_a_comparable_comparison_with_its_matched_cells(self, worker_module):
        run = WorkerRun(worker_module, _CURRENT_MENTION, _PREVIOUS_MENTION, _PREVIOUS_SNAPSHOT)

        assert (run.comparison['state'], run.comparison['matched_cells']) == ('comparable', 1)

    def test_records_scope_changed_when_the_engines_changed(self, worker_module):
        run = WorkerRun(worker_module, [hotel_row(_RUN, 'claude', _HOTEL)], _PREVIOUS_MENTION, _PREVIOUS_SNAPSHOT)

        assert run.comparison['state'] == 'scope_changed'


class TestAlertsOnMatchedCells:
    def test_raises_the_drop_of_a_matched_cell(self, worker_module):
        run = WorkerRun(worker_module, [hotel_row(_RUN, 'openai')], _PREVIOUS_MENTION, _PREVIOUS_SNAPSHOT)

        assert [call.kwargs['Item']['type'] for call in run.alerts.put_item.call_args_list] == [
            'mention_rate_drop', 'keyword_lost_mention',
        ]

    def test_raises_nothing_when_a_new_engine_is_all_that_changed(self, worker_module):
        current = [*_CURRENT_MENTION, hotel_row(_RUN, 'claude')]
        run = WorkerRun(worker_module, current, _PREVIOUS_MENTION, _PREVIOUS_SNAPSHOT)

        assert run.result['alerts_created'] == 0


class TestPreviousRunWithinTheBudget:
    GROUP_KEYWORDS = ['hotel spa', 'hotel pool']

    def group(self, worker_module):
        return worker_module._GroupRun(
            pair=None, name='Group One', keywords=self.GROUP_KEYWORDS, rows=[], tracked_competitors=[],
        )

    @pytest.mark.parametrize(('seconds_left', 'expected'), [
        (0, None),  # the deadline ran out before every keyword was read: no comparison with part of the past
        (60, None),  # a read that failed with time left: no comparison with part of the past either
    ])
    def test_reads_the_previous_run_like_for_like(self, worker_module, seconds_left, expected):
        partly = MagicMock(return_value={'hotel spa': _PREVIOUS_MENTION, 'hotel pool': None})
        with patch.object(worker_module, '_load_run_rows', partly):
            rows = worker_module._previous_run_rows(self.group(worker_module), _PREVIOUS_SNAPSHOT, Deadline(seconds_left))

        assert rows == expected

    def test_compares_with_every_keyword_of_the_previous_run_when_all_were_read(self, worker_module):
        whole = MagicMock(return_value={'hotel spa': _PREVIOUS_MENTION, 'hotel pool': []})
        with patch.object(worker_module, '_load_run_rows', whole):
            rows = worker_module._previous_run_rows(self.group(worker_module), _PREVIOUS_SNAPSHOT, Deadline(60))

        assert rows == _PREVIOUS_MENTION
