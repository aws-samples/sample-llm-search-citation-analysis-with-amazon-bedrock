"""Tests for shared.dataforseo_backlinks: the requests sent and the answers read, over a scripted transport."""

from __future__ import annotations

from datetime import date

import pytest

from shared.backlinks_filters import build_filters
from shared.backlinks_target import backlinks_target
from shared.dataforseo_backlinks import (
    HISTORY_PATH,
    HISTORY_USD,
    SUMMARY_PATH,
    SUMMARY_USD,
    TABLE_PATHS,
    TableQuery,
    backlinks_usd,
    common_task,
    fetch_history,
    fetch_summary,
    fetch_table,
    history_window,
    subfolder_totals,
)
from shared.dataforseo_client import DataForSeoError
from testing.backlinks_fixtures import BACKLINK_ITEM, HISTORY_ITEMS, SUMMARY_ITEM, SUMMARY_ROW
from testing.dataforseo_fixtures import install_transport, ok_envelope

DOMAIN = backlinks_target('example.com', 'domain')
SUBFOLDER = backlinks_target('example.com/blog')
ROWS_QUERY = TableQuery(tab='backlinks', limit=50, offset=100, order_by=['rank,desc'], filters=None, mode='as_is')


def test_asks_for_live_direct_and_indirect_external_links_on_a_0_to_100_scale():
    assert common_task(DOMAIN) == {
        'target': 'example.com', 'include_subdomains': False, 'include_indirect_links': True,
        'exclude_internal_backlinks': True, 'backlinks_status_type': 'live', 'rank_scale': 'one_hundred',
    }


def test_reads_the_summary_metrics_and_cost(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope(result=[SUMMARY_ITEM], cost=0.024))

    assert (fetch_summary(DOMAIN), transport.calls[0].url.endswith(SUMMARY_PATH)) == ((SUMMARY_ROW, 0.024), True)


@pytest.mark.parametrize('result', [[], [None]])
def test_reads_an_empty_summary_result_as_no_data(monkeypatch, result):
    install_transport(monkeypatch, ok_envelope(result=result, cost=0.024))

    assert fetch_summary(DOMAIN) == (None, 0.024)


def test_never_resends_a_summary_after_a_server_error(monkeypatch):
    transport = install_transport(monkeypatch, (500, 'oops'), ok_envelope(result=[SUMMARY_ITEM]))

    with pytest.raises(DataForSeoError):
        fetch_summary(DOMAIN)
    assert len(transport.calls) == 1


def test_asks_history_for_the_hostname_over_the_year_to_yesterday(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope(HISTORY_ITEMS, cost=0.037))

    fetch_history('example.com', date(2026, 10, 2))

    assert (transport.calls[0].url.endswith(HISTORY_PATH), transport.calls[0].task) == (True, {
        'target': 'example.com', 'date_from': '2025-10-01', 'date_to': '2026-10-01', 'rank_scale': 'one_hundred',
    })


def test_returns_the_dated_history_points_and_cost(monkeypatch):
    install_transport(monkeypatch, ok_envelope(HISTORY_ITEMS, cost=0.037))

    trends, new_lost, cost = fetch_history('example.com', date(2026, 10, 2))

    assert (len(trends), len(new_lost), cost) == (2, 2, 0.037)


def test_ends_a_leap_day_window_on_the_28th_a_year_earlier():
    assert history_window(date(2028, 3, 1)) == ('2027-02-28', '2028-02-29')


def test_sends_the_page_sort_mode_and_no_filters_for_an_unfiltered_link_page(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope([BACKLINK_ITEM], total_count=400))

    fetch_table(DOMAIN, ROWS_QUERY)

    sent = transport.calls[0].task
    assert ({key: sent[key] for key in ('limit', 'offset', 'order_by', 'mode')}, 'filters' in sent) == (
        {'limit': 50, 'offset': 100, 'order_by': ['rank,desc'], 'mode': 'as_is'}, False,
    )


def test_reads_the_rows_and_the_providers_total_count(monkeypatch):
    install_transport(monkeypatch, ok_envelope([BACKLINK_ITEM, 'not-an-item'], total_count=400, cost=0.0258))

    page = fetch_table(DOMAIN, ROWS_QUERY)

    assert ([row['domain_from'] for row in page.rows], page.total_count, page.cost_usd) == (
        ['blog.example.org'], 400, 0.0258,
    )


def test_sends_no_mode_to_the_referring_domains_endpoint(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope([]))
    query = TableQuery(tab='referring_domains', limit=50, offset=0, order_by=['backlinks,desc'], filters=[['rank', '>=', 1]])

    fetch_table(DOMAIN, query)

    call = transport.calls[0]
    assert (call.url.endswith(TABLE_PATHS['referring_domains']), 'mode' in call.task, call.task['filters']) == (
        True, False, [['rank', '>=', 1]],
    )


def test_counts_a_subfolder_from_two_one_row_requests_every_link_then_one_per_domain(monkeypatch):
    transport = install_transport(
        monkeypatch, ok_envelope([], total_count=900, cost=0.024), ok_envelope([], total_count=70, cost=0.024),
    )

    totals = subfolder_totals(SUBFOLDER)

    assert (totals, [call.task['mode'] for call in transport.calls]) == ((900, 70, 0.048), ['as_is', 'one_per_domain'])


def test_counts_a_subfolder_on_its_urls_including_likely_spam(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope([], total_count=1), ok_envelope([], total_count=1))

    subfolder_totals(SUBFOLDER)

    assert transport.calls[0].task['filters'] == build_filters('backlinks', {}, SUBFOLDER, hide_spam=False).expression


def test_prices_a_request_per_call_plus_per_row():
    assert (backlinks_usd(100), SUMMARY_USD, HISTORY_USD) == (0.0276, 0.024036, 0.037176)
