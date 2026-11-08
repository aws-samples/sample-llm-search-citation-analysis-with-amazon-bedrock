"""Tests for the ``backlinks.snapshot_all`` job step."""

from __future__ import annotations

from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from shared.backlink_snapshots import snapshot_item
from shared.dataforseo_client import DataForSeoError
from shared.utils import get_timestamp
from testing.backlinks_fixtures import SUMMARY_ROW, FakeSnapshotsTable
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import BRAND_CONFIG, SEO_ENV

JOBS_DIR = str(Path(__file__).resolve().parent)
jobs_backlinks = handler_fixture(JOBS_DIR, 'jobs_backlinks.py', 'jobs_backlinks_under_test', env=SEO_ENV)


class Run:
    """The step with its snapshot table, brand config and DataForSEO summary stubbed."""

    def __init__(self, module: ModuleType, config=BRAND_CONFIG, summaries=None) -> None:
        self.table = FakeSnapshotsTable()
        self.summary = MagicMock(side_effect=summaries or (lambda _target: (dict(SUMMARY_ROW), 0.024)))
        self.config = dict(config)
        self.module = module

    def step(self, event=None):
        with patch.multiple(
            self.module, snapshots_table=MagicMock(return_value=self.table),
            brand_config=MagicMock(return_value=self.config), fetch_summary=self.summary,
        ):
            return self.module.STEPS['backlinks.snapshot_all']({'step': 'backlinks.snapshot_all', **(event or {})})


@pytest.fixture
def run(jobs_backlinks) -> Run:
    return Run(jobs_backlinks)


def test_stores_one_snapshot_per_owned_and_competitor_domain(run):
    result = run.step()

    assert (result['stored'], sorted(item['domain'] for item in run.table.items)) == (2, ['acme.example.org', 'example.com'])


def test_snapshots_each_domain_with_its_subdomains(run):
    run.step()

    assert [(call.args[0].api_target, call.args[0].include_subdomains) for call in run.summary.call_args_list] == [
        ('example.com', True), ('acme.example.org', True),
    ]


def test_skips_a_domain_snapshotted_less_than_20_hours_ago(run):
    run.table.put_item(snapshot_item('example.com', SUMMARY_ROW, get_timestamp()))

    result = run.step()

    assert (result['recent'], result['stored'], run.summary.call_count) == (1, 1, 1)


def test_snapshots_again_a_domain_whose_last_snapshot_is_a_week_old(run):
    run.table.put_item(snapshot_item('example.com', SUMMARY_ROW, '2020-01-01T00:00:00Z'))

    assert run.step()['stored'] == 2


def test_never_stores_an_empty_summary(jobs_backlinks):
    active = Run(jobs_backlinks, summaries=lambda _target: (None, 0.024))
    result = active.step()

    assert (result['empty'], active.table.items) == (2, [])


def test_goes_on_with_the_next_domain_after_one_fails_without_retrying_it(jobs_backlinks):
    answers = [DataForSeoError('UPSTREAM_UNAVAILABLE', 'down'), (dict(SUMMARY_ROW), 0.024)]
    active = Run(jobs_backlinks, summaries=answers)
    result = active.step()

    assert (result['failed'], result['stored'], active.summary.call_count) == (1, 1, 2)


def test_stops_the_run_on_a_balance_failure(jobs_backlinks):
    active = Run(jobs_backlinks, summaries=[DataForSeoError('BILLING_ISSUE', 'low')])
    result = active.step()

    assert (result['stopped'], result['deferred'], active.summary.call_count) == ('BILLING_ISSUE', 1, 1)


def test_defers_the_remaining_domains_once_the_time_budget_is_spent(run):
    clock = iter([0.0, 0.0, 10_000.0])
    with patch.object(run.module, '_monotonic', lambda: next(clock)):
        result = run.step()

    assert (result['stored'], result['deferred']) == (1, 1)


def test_answers_counts_only(run):
    assert set(run.step()) == {'domains', 'stored', 'recent', 'empty', 'failed', 'deferred', 'stopped'}
