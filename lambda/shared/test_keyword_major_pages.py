"""Keyword-major pages: concatenated pages equal the full list, the budget stops between keywords (design 2.45.0 §2.5, §5 test 4)."""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from shared.keyword_major_pages import PageRequest, Slot, collect_page, list_fingerprint, next_position, page_token
from shared.snapshot_artifacts import KeywordCursor, decode_keyword_cursor
from testing.window_budget_fixtures import active_deadline, ticking_deadline


def _concatenate(lists: list[list[int]], limit: int, keep: int | None = None) -> tuple[list[int], int]:
    """Every page from the start; ``keep`` items of each page kept (the byte budget); returns the items and the reads."""
    slots = [Slot(index, len(items)) for index, items in enumerate(lists)]
    reads: list[int] = []

    def read(index: int) -> list[int]:
        reads.append(index)
        return lists[index]

    found: list[int] = []
    start = KeywordCursor(0, 0, 'f')
    for _page in range(10_000):
        page = collect_page(PageRequest(slots, start, limit, read, len(lists)))
        kept = len(page.items) if keep is None else min(keep, len(page.items))
        found.extend(placed.item for placed in page.items[:kept])
        position = next_position(page, kept, slots)
        if position is None:
            return found, len(reads)
        start = KeywordCursor(position[0], position[1], 'f')
    raise AssertionError('pages never ran out')


@settings(max_examples=60, deadline=None)
@given(
    lists=st.lists(st.lists(st.integers(), max_size=7), max_size=12),
    limit=st.integers(min_value=1, max_value=9),
    keep=st.one_of(st.none(), st.integers(min_value=1, max_value=9)),
)
def test_concatenated_pages_equal_the_full_list(lists, limit, keep):
    assert _concatenate(lists, limit, keep)[0] == [item for items in lists for item in items]


def test_skips_keywords_without_items():
    lists = [[1], [], [], [2]]

    assert _concatenate(lists, 10)[1] == 2


def test_reads_only_the_keywords_the_first_page_covers():
    lists = [[1, 2], [3, 4], [5, 6]]
    reads: list[int] = []
    collect_page(PageRequest([Slot(i, 2) for i in range(3)], KeywordCursor(0, 0, 'f'), 3, lambda index: reads.append(index) or lists[index], 3))

    assert reads == [0, 1]


def test_stops_for_the_time_budget_and_resumes_at_the_unread_keyword():
    slots = [Slot(i, 1) for i in range(3)]
    with active_deadline(ticking_deadline(2)):
        page = collect_page(PageRequest(slots, KeywordCursor(0, 0, 'f'), 10, lambda index: [index], 3))

    assert (page.stopped, next_position(page, len(page.items), slots)) == ((1, 0), (1, 0))


def test_an_unbudgeted_page_reads_past_a_spent_budget():
    slots = [Slot(i, 1) for i in range(3)]
    with active_deadline(ticking_deadline(0)):
        page = collect_page(PageRequest(slots, KeywordCursor(0, 0, 'f'), 10, lambda index: [index], 3, budgeted=False))

    assert [placed.item for placed in page.items] == [0, 1, 2]


def test_page_token_is_none_past_the_end():
    assert page_token(None, 'f', 3) is None


def test_page_token_carries_the_position_and_fingerprint():
    token = page_token((2, 5), 'abc', 3)

    assert token is not None
    assert decode_keyword_cursor(token) == KeywordCursor(2, 5, 'abc')


def test_fingerprint_changes_with_its_parts():
    assert list_fingerprint('a', ['k1']) != list_fingerprint('a', ['k2'])
