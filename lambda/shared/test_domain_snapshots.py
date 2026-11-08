"""Estimated traffic snapshots (``shared.domain_snapshots``): what is stored, where, and when nothing is."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from shared import domain_snapshots
from shared.dataforseo_domain import Page
from shared.domain_snapshots import (
    distinct_domains,
    keyword_traffic,
    latest_snapshot,
    load_snapshot_keywords,
    schedule_enabled,
    set_schedule,
    summary_json,
    take_snapshot,
)
from testing.assertions import present
from testing.seo_domain_fixtures import (
    OLDER_SNAPSHOT_AT,
    SNAPSHOT_AT,
    FakeS3,
    FakeSnapshots,
    overview,
    ranked_keyword,
    stored_snapshot,
)
from testing.seo_fixtures import GLOBAL_CODES

NOW = datetime(2026, 10, 5, 4, 0, tzinfo=UTC)
KEY = f'seo/domain-snapshots/example.com/global/{SNAPSHOT_AT}.json'


ONE_ROW = (ranked_keyword(),)


def run_snapshot(table, s3, *, found=True, rows=ONE_ROW):
    page = Page(items=tuple(rows), total_count=len(rows), has_more=False, cost_usd=0.132)
    with patch.multiple(
        domain_snapshots, domain_overview=lambda *_args, **_kwargs: overview(count=1520 if found else None),
        ranked_keywords=lambda *_args, **_kwargs: page,
    ):
        return take_snapshot('example.com', 'global', GLOBAL_CODES, table=table, s3=s3, bucket='raw', now=NOW)


class TestTakeSnapshot:
    def test_stores_the_ranked_keywords_in_s3_under_the_domain_market_and_time(self):
        s3 = FakeS3()

        run_snapshot(FakeSnapshots(), s3)

        assert s3.payload(KEY)['keywords'] == [
            {'keyword': 'cheap flights', 'position': 3, 'etv': 120.5, 'url': 'https://example.com/flights', 'search_volume': 2400},
        ]

    def test_labels_the_stored_keywords_as_estimates(self):
        s3 = FakeS3()

        run_snapshot(FakeSnapshots(), s3)

        assert (s3.payload(KEY)['estimated'], s3.payload(KEY)['source']) == (True, 'dataforseo_labs')

    def test_writes_the_summary_item_with_its_pointer_and_no_expiry(self):
        table = FakeSnapshots()

        run_snapshot(table, FakeS3())

        item = table.items[0]
        assert (item['pk'], item['keywords_s3_key'], 'ttl' in item) == ('example.com#global', KEY, False)

    def test_keeps_the_previous_snapshot_when_the_answer_is_empty(self):
        table = FakeSnapshots([stored_snapshot(snapshot_at=OLDER_SNAPSHOT_AT)])

        result = run_snapshot(table, FakeS3(), found=False, rows=())

        assert (result['status'], len(table.items)) == ('kept_previous', 1)

    def test_stores_an_empty_first_snapshot(self):
        table = FakeSnapshots()

        assert run_snapshot(table, FakeS3(), found=False, rows=()) == {'status': 'stored', 'keywords': 0}

    def test_drops_a_position_beyond_100(self):
        s3 = FakeS3()

        run_snapshot(FakeSnapshots(), s3, rows=(ranked_keyword(position=101),))

        assert s3.payload(KEY)['keywords'][0]['position'] is None


class TestReads:
    def test_latest_snapshot_is_the_newest_of_the_pair(self):
        table = FakeSnapshots([stored_snapshot(snapshot_at=OLDER_SNAPSHOT_AT), stored_snapshot(), stored_snapshot('acme.example.org')])

        assert present(latest_snapshot(table, 'example.com', 'global'))['snapshot_at'] == SNAPSHOT_AT

    def test_loading_a_missing_object_yields_no_keywords(self):
        assert load_snapshot_keywords(FakeS3(), 'raw', stored_snapshot()) == []

    def test_summary_converts_the_stored_numbers(self):
        summary = summary_json(stored_snapshot())

        assert (summary['estimated_traffic'], summary['traffic_cost'], summary['position_buckets'][0]) == (
            8451, 12034.57, {'label': '1', 'keywords': 10},
        )

    def test_keyword_traffic_keys_on_the_normalized_keyword(self):
        assert keyword_traffic([{'keyword': ' Cheap Flights ', 'position': 2, 'etv': 9.5}]) == {'cheap flights': (2, 9.5)}


@pytest.mark.parametrize(('domains', 'expected'), [
    (['shop.example.com', 'example.com', 'example.com'], ['example.com']),
    (['example.com', 'example.org'], ['example.com', 'example.org']),
    (['notexample.com', 'example.com'], ['example.com', 'notexample.com']),
])
def test_distinct_domains_drops_domains_another_entry_covers(domains, expected):
    assert distinct_domains(domains) == expected


class TestScheduleSetting:
    def test_is_off_until_an_admin_turns_it_on(self):
        table = MagicMock()
        table.get_item.return_value = {}

        assert schedule_enabled(table) is False
        table.get_item.assert_called_once_with(Key={'pk': '#settings', 'snapshot_at': 'schedule'})

    def test_records_who_turned_it_on_and_when(self):
        table = MagicMock()
        set_schedule(table, enabled=True, updated_by='admin-sub', updated_at='2026-11-08T00:00:00Z')

        assert table.put_item.call_args.kwargs['Item'] == {
            'pk': '#settings', 'snapshot_at': 'schedule', 'enabled': True,
            'updated_by': 'admin-sub', 'updated_at': '2026-11-08T00:00:00Z',
        }
        table.get_item.return_value = {'Item': table.put_item.call_args.kwargs['Item']}
        assert schedule_enabled(table) is True
