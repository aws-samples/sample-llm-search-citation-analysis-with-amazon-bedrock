"""End to end (design 2.45.0 §1 row 17): GenerateInsights reads a large group's facts from its fresh snapshot, equal to reading every keyword live.

A generated tenant whose keywords all belong to the global market (so the
16-keyword group is one GroupRun) is written through the Deduplication writer
and built; the step then takes the group's facts, KPIs and stability from
the snapshot instead of capping the group at 100 keywords, and they equal
the facts the step computes when it reads every keyword's answers itself.
"""

from __future__ import annotations

import os

import pytest

from testing.end_to_end_tenant import EndToEndTenant, built_tenant
from testing.scale_data import ScaleSpec, group_id, group_members, keyword_text

SPEC = ScaleSpec(markets=0)
_HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


@pytest.fixture(scope='module')
def facts(tenant):
    """The large group's facts from the snapshot and read live, for the newest run."""
    step = tenant.handler('handler.py', _HERE)
    run = step.GroupRun(group_id(0), sorted(keyword_text(index) for index in group_members(SPEC, 0)), tenant.run_timestamp(SPEC.runs - 1))
    config = dict(tenant.brand_config)
    with tenant.active():
        snapshot = step._snapshot_facts(run, config)
        live = step._live_facts(run, config)
    return snapshot, live


def test_the_large_group_is_read_from_its_snapshot(facts):
    snapshot, _live = facts
    assert snapshot is not None


def test_the_snapshot_insights_equal_reading_every_keyword(facts):
    snapshot, live = facts
    assert snapshot.computed['insights'] == live.computed['insights']


def test_the_snapshot_kpis_equal_reading_every_keyword(facts):
    snapshot, live = facts
    assert snapshot.kpis == live.kpis


def test_the_snapshot_facts_are_of_the_runs_timestamp(facts):
    snapshot, live = facts
    assert snapshot.timestamp == live.timestamp
