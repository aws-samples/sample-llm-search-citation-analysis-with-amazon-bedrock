"""Tests for shared.backlink_snapshots: tracked domains, snapshot items, history reads and the schedule setting."""

from __future__ import annotations

from decimal import Decimal

from shared.backlink_snapshots import (
    TrackedDomain,
    domain_history,
    latest_snapshot_at,
    schedule_enabled,
    set_schedule,
    snapshot_item,
    tracked_domains,
)
from testing.backlinks_fixtures import SUMMARY_ROW, FakeSnapshotsTable


def test_lists_owned_domains_first_then_competitors_by_name():
    config = {
        'first_party_domains': ['https://www.Example.com/', 'shop.example.com'],
        'competitor_domains': {'Zeta': ['zeta.example.net'], 'Acme': ['acme.example.org']},
    }

    assert tracked_domains(config) == [
        TrackedDomain('example.com', 'owned', None), TrackedDomain('shop.example.com', 'owned', None),
        TrackedDomain('acme.example.org', 'competitor', 'Acme'), TrackedDomain('zeta.example.net', 'competitor', 'Zeta'),
    ]


def test_keeps_a_domain_once_with_the_owned_role_winning():
    config = {'first_party_domains': ['example.com'], 'competitor_domains': {'Acme': ['example.com']}}

    assert tracked_domains(config) == [TrackedDomain('example.com', 'owned', None)]


def test_skips_domains_the_backlinks_api_would_refuse():
    config = {'first_party_domains': ['my_site.com', 'localhost', 42], 'competitor_domains': {'Acme': 'acme.example.org'}}

    assert tracked_domains(config) == []


def test_tracks_nothing_before_a_brand_config_is_saved():
    assert tracked_domains({}) == []


def test_stores_the_metrics_without_an_expiry_and_leaves_out_unknown_ones():
    item = snapshot_item('example.com', {**SUMMARY_ROW, 'target_spam_score': None, 'rank': 41.5}, '2026-10-05T06:00:00Z')

    assert ('ttl' in item, item['rank'], 'target_spam_score' in item) == (False, Decimal('41.5'), False)


def test_reads_the_latest_snapshots_oldest_first_with_whole_numbers_as_ints():
    table = FakeSnapshotsTable()
    for stamp, rank in (('2026-09-28T06:00:00Z', 40), ('2026-10-05T06:00:00Z', 41), ('2026-09-21T06:00:00Z', 39)):
        table.put_item(snapshot_item('example.com', {'rank': rank, 'backlinks': 100}, stamp))

    history = domain_history(table, 'example.com', limit=2)

    assert [(point['snapshot_at'], point['rank'], point['lost_backlinks']) for point in history] == [
        ('2026-09-28T06:00:00Z', 40, None), ('2026-10-05T06:00:00Z', 41, None),
    ]


def test_finds_the_time_of_the_latest_snapshot():
    table = FakeSnapshotsTable()
    table.put_item(snapshot_item('example.com', {'rank': 1}, '2026-09-28T06:00:00Z'))
    table.put_item(snapshot_item('example.com', {'rank': 2}, '2026-10-05T06:00:00Z'))

    assert latest_snapshot_at(table, 'example.com') == '2026-10-05T06:00:00Z'


def test_reads_no_latest_snapshot_for_a_new_domain():
    assert latest_snapshot_at(FakeSnapshotsTable(), 'example.com') is None


def test_keeps_the_weekly_schedule_off_until_an_admin_turns_it_on():
    table = FakeSnapshotsTable()
    before = schedule_enabled(table)
    set_schedule(table, enabled=True, updated_by='admin@example.com', updated_at='2026-10-05T06:00:00Z')

    assert (before, schedule_enabled(table)) == (False, True)
