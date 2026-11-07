"""Tests for shared.backlink_rows: DataForSEO Backlinks items mapped to the API's rows."""

from __future__ import annotations

from shared.backlink_rows import (
    backlink_row,
    history_rows,
    number,
    referring,
    referring_domain_row,
    summary_row,
    top_page_row,
)
from testing.backlinks_fixtures import (
    BACKLINK_ITEM,
    HISTORY_ITEMS,
    REFERRING_DOMAIN_ITEM,
    SUMMARY_ITEM,
    SUMMARY_ROW,
    TOP_PAGE_ITEM,
)


def test_maps_every_overview_metric_of_a_summary():
    assert summary_row(SUMMARY_ITEM) == SUMMARY_ROW


def test_reads_no_data_when_the_summary_result_is_null():
    assert summary_row(None) is None


def test_prefers_the_correct_spelling_when_both_referring_fields_are_present():
    assert referring({'referring_domains': 3, 'reffering_domains': 9}, 'referring_domains') == 3


def test_falls_back_to_the_misspelled_field_when_the_correct_one_is_null():
    assert referring({'referring_domains': None, 'reffering_domains': 9}, 'referring_domains') == 9


def test_treats_booleans_and_text_as_missing_numbers():
    assert [number(True), number('5'), number(0), number(2.5)] == [None, None, 0, 2.5]


def test_orders_history_oldest_first_and_drops_undated_items():
    trends, _new_lost = history_rows(HISTORY_ITEMS)

    assert trends == [
        {'date': '2026-08-01', 'backlinks': 11_500, 'referring_domains': 360, 'rank': 39},
        {'date': '2026-09-01', 'backlinks': 12_000, 'referring_domains': 370, 'rank': 40},
    ]


def test_reads_new_and_lost_referring_domains_in_either_spelling():
    _trends, new_lost = history_rows(HISTORY_ITEMS)

    assert [(point['new_referring_domains'], point['lost_referring_domains']) for point in new_lost] == [(8, 3), (10, 4)]


def test_maps_a_backlink_with_a_zero_spam_score_kept_distinct_from_unknown():
    row = backlink_row(BACKLINK_ITEM)

    assert (row['spam_score'], row['rel_attributes'], row['links_count'], row['is_lost']) == (0, ['noopener'], 2, False)


def test_reads_a_missing_spam_score_as_unknown():
    assert backlink_row({'domain_from': 'example.org'})['spam_score'] is None


def test_dates_a_lost_link_by_its_lost_date():
    row = backlink_row({**BACKLINK_ITEM, 'lost_date': '2026-09-15 00:00:00 +00:00'})

    assert (row['last_seen'], row['is_lost']) == ('2026-09-15 00:00:00 +00:00', True)


def test_falls_back_to_the_last_visit_when_a_link_has_no_last_seen():
    row = backlink_row({'last_visited': '2026-09-20 00:00:00 +00:00'})

    assert row['last_seen'] == '2026-09-20 00:00:00 +00:00'


def test_scores_a_referring_domain_by_its_links_never_by_the_target():
    assert referring_domain_row(REFERRING_DOMAIN_ITEM)['spam_score'] == 12


def test_names_a_top_page_by_its_url_when_page_is_absent():
    assert top_page_row(TOP_PAGE_ITEM) == {
        'page': 'https://example.com/pricing', 'backlinks': 300, 'referring_domains': 41, 'rank': 30,
        'broken_backlinks': 2,
    }
