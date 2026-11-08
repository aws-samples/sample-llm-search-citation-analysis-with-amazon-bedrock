"""Tests for the container-wide cache of decoded snapshot objects (``shared.snapshot_cache``) and the cold-start import it sits behind."""

from __future__ import annotations

from shared import scope_snapshot_serve, view_jobs
from shared.snapshot_cache import SnapshotObjectCache
from shared.snapshot_store import encode_json
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, SnapshotBucket


def _bucket_with(objects: dict[str, object]) -> SnapshotBucket:
    bucket = SnapshotBucket()
    for key, value in objects.items():
        bucket.put_object(Bucket=SNAPSHOT_BUCKET, Key=key, Body=encode_json(value))
    bucket.gets.clear()
    return bucket


class TestSnapshotObjectCache:
    def test_two_requests_for_one_object_read_it_once(self):
        bucket = _bucket_with({'a.json.gz': {'rows': [1, 2, 3]}})
        cache = SnapshotObjectCache()
        values = [cache.get(bucket, SNAPSHOT_BUCKET, 'a.json.gz') for _ in range(2)]
        assert (values, bucket.gets) == ([{'rows': [1, 2, 3]}] * 2, ['a.json.gz'])

    def test_a_missing_object_is_none_and_read_again_next_time(self):
        bucket = _bucket_with({})
        cache = SnapshotObjectCache()
        values = [cache.get(bucket, SNAPSHOT_BUCKET, 'gone.json.gz') for _ in range(2)]
        assert (values, len(bucket.gets)) == ([None, None], 2)

    def test_the_least_recently_used_object_is_dropped_past_the_budget(self):
        bucket = _bucket_with({'a.json.gz': 'x' * 40, 'b.json.gz': 'y' * 40, 'c.json.gz': 'z' * 40})
        cache = SnapshotObjectCache(budget=100)
        for key in ('a.json.gz', 'b.json.gz', 'a.json.gz', 'c.json.gz'):
            cache.get(bucket, SNAPSHOT_BUCKET, key)
        bucket.gets.clear()
        for key in ('a.json.gz', 'b.json.gz'):
            cache.get(bucket, SNAPSHOT_BUCKET, key)
        assert bucket.gets == ['b.json.gz']

    def test_never_holds_more_than_its_budget(self):
        bucket = _bucket_with({f'{index}.json.gz': 'v' * 30 for index in range(10)})
        cache = SnapshotObjectCache(budget=100)
        for index in range(10):
            cache.get(bucket, SNAPSHOT_BUCKET, f'{index}.json.gz')
        assert 0 < cache.size <= 100

    def test_an_object_over_the_object_limit_is_never_cached(self):
        bucket = _bucket_with({'big.json.gz': 'b' * 200})
        cache = SnapshotObjectCache(budget=1_000, max_object=100)
        for _ in range(2):
            cache.get(bucket, SNAPSHOT_BUCKET, 'big.json.gz')
        assert (len(bucket.gets), cache.size) == (2, 0)


def test_the_snapshot_reader_leaves_the_builder_registry_unimported_until_it_serves():
    assert ('artifact_registry' in vars(scope_snapshot_serve), 'fold_scope' in vars(view_jobs)) == (False, False)
