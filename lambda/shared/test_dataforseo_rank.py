"""Tests for rank check bodies, matching and cost estimates."""

from __future__ import annotations

import pytest

from shared.dataforseo_rank import (
    LIVE_PATH,
    live_rank_check,
    pair_tag,
    parse_pair_tag,
    rank_check_result,
    rank_task,
    run_estimate,
)
from testing.dataforseo_fixtures import install_transport, ok_envelope, task_error_envelope
from testing.rank_tracking_fixtures import CODES, organic, serp_result


def test_builds_a_mobile_body_that_stops_crawling_at_the_first_organic_match():
    assert rank_task('cheap flights', CODES, 'mobile', 30, 'example.com', tag='kw-1#mobile') == {
        'keyword': 'cheap flights', 'location_code': 2840, 'language_code': 'en', 'device': 'mobile',
        'os': 'android', 'depth': 30,
        'stop_crawl_on_match': [{'match_value': 'example.com', 'match_type': 'with_subdomains'}],
        'find_targets_in': ['organic'], 'tag': 'kw-1#mobile',
    }


def test_searches_desktop_as_windows():
    assert rank_task('a', CODES, 'desktop', 30, 'example.com')['os'] == 'windows'


@pytest.mark.parametrize(('depth', 'sent'), [(5, 10), (30, 30), (250, 100)])
def test_clamps_the_depth_to_what_dataforseo_accepts(depth, sent):
    assert rank_task('a', CODES, 'desktop', depth, 'example.com')['depth'] == sent


def test_escapes_percent_and_plus_in_the_keyword():
    assert rank_task('100% c++', CODES, 'desktop', 10, 'example.com')['keyword'] == '100%25 c%2B%2B'


def test_reads_the_position_as_rank_group_of_the_first_organic_match():
    check = rank_check_result(serp_result(organic(1, 'other.example.org'), organic(4, 'example.com', rank_absolute=7)),
                              'example.com')

    assert (check.position, check.rank_absolute) == (4, 7)


def test_matches_a_subdomain_of_the_tracked_domain():
    check = rank_check_result(serp_result(organic(2, 'Blog.Example.com')), 'example.com')

    assert check.position == 2


def test_does_not_match_a_domain_that_only_ends_with_the_same_letters():
    check = rank_check_result(serp_result(organic(2, 'notexample.com')), 'example.com')

    assert check.position is None


def test_never_counts_a_featured_snippet_as_a_position():
    snippet = {'type': 'featured_snippet', 'rank_group': 1, 'domain': 'example.com', 'url': 'https://example.com/a'}

    check = rank_check_result(serp_result(snippet), 'example.com')

    assert (check.position, check.serp_features) == (None, ('featured_snippet',))


def test_falls_back_to_rank_absolute_without_rank_group():
    item = {'type': 'organic', 'rank_absolute': 9, 'domain': 'example.com', 'url': 'https://example.com/b'}

    assert rank_check_result(serp_result(item), 'example.com').position == 9


def test_lists_each_serp_feature_type_once_in_order():
    items = [{'type': 'ai_overview'}, organic(1, 'a.example.org'), {'type': 'people_also_ask'}, organic(2, 'b.example.org')]

    assert rank_check_result(serp_result(*items), 'example.com').serp_features == (
        'ai_overview', 'organic', 'people_also_ask')


def test_reads_a_missing_result_as_checked_and_not_found():
    check = rank_check_result(None, 'example.com')

    assert (check.position, check.url, check.serp_features) == (None, None, ())


def test_round_trips_a_pair_tag():
    assert parse_pair_tag(pair_tag('kw-1', 'mobile')) == ('kw-1', 'mobile')


def test_live_check_posts_once_without_retrying_a_server_error(monkeypatch):
    transport = install_transport(monkeypatch, (500, 'oops'), ok_envelope())

    with pytest.raises(Exception, match='HTTP 500'):
        live_rank_check('a', CODES, 'desktop', 10, 'example.com')
    assert (len(transport.calls), transport.calls[0].url.endswith(LIVE_PATH)) == (1, True)


def test_live_check_returns_the_match_and_its_cost(monkeypatch):
    install_transport(monkeypatch, ok_envelope([organic(3, 'example.com', url='https://example.com/x')], cost=0.0035))

    check, cost = live_rank_check('a', CODES, 'desktop', 20, 'example.com')

    assert (check.position, check.url, cost) == (3, 'https://example.com/x', 0.0035)


def test_live_check_reads_no_search_results_as_not_found(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.002))

    check, cost = live_rank_check('a', CODES, 'desktop', 10, 'example.com')

    assert (check.position, cost) == (None, 0.002)


def test_estimates_a_live_run_with_two_queued_retry_rounds_as_the_worst_case():
    estimate = run_estimate(['a', 'b'], 2, 30, 'live')

    # Live at depth 30: 0.002 + 2 x 0.0015 = 0.005; queued: 0.0006 + 2 x 0.00045 = 0.0015.
    assert (estimate.pairs, estimate.check_usd, estimate.worst_case_usd) == (4, 0.02, 0.032)


def test_multiplies_the_price_of_a_keyword_with_a_search_operator_by_five():
    plain_estimate = run_estimate(['flights'], 1, 10, 'queued')
    operator_estimate = run_estimate(['site:example.com flights'], 1, 10, 'queued')

    assert operator_estimate.check_usd == pytest.approx(plain_estimate.check_usd * 5)
