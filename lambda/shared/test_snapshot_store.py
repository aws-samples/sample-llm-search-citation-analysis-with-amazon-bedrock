"""Tests for the shared S3 build store (``shared.snapshot_store``)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest

from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline
from shared.scope_params import ReportScope
from shared.snapshot_store import (
    WRITE_WORKERS,
    ParallelWriter,
    PointerCache,
    RebuildRequester,
    RebuildTarget,
    SnapshotBuildIncomplete,
    SnapshotStore,
    build_time,
    kept_build_ids,
    keyword_fingerprint,
    named_scope_key,
    new_build_id,
    scope_keywords,
)
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, RecordingLambda, SnapshotBucket

_NOW = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)


@pytest.fixture
def bucket() -> SnapshotBucket:
    return SnapshotBucket()


@pytest.fixture
def store(bucket: SnapshotBucket) -> SnapshotStore:
    return SnapshotStore(bucket, SNAPSHOT_BUCKET, 'scope-snapshots/', 'scope snapshot')


def _scope(kind: str, *, group_ids: list[str] | None = None, market_id: str | None = None) -> ReportScope:
    descriptor = {'mode': 'groups', 'group_ids': group_ids} if group_ids is not None else {'mode': kind}
    return ReportScope(kind=kind, keywords=('a',), scope=descriptor, label='x', market_id=market_id)


class TestScopeNaming:
    def test_all_scope_without_a_market_is_all(self) -> None:
        assert named_scope_key(_scope('all')) == 'all'

    def test_all_scope_of_a_market_is_that_market(self) -> None:
        assert named_scope_key(_scope('all', market_id='es-es')) == 'market:es-es'

    def test_one_group_of_a_market_is_the_group_market_pair(self) -> None:
        assert named_scope_key(_scope('group', group_ids=['g1'], market_id='es-es')) == 'group:g1|market:es-es'

    def test_two_groups_have_no_named_scope(self) -> None:
        assert named_scope_key(_scope('group', group_ids=['g1', 'g2'])) is None

    def test_keyword_ids_have_no_named_scope(self) -> None:
        assert named_scope_key(_scope('keywords')) is None

    def test_fingerprint_ignores_order_and_duplicates(self) -> None:
        assert keyword_fingerprint(['b', 'a', 'a']) == keyword_fingerprint(['a', 'b'])

    def test_scope_keywords_list_every_market_group_and_pair(self) -> None:
        active = [{'keyword': 'a', 'group_ids': {'g'}, 'market_id': 'es-es'}, {'keyword': 'b'}]
        assert scope_keywords(active) == {
            'all': {'a', 'b'}, 'market:es-es': {'a'}, 'market:global': {'b'}, 'group:g': {'a'}, 'group:g|market:es-es': {'a'},
        }


class TestBuildIds:
    def test_build_id_carries_its_start_time(self) -> None:
        assert build_time(new_build_id(_NOW)) == _NOW

    def test_a_name_that_is_not_a_build_has_no_time(self) -> None:
        assert build_time('series') is None

    def test_kept_builds_are_the_current_and_the_previous(self) -> None:
        assert kept_build_ids({'build_id': 'b2', 'previous_build_id': 'b1'}) == {'b1', 'b2'}

    def test_no_pointer_keeps_no_build(self) -> None:
        assert kept_build_ids(None) == set()


class TestPublish:
    def test_publish_writes_the_pointer_with_the_previous_build(self, store: SnapshotStore) -> None:
        store.publish({'build_id': 'b2', 'built_at': '2026-10-05T07:00:00Z'}, {'build_id': 'b1'})
        assert store.read_current() == {'build_id': 'b2', 'built_at': '2026-10-05T07:00:00Z', 'previous_build_id': 'b1'}

    def test_publish_keeps_a_newer_build(self, store: SnapshotStore) -> None:
        store.publish({'build_id': 'new', 'built_at': '2026-10-05T08:00:00Z'}, None)
        assert store.publish({'build_id': 'old', 'built_at': '2026-10-05T07:00:00Z'}, None) is False

    def test_publish_raises_when_the_budget_is_spent(self, store: SnapshotStore) -> None:
        activate_deadline(Deadline(0, lambda: 1.0))
        try:
            with pytest.raises(SnapshotBuildIncomplete, match='before publishing'):
                store.publish({'build_id': 'b', 'built_at': 'z'}, None)
        finally:
            clear_request_deadline()


class TestGarbageCollection:
    def test_deletes_old_builds_that_are_not_kept(self, store: SnapshotStore, bucket: SnapshotBucket) -> None:
        old = new_build_id(_NOW - timedelta(hours=2))
        kept = new_build_id(_NOW - timedelta(hours=3))
        for build in (old, kept):
            bucket.put_json(f'scope-snapshots/{build}/x/a.json.gz', {})
        bucket.put_json('scope-snapshots/series/x/s.json.gz', {})
        assert store.delete_old_builds({kept}, _NOW) == [old]

    def test_keeps_a_young_build_that_is_not_kept(self, store: SnapshotStore, bucket: SnapshotBucket) -> None:
        young = new_build_id(_NOW - timedelta(minutes=5))
        bucket.put_json(f'scope-snapshots/{young}/x/a.json.gz', {})
        store.delete_old_builds(set(), _NOW)
        assert bucket.keys_under(f'scope-snapshots/{young}/') == [f'scope-snapshots/{young}/x/a.json.gz']


class TestWriter:
    def test_writes_every_file(self, store: SnapshotStore, bucket: SnapshotBucket) -> None:
        writer = ParallelWriter(store)
        writer.put([('p/a.json.gz', {'a': 1}), ('p/b.json.gz', [2])])
        writer.finish()
        assert (bucket.json_at('p/a.json.gz'), bucket.json_at('p/b.json.gz')) == ({'a': 1}, [2])

    def test_stops_at_the_deadline(self, store: SnapshotStore) -> None:
        activate_deadline(Deadline(0, lambda: 1.0))
        try:
            writer = ParallelWriter(store)
            writer.put([('p/a.json.gz', {})])
            with pytest.raises(SnapshotBuildIncomplete, match='before writing p'):
                writer.finish()
        finally:
            clear_request_deadline()

    def test_never_queues_more_than_twice_its_workers(self, store: SnapshotStore, bucket: SnapshotBucket) -> None:
        put = bucket.put_object

        def slow_put(**params: Any) -> dict[str, Any]:
            time.sleep(0.002)
            return put(**params)

        writer = ParallelWriter(store)
        with patch.object(bucket, 'put_object', side_effect=slow_put):
            writer.put((f'p/{index}.json.gz', {'i': index}) for index in range(400))
            writer.finish()
        assert (writer.most_pending, len(bucket.keys_under('p/'))) == (2 * WRITE_WORKERS, 400)


class TestPointerCache:
    def test_rereads_the_pointer_only_after_the_ttl(self, store: SnapshotStore, bucket: SnapshotBucket) -> None:
        now = [0.0]
        cache = PointerCache(store, lambda: now[0])
        cache.current()
        now[0] = 10.0
        cache.current()
        now[0] = 31.0
        cache.current()
        assert bucket.gets == ['scope-snapshots/current.json', 'scope-snapshots/current.json']


class TestRebuildRequester:
    def test_first_request_invokes_the_builder_with_its_action(self, store: SnapshotStore) -> None:
        client = RecordingLambda()
        RebuildRequester(store, RebuildTarget(client, 'summary', 'build_scope_snapshots')).request('stale all')
        assert client.invocations == [{'action': 'build_scope_snapshots', 'reason': 'stale all'}]

    def test_requests_within_the_debounce_start_one_build(self, store: SnapshotStore) -> None:
        client = RecordingLambda()
        requester = RebuildRequester(store, RebuildTarget(client, 'summary', 'build_scope_snapshots'))
        assert [requester.request('stale') for _ in range(3)] == [True, False, False]

    def test_another_containers_marker_debounces_the_request(self, store: SnapshotStore) -> None:
        first = RebuildRequester(store, RebuildTarget(RecordingLambda(), 'summary', 'a'), wall_clock=lambda: 1_000.0)
        first.request('stale')
        second = RebuildRequester(store, RebuildTarget(RecordingLambda(), 'summary', 'a'), wall_clock=lambda: 1_100.0)
        assert second.request('stale') is False

    def test_without_a_function_nothing_is_requested(self, store: SnapshotStore) -> None:
        assert RebuildRequester(store, RebuildTarget(None, None, 'a')).request('stale') is False
