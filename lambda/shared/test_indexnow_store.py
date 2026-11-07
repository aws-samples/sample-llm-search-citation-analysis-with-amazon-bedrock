"""IndexNow keys and history (``shared.indexnow_store``): one key per domain, never expiring; 20 newest submissions."""

from __future__ import annotations

import re

import pytest

from shared import indexnow_store
from testing.indexnow_fixtures import KEY, install_key_table


@pytest.fixture
def table(monkeypatch):
    return install_key_table(monkeypatch)


def test_creates_a_32_hex_key_on_first_use(table):
    key, created = indexnow_store.ensure_key('example.com', 'admin')

    assert (bool(re.fullmatch(r'[0-9a-f]{32}', key)), created) == (True, True)


def test_answers_the_stored_key_afterwards(table):
    first, _created = indexnow_store.ensure_key('example.com', 'admin')

    assert indexnow_store.ensure_key('example.com', 'other') == (first, False)


def test_stores_the_key_without_an_expiry(table):
    indexnow_store.ensure_key('example.com', 'admin')

    assert 'ttl' not in table.items['indexnow-key#example.com']


def test_answers_the_concurrent_writer_key_after_losing_the_race(table):
    table.lose_next_race_to = KEY

    assert indexnow_store.ensure_key('example.com', 'admin') == (KEY, False)


def test_site_keys_lists_only_domains_with_a_key(table):
    indexnow_store.ensure_key('example.com', 'admin')

    assert list(indexnow_store.site_keys(['example.com', 'example.net'])) == ['example.com']


def test_history_keeps_the_twenty_newest_submissions_newest_first(table):
    for index in range(22):
        indexnow_store.record_submission({'submitted_at': f'2026-10-02T08:00:{index:02d}Z'})

    history = indexnow_store.history()
    assert (len(history), history[0]['submitted_at']) == (20, '2026-10-02T08:00:21Z')
