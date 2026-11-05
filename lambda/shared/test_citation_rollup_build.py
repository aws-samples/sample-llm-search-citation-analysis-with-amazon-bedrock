"""Tests for building the citation rollup (``shared.citation_rollup_build``) into an in-memory bucket."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from shared.citation_pages import aggregate_citations
from shared.citation_rollup import (
    CHUNK_SIZE,
    CURRENT_KEY,
    chunk_key,
    decode_json,
    encode_json,
    keyword_fingerprint,
    manifest_key,
)
from shared.citation_rollup_build import RollupBuildIncomplete, build_rollup, delete_old_builds
from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline
from testing.citation_rollup_fixtures import (
    ROLLUP_BUCKET,
    ROLLUP_TEST_ROWS,
    FakeS3,
    TickingClock,
    rollup_keywords,
    rollup_sources,
)

_ROWS = ROLLUP_TEST_ROWS
_ACTIVE = rollup_keywords(
    20,
    groups={index: {'coast'} for index in range(10)} | {index: {'coast', 'spa'} for index in range(10, 15)},
    markets=dict.fromkeys(range(0, 20, 2), 'es-es'),
)
_NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _no_leftover_deadline() -> Iterator[None]:
    yield
    clear_request_deadline()


@pytest.fixture(scope='module')
def built() -> tuple[FakeS3, dict]:
    """One build shared by the read-only tests below."""
    s3 = FakeS3()
    build_rollup(rollup_sources(_ROWS, _ACTIVE, s3, {'updated_at': '2026-11-01T00:00:00Z'}), now=lambda: _NOW)
    return s3, json.loads(s3.objects[CURRENT_KEY])


def _manifest(s3: FakeS3, current: dict, key: str) -> dict:
    return decode_json(s3.objects[manifest_key(current['scopes'][key]['path'])])


def _texts(indices) -> set[str]:
    return {f'keyword {index:03d}' for index in indices}


def test_publishes_every_scope_that_has_keywords(built):
    _, current = built

    assert sorted(current['scopes']) == [
        'all', 'group:coast', 'group:coast|market:es-es', 'group:coast|market:global',
        'group:spa', 'group:spa|market:es-es', 'group:spa|market:global',
        'market:es-es', 'market:global', 'table',
    ]


def test_records_the_brand_config_it_was_built_with(built):
    assert built[1]['brand_config_updated_at'] == '2026-11-01T00:00:00Z'


def test_table_scope_totals_equal_the_aggregate_of_every_row(built):
    s3, current = built

    assert _manifest(s3, current, 'table')['totals'] == aggregate_citations(_ROWS, []).totals()


def test_all_scope_covers_only_active_keywords(built):
    s3, current = built
    active_rows = [row for row in _ROWS if row['keyword'] in _texts(range(20))]

    assert _manifest(s3, current, 'all')['totals'] == aggregate_citations(active_rows, []).totals()


def test_group_market_scope_covers_the_groups_keywords_of_that_market_only(built):
    s3, current = built
    wanted = _texts(index for index in range(10, 15) if index % 2 == 0)

    expected = aggregate_citations([row for row in _ROWS if row['keyword'] in wanted], []).totals()
    assert _manifest(s3, current, 'group:spa|market:es-es')['totals'] == expected


def test_fingerprints_each_scope_by_its_keyword_texts(built):
    _, current = built

    assert current['scopes']['group:spa']['fingerprint'] == keyword_fingerprint(_texts(range(10, 15)))


def test_chunks_hold_the_base_order_of_the_scope(built):
    s3, current = built
    path = current['scopes']['table']['path']

    chunks = [decode_json(s3.objects[chunk_key(path, 'all', index)]) for index in range(3)]
    assert [entry for chunk in chunks for entry in chunk] == aggregate_citations(_ROWS, []).top_urls


def test_writes_full_chunks_of_chunk_size_entries(built):
    s3, current = built

    assert len(decode_json(s3.objects[chunk_key(current['scopes']['table']['path'], 'all', 0)])) == CHUNK_SIZE


def test_does_not_switch_current_when_the_deadline_expires_mid_build():
    s3 = FakeS3()
    activate_deadline(Deadline(0, lambda: 1.0))

    with pytest.raises(RollupBuildIncomplete, match='Citations scan stopped'):
        build_rollup(rollup_sources(_ROWS, _ACTIVE, s3), now=lambda: _NOW)
    assert CURRENT_KEY not in s3.objects


def test_does_not_switch_current_when_the_deadline_expires_after_the_read():
    s3 = FakeS3()
    clock = TickingClock(step=0.0)
    activate_deadline(Deadline(10, clock))
    sources = rollup_sources(_ROWS, _ACTIVE, s3)
    sources.citations_table.max_page_rows = len(_ROWS)
    sources.citations_table.on_scan = lambda: setattr(clock, 'now', 60.0)

    with pytest.raises(RollupBuildIncomplete, match='after 0 of 10 scopes'):
        build_rollup(sources, now=lambda: _NOW)
    assert CURRENT_KEY not in s3.objects


def test_does_not_replace_a_newer_published_build():
    s3 = FakeS3()
    s3.objects[CURRENT_KEY] = json.dumps({'build_id': '20261105T110000Z-newer', 'built_at': '2026-11-05T11:00:00Z'}).encode()

    summary = build_rollup(rollup_sources(_ROWS, _ACTIVE, s3), now=lambda: _NOW)

    assert (summary['status'], json.loads(s3.objects[CURRENT_KEY])['build_id']) == ('superseded', '20261105T110000Z-newer')


def test_remembers_the_build_it_replaced():
    s3 = FakeS3()
    first = build_rollup(rollup_sources(_ROWS, _ACTIVE, s3), now=lambda: _NOW)

    build_rollup(rollup_sources(_ROWS, _ACTIVE, s3), now=lambda: _NOW + timedelta(minutes=1))

    assert json.loads(s3.objects[CURRENT_KEY])['previous_build_id'] == first['build_id']


class TestDeleteOldBuilds:
    @pytest.fixture
    def bucket(self) -> FakeS3:
        s3 = FakeS3()
        for build_id in ('20261105T080000Z-old', '20261105T090000Z-previous', '20261105T095000Z-young', '20261105T100000Z-new'):
            s3.objects[f'citation-rollups/{build_id}/scope/manifest.json.gz'] = encode_json({})
        s3.objects[CURRENT_KEY] = b'{}'
        return s3

    def test_deletes_only_old_builds_that_are_neither_new_nor_previous(self, bucket):
        deleted = delete_old_builds(bucket, ROLLUP_BUCKET, {'20261105T100000Z-new', '20261105T090000Z-previous'}, _NOW)

        assert deleted == ['20261105T080000Z-old']

    def test_keeps_a_build_younger_than_the_stale_age_in_case_it_is_still_being_written(self, bucket):
        delete_old_builds(bucket, ROLLUP_BUCKET, set(), _NOW)

        assert sorted(key.split('/')[1] for key in bucket.objects if key != CURRENT_KEY) == [
            '20261105T095000Z-young', '20261105T100000Z-new',
        ]
