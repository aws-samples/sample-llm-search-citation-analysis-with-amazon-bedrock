"""DataForSEO price estimates (USD upper bounds per call)."""

from __future__ import annotations

import pytest

from shared.dataforseo_pricing import (
    GOOGLE_ADS_LIVE_TASK_USD,
    clamp_serp_depth,
    labs_usd,
    serp_keyword_cost_multiplier,
    serp_usd,
)


def test_prices_labs_research_at_500_rows_with_clickstream_when_incident_shape_is_requested():
    assert labs_usd(500, clickstream=True) == pytest.approx(0.144, abs=1e-10)


def test_prices_labs_research_at_default_150_rows_when_clickstream_is_off():
    assert labs_usd(150) == pytest.approx(0.03, abs=1e-10)


def test_prices_one_labs_row_at_task_plus_row_fee_when_one_keyword_is_requested():
    assert labs_usd(1) == pytest.approx(0.01212, abs=1e-10)


def test_prices_live_serp_at_two_pages_when_depth_is_the_default_20():
    assert serp_usd(20, 'live', 'example shoes') == pytest.approx(0.0035, abs=1e-10)


def test_bills_five_times_when_keyword_uses_a_search_operator():
    assert serp_usd(20, 'live', 'site:example.com seo') == pytest.approx(0.0175, abs=1e-10)


def test_prices_queued_serp_at_queue_rates_when_depth_is_20():
    assert serp_usd(20, 'queued') == pytest.approx(0.00105, abs=1e-10)


def test_bills_a_partial_page_as_full_page_when_depth_is_not_a_multiple_of_ten():
    assert serp_usd(15, 'live') == serp_usd(20, 'live')


@pytest.mark.parametrize(('depth', 'clamped'), [(0, 10), (5, 10), (10, 10), (50, 50), (100, 100), (500, 100)])
def test_clamps_depth_to_ten_through_one_hundred_when_depth_is_out_of_range(depth, clamped):
    assert clamp_serp_depth(depth) == clamped


def test_prices_live_serp_at_ten_pages_when_depth_exceeds_the_maximum():
    assert serp_usd(500, 'live') == pytest.approx(0.002 + 9 * 0.0015, abs=1e-10)


@pytest.mark.parametrize('keyword', ['intitle:shoes', 'INURL:blog example', 'example define:word'])
def test_detects_operator_anywhere_in_keyword_when_case_differs(keyword):
    assert serp_keyword_cost_multiplier(keyword) == 5


def test_keeps_base_price_when_keyword_has_colon_but_no_operator():
    assert serp_keyword_cost_multiplier('time 10:30 example') == 1


def test_exposes_flat_google_ads_price_when_imported():
    assert GOOGLE_ADS_LIVE_TASK_USD == 0.09
