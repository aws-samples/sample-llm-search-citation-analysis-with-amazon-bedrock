"""SEO cache: keys, expiry, the empty-never-overwrites rule and the S3 spill."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import seo_cache
from shared.seo_cache import cache_key, get_cached, is_empty_payload, put_cached
from testing.dataforseo_fixtures import InMemoryBucket, InMemoryCacheTable
from testing.dynamodb_stubs import fake_table

NOW = 1_800_000_000
PARAMS = {'keyword': 'example shoes', 'location_code': 2840, 'language_code': 'en'}
ROWS = {'rows': [{'keyword': 'example shoes', 'search_volume': 1300}]}
BIG = {'rows': ['x' * 1000] * 400}
"""About 400 KB of JSON: over the 350 KB inline limit."""


@pytest.fixture
def table(monkeypatch) -> InMemoryCacheTable:
    stub = InMemoryCacheTable()
    monkeypatch.setattr(seo_cache, '_table', lambda: stub)
    monkeypatch.setattr(seo_cache, '_now', lambda: NOW)
    return stub


@pytest.fixture
def bucket(monkeypatch) -> InMemoryBucket:
    stub = InMemoryBucket()
    monkeypatch.setattr(seo_cache, '_s3', lambda: stub)
    monkeypatch.setenv('SEO_BUCKET', 'raw-example')
    return stub


# --- keys --------------------------------------------------------------------------------------------------


def test_builds_namespaced_versioned_sha256_key_when_params_are_given():
    key = cache_key('kw:research', 3, PARAMS)
    namespace, version, digest = key.split('#')
    assert (namespace, version, len(digest)) == ('kw:research', 'v3', 64)


def test_builds_same_key_when_param_order_differs():
    reordered = {'language_code': 'en', 'location_code': 2840, 'keyword': 'example shoes'}
    assert cache_key('kw:research', 1, reordered) == cache_key('kw:research', 1, PARAMS)


def test_builds_same_key_when_a_param_is_none():
    assert cache_key('kw:research', 1, {**PARAMS, 'mode': None}) == cache_key('kw:research', 1, PARAMS)


def test_builds_different_keys_when_version_differs():
    assert cache_key('kw:research', 2, PARAMS) != cache_key('kw:research', 1, PARAMS)


def test_builds_different_keys_when_keyword_case_differs():
    assert cache_key('kw:research', 1, {**PARAMS, 'keyword': 'Example Shoes'}) != cache_key('kw:research', 1, PARAMS)


# --- reads -------------------------------------------------------------------------------------------------


def test_returns_stored_payload_when_same_params_are_read_again(table):
    put_cached('kw:research', 1, PARAMS, ROWS, ttl_seconds=86_400)

    assert get_cached('kw:research', 1, PARAMS) == ROWS


def test_stores_expiry_and_dynamodb_ttl_when_payload_is_written(table):
    put_cached('kw:research', 1, PARAMS, ROWS, ttl_seconds=60)

    item = table.items[cache_key('kw:research', 1, PARAMS)]
    assert (item['expires_at'], item['ttl'], item['empty']) == (NOW + 60, NOW + 60, False)
    assert json.loads(item['payload']) == ROWS


def test_returns_miss_when_entry_is_expired(table, monkeypatch):
    put_cached('kw:research', 1, PARAMS, ROWS, ttl_seconds=60)
    monkeypatch.setattr(seo_cache, '_now', lambda: NOW + 60)

    assert get_cached('kw:research', 1, PARAMS) is None


def test_a_permanent_entry_has_no_expiry_and_is_read_years_later(table, monkeypatch):
    put_cached('lighthouse-run', 1, PARAMS, ROWS, ttl_seconds=None)

    item = table.items[cache_key('lighthouse-run', 1, PARAMS)]
    assert (item.get('permanent'), 'ttl' in item, 'expires_at' in item) == (True, False, False)
    monkeypatch.setattr(seo_cache, '_now', lambda: NOW + 10 * 365 * 86_400)
    assert get_cached('lighthouse-run', 1, PARAMS) == ROWS


def test_an_empty_write_never_replaces_a_permanent_entry(table):
    put_cached('lighthouse-run', 1, PARAMS, ROWS, ttl_seconds=None)
    put_cached('lighthouse-run', 1, PARAMS, [], ttl_seconds=60)

    assert get_cached('lighthouse-run', 1, PARAMS) == ROWS


def test_returns_miss_when_nothing_is_cached(table):
    assert get_cached('kw:research', 1, PARAMS) is None


def test_returns_miss_when_payload_is_not_json(table):
    key = cache_key('kw:research', 1, PARAMS)
    table.items[key] = {'cache_key': key, 'payload': '{not json', 'expires_at': NOW + 60, 'empty': False}

    assert get_cached('kw:research', 1, PARAMS) is None


def test_returns_miss_when_table_read_fails(monkeypatch):
    failing = fake_table()
    failing.get_item.side_effect = ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException'}}, 'GetItem')
    monkeypatch.setattr(seo_cache, '_table', lambda: failing)

    assert get_cached('kw:research', 1, PARAMS) is None


# --- the empty-never-overwrites rule -----------------------------------------------------------------------


def test_keeps_non_empty_payload_when_empty_payload_is_written_over_it(table):
    put_cached('serp:analysis', 1, PARAMS, ROWS, ttl_seconds=3600)
    put_cached('serp:analysis', 1, PARAMS, {'rows': []}, ttl_seconds=3600)

    assert get_cached('serp:analysis', 1, PARAMS) == ROWS


def test_replaces_expired_non_empty_payload_when_empty_payload_is_written(table, monkeypatch):
    put_cached('serp:analysis', 1, PARAMS, ROWS, ttl_seconds=60)
    monkeypatch.setattr(seo_cache, '_now', lambda: NOW + 120)
    put_cached('serp:analysis', 1, PARAMS, [], ttl_seconds=60)

    assert get_cached('serp:analysis', 1, PARAMS) == []


def test_replaces_empty_payload_when_non_empty_payload_is_written(table):
    put_cached('serp:analysis', 1, PARAMS, {'items': []}, ttl_seconds=3600)
    put_cached('serp:analysis', 1, PARAMS, ROWS, ttl_seconds=3600)

    assert get_cached('serp:analysis', 1, PARAMS) == ROWS


def test_stores_empty_payload_when_nothing_is_cached_yet(table):
    put_cached('serp:analysis', 1, PARAMS, None, ttl_seconds=3600)

    assert table.items[cache_key('serp:analysis', 1, PARAMS)]['empty'] is True


@pytest.mark.parametrize(('payload', 'empty'), [
    (None, True), ([], True), ({}, True), ({'rows': []}, True), ({'items': None}, True),
    ({'rows': [1]}, False), ([0], False), ({'check_url': None}, False), ('', False),
])
def test_classifies_payload_emptiness_when_checked(payload, empty):
    assert is_empty_payload(payload) is empty


def test_swallows_write_failure_when_table_rejects_the_put(monkeypatch):
    failing = fake_table()
    failing.put_item.side_effect = ClientError({'Error': {'Code': 'InternalServerError'}}, 'PutItem')
    monkeypatch.setattr(seo_cache, '_table', lambda: failing)

    put_cached('kw:research', 1, PARAMS, ROWS, ttl_seconds=60)

    assert failing.put_item.call_count == 1


# --- S3 spill ----------------------------------------------------------------------------------------------


def test_spills_payload_to_s3_when_it_exceeds_the_inline_limit(table, bucket):
    put_cached('kw:research', 1, PARAMS, BIG, ttl_seconds=60)

    item = table.items[cache_key('kw:research', 1, PARAMS)]
    assert 'payload' not in item
    assert item['s3_key'].startswith('seo/cache/kw:research_v1_')
    assert f"raw-example/{item['s3_key']}" in bucket.objects


def test_returns_spilled_payload_when_it_is_read_back(table, bucket):
    put_cached('kw:research', 1, PARAMS, BIG, ttl_seconds=60)

    assert get_cached('kw:research', 1, PARAMS) == BIG


def test_skips_write_when_payload_is_oversized_and_no_bucket_is_configured(table, monkeypatch):
    monkeypatch.delenv('SEO_BUCKET', raising=False)
    monkeypatch.setattr(seo_cache, '_s3', MagicMock(side_effect=AssertionError('no S3 call expected')))

    put_cached('kw:research', 1, PARAMS, BIG, ttl_seconds=60)

    assert table.items == {}
