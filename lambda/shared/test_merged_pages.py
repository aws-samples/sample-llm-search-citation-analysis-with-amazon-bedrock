"""Merged-partition pages: every item once, newest first, whatever the page and read sizes."""

from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.cursors import encode_cursor
from shared.merged_pages import END, MergeSpec, decode_positions, merged_page

PARTITIONS = ('a', 'b', 'c')
SPEC = MergeSpec(
    partitions=PARTITIONS,
    key_names=('id', 'kind', 'created_at'),
    sort_key=lambda item: (str(item['created_at']), str(item['id'])),
)


def fake_reader(rows: dict[str, list[dict[str, Any]]], read_cap: int) -> Any:
    """Newest-first partition reads that stop after ``read_cap`` items, like DynamoDB's 1 MB cap."""
    ordered = {name: sorted(items, key=SPEC.sort_key, reverse=True) for name, items in rows.items()}

    def read(partition: str, start_key: dict[str, Any] | None, limit: int) -> tuple[list[dict[str, Any]], bool]:
        items = ordered.get(partition, [])
        start = 0
        if start_key is not None:
            start = next(index for index, item in enumerate(items) if item['id'] == start_key['id']) + 1
        taken = items[start:start + min(limit, read_cap)]
        return taken, start + len(taken) < len(items)

    return read


def follow(read: Any, limit: int, max_bytes: int = 1_000_000) -> list[dict[str, Any]]:
    """Every item of every page, following next_token to the end."""
    collected: list[dict[str, Any]] = []
    token: str | None = None
    for _page in range(10_000):
        positions = decode_positions(token, SPEC)
        assert positions is not None
        page = merged_page(read, SPEC, positions, limit, max_bytes)
        collected.extend(page.items)
        token = page.next_token
        if token is None:
            return collected
    raise AssertionError('pagination did not terminate')


rows_strategy = st.dictionaries(
    st.sampled_from(PARTITIONS),
    st.lists(st.integers(min_value=0, max_value=50), max_size=25, unique=True),
)


@settings(max_examples=150, deadline=None)
@given(rows_strategy, st.integers(min_value=1, max_value=7), st.integers(min_value=1, max_value=7))
def test_following_next_token_returns_every_item_once_newest_first(
    stamps: dict[str, list[int]], limit: int, read_cap: int,
) -> None:
    rows = {
        name: [{'id': f'{name}-{stamp}', 'kind': name, 'created_at': f'2026-09-{stamp:02d}'} for stamp in values]
        for name, values in stamps.items()
    }
    expected = sorted((item for items in rows.values() for item in items), key=SPEC.sort_key, reverse=True)

    assert follow(fake_reader(rows, read_cap), limit) == expected


TIED_SPEC = MergeSpec(
    partitions=PARTITIONS,
    key_names=('id', 'kind', 'created_at'),
    sort_key=lambda item: (str(item['created_at']),),
)


def tied_reader(rows: dict[str, list[dict[str, Any]]], read_cap: int) -> Any:
    """Reads ordered by ``created_at`` only; equal timestamps keep insertion order, which ``id`` does not follow."""
    ordered = {name: sorted(items, key=TIED_SPEC.sort_key, reverse=True) for name, items in rows.items()}

    def read(partition: str, start_key: dict[str, Any] | None, limit: int) -> tuple[list[dict[str, Any]], bool]:
        items = ordered.get(partition, [])
        start = 0 if start_key is None else [item['id'] for item in items].index(start_key['id']) + 1
        taken = items[start:start + min(limit, read_cap)]
        return taken, start + len(taken) < len(items)

    return read


@settings(max_examples=150, deadline=None)
@given(
    st.dictionaries(st.sampled_from(PARTITIONS), st.lists(st.integers(min_value=0, max_value=4), max_size=12)),
    st.integers(min_value=1, max_value=5),
    st.integers(min_value=1, max_value=5),
)
def test_following_next_token_returns_every_item_once_when_timestamps_tie(
    stamps: dict[str, list[int]], limit: int, read_cap: int,
) -> None:
    rows = {
        name: [{'id': f'{name}-{n}', 'kind': name, 'created_at': f'2026-09-{stamp:02d}'} for n, stamp in enumerate(values)]
        for name, values in stamps.items()
    }
    read = tied_reader(rows, read_cap)
    collected: list[dict[str, Any]] = []
    token: str | None = None
    for _page in range(1_000):
        positions = decode_positions(token, TIED_SPEC)
        assert positions is not None
        page = merged_page(read, TIED_SPEC, positions, limit)
        collected.extend(page.items)
        token = page.next_token
        if token is None:
            break

    assert sorted(item['id'] for item in collected) == sorted(item['id'] for items in rows.values() for item in items)
    assert [item['created_at'] for item in collected] == sorted((item['created_at'] for item in collected), reverse=True)


def test_page_stops_at_byte_budget_and_continues_on_next_page() -> None:
    rows = {'a': [{'id': f'a-{n}', 'kind': 'a', 'created_at': f'2026-09-{n:02d}', 'text': 'x' * 400} for n in range(1, 11)]}
    read = fake_reader(rows, 100)

    first = merged_page(read, SPEC, dict.fromkeys(PARTITIONS), 10, max_bytes=1_000)

    assert [item['id'] for item in first.items] == ['a-10', 'a-9']
    assert first.next_token is not None


def test_returns_no_token_when_every_partition_is_read_to_its_end() -> None:
    rows = {'a': [{'id': 'a-1', 'kind': 'a', 'created_at': '2026-09-01'}]}

    page = merged_page(fake_reader(rows, 10), SPEC, dict.fromkeys(PARTITIONS), 5)

    assert page.next_token is None


def test_keeps_freshest_image_when_a_row_appears_in_two_partitions() -> None:
    spec = MergeSpec(
        partitions=PARTITIONS,
        key_names=('id', 'kind', 'created_at'),
        sort_key=SPEC.sort_key,
        identity=lambda item: str(item['id']),
        freshness=lambda item: (str(item['updated_at']),),
    )
    stale = {'id': 'row', 'kind': 'a', 'created_at': '2026-09-01', 'updated_at': '2026-09-01'}
    fresh = {'id': 'row', 'kind': 'b', 'created_at': '2026-09-01', 'updated_at': '2026-09-02'}
    read = fake_reader({'a': [stale], 'b': [fresh]}, 10)

    page = merged_page(read, spec, dict.fromkeys(PARTITIONS), 5)

    assert page.items == [fresh]


@pytest.mark.parametrize('token', [
    'not-base64!',
    encode_cursor({'a': None, 'b': None}),
    encode_cursor({'a': {'id': 'x'}, 'b': None, 'c': None}),
    encode_cursor({'a': 'start', 'b': None, 'c': None}),
    encode_cursor({'a': {'id': '', 'kind': 'a', 'created_at': 'x'}, 'b': None, 'c': None}),
])
def test_rejects_malformed_token(token: str) -> None:
    assert decode_positions(token, SPEC) is None


def test_accepts_token_with_end_and_key_positions() -> None:
    token = encode_cursor({'a': END, 'b': {'id': 'b-1', 'kind': 'b', 'created_at': '2026'}, 'c': None})
    assert token is not None

    assert decode_positions(token, SPEC) == {'a': END, 'b': {'id': 'b-1', 'kind': 'b', 'created_at': '2026'}, 'c': None}
