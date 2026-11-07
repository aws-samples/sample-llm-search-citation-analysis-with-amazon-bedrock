"""Tests for shared.backlinks_filters: the DataForSEO filter expressions, the spam rule and the 8-condition budget."""

from __future__ import annotations

import pytest

from shared.backlinks_filters import (
    FilterError,
    build_filters,
    condition_limit,
    order_by,
    parse_filters,
    spam_group,
    subfolder_group,
)
from shared.backlinks_target import backlinks_target

DOMAIN = backlinks_target('example.com')
SUBFOLDER = backlinks_target('example.com/blog')
SPAM = [['backlink_spam_score', '<', 40], 'or', ['backlink_spam_score', '=', None]]


def test_keeps_unknown_spam_scores_visible_in_the_spam_rule():
    assert spam_group('backlink_spam_score') == SPAM


def test_sends_only_the_spam_rule_when_no_filter_is_set():
    built = build_filters('backlinks', {}, DOMAIN, hide_spam=True)

    assert (built.expression, built.conditions) == ([SPAM], 2)


def test_sends_no_filters_when_spam_is_included_and_nothing_is_filtered():
    built = build_filters('backlinks', {}, DOMAIN, hide_spam=False)

    assert (built.expression, built.conditions) == (None, 0)


def test_applies_the_same_spam_rule_to_referring_domains_on_their_links_score():
    built = build_filters('referring_domains', {}, DOMAIN, hide_spam=True)

    assert built.expression == [[['backlinks_spam_score', '<', 40], 'or', ['backlinks_spam_score', '=', None]]]


def test_never_filters_top_pages_on_spam():
    assert build_filters('top_pages', {}, DOMAIN, hide_spam=True).expression is None


def test_ors_include_terms_into_one_group_placed_first():
    filters = parse_filters('backlinks', {'min_domain_rank': 10, 'include': 'Blog, news+wiki'})

    built = build_filters('backlinks', filters, DOMAIN, hide_spam=False)

    assert built.expression == [
        [['url_from', 'ilike', '%blog%'], 'or', ['url_from', 'ilike', '%news%'], 'or', ['url_from', 'ilike', '%wiki%']],
        'and', ['domain_from_rank', '>=', 10],
    ]


def test_sends_a_single_include_term_as_a_plain_condition():
    built = build_filters('top_pages', parse_filters('top_pages', {'include': 'pricing'}), DOMAIN, hide_spam=False)

    assert built.expression == [['url', 'ilike', '%pricing%']]


def test_ands_one_not_ilike_per_exclude_term():
    built = build_filters('referring_domains', {'exclude': 'spam, ads'}, DOMAIN, hide_spam=False)

    assert built.expression == [['domain', 'not_ilike', '%spam%'], 'and', ['domain', 'not_ilike', '%ads%']]


def test_maps_the_link_flags_to_their_api_conditions():
    filters = parse_filters('backlinks', {'link_type': 'nofollow', 'hide_lost': True, 'hide_broken': True})

    built = build_filters('backlinks', filters, DOMAIN, hide_spam=False)

    assert built.expression == [['dofollow', '=', False], 'and', ['is_lost', '=', False], 'and', ['is_broken', '=', False]]


def test_pins_one_referring_domain_with_domain_from():
    built = build_filters('backlinks', {'domain_from': 'blog.example.org'}, DOMAIN, hide_spam=False)

    assert built.expression == [['domain_from', '=', 'blog.example.org']]


def test_puts_the_subfolder_group_in_front_of_the_user_filters_and_the_spam_rule_last():
    built = build_filters('backlinks', {'max_spam_score': 30}, SUBFOLDER, hide_spam=True)

    assert built.expression == [subfolder_group('url_to', SUBFOLDER), 'and', ['backlink_spam_score', '<=', 30], 'and', SPAM]


def test_matches_a_subfolder_and_its_children_with_and_without_www():
    assert subfolder_group('url', SUBFOLDER) == [
        ['url', 'like', '%://example.com/blog'], 'or', ['url', 'like', '%://example.com/blog/%'], 'or',
        ['url', 'like', '%://www.example.com/blog'], 'or', ['url', 'like', '%://www.example.com/blog/%'],
    ]


def test_counts_scope_spam_and_user_conditions_against_the_budget():
    built = build_filters('backlinks', {'min_link_rank': 1, 'max_link_rank': 90}, SUBFOLDER, hide_spam=True)

    assert built.conditions == 8


def test_refuses_filters_over_the_8_condition_budget_instead_of_truncating():
    filters = parse_filters('backlinks', {'include': 'a', 'exclude': 'c', 'min_domain_rank': 1})

    with pytest.raises(FilterError, match=r'Too many filter conditions \(9 of 8 max\)\.'):
        build_filters('backlinks', filters, SUBFOLDER, hide_spam=True)


@pytest.mark.parametrize(('tab', 'target', 'hide_spam', 'expected'), [
    ('backlinks', DOMAIN, True, 6), ('backlinks', SUBFOLDER, True, 2), ('backlinks', SUBFOLDER, False, 4),
    ('referring_domains', DOMAIN, True, 6), ('top_pages', SUBFOLDER, True, 4), ('top_pages', DOMAIN, False, 8),
])
def test_leaves_the_user_what_the_scope_and_spam_rule_do_not_use(tab, target, hide_spam, expected):
    assert condition_limit(tab, target, hide_spam=hide_spam) == expected


def test_reads_numeric_strings_and_drops_empty_values():
    assert parse_filters('top_pages', {'min_backlinks': '10', 'max_rank': '', 'include': '  '}) == {'min_backlinks': 10}


@pytest.mark.parametrize('value', ['ten', 'nan', 'inf', True, [1]])
def test_refuses_a_numeric_filter_that_is_not_a_finite_number(value):
    with pytest.raises(FilterError, match='min_rank must be a number'):
        parse_filters('referring_domains', {'min_rank': value})


def test_refuses_a_filter_the_table_does_not_have():
    with pytest.raises(FilterError, match='Unknown filter for this table: hide_lost'):
        parse_filters('top_pages', {'hide_lost': True})


def test_refuses_filters_that_are_not_an_object():
    with pytest.raises(FilterError, match='filters must be an object'):
        parse_filters('backlinks', ['include'])


def test_drops_a_false_flag_and_the_all_link_type():
    assert parse_filters('backlinks', {'hide_lost': False, 'link_type': 'all'}) == {}


def test_refuses_an_unknown_link_type():
    with pytest.raises(FilterError, match='link_type must be one of'):
        parse_filters('backlinks', {'link_type': 'ugc'})


def test_orders_by_the_api_field_of_the_sort_column():
    assert order_by('backlinks', 'spam_score', 'asc') == ['backlink_spam_score,asc']


@pytest.mark.parametrize(('tab', 'expected'), [
    ('backlinks', ['first_seen,desc']), ('referring_domains', ['backlinks,desc']), ('top_pages', ['backlinks,desc']),
])
def test_orders_by_the_default_column_of_each_table(tab, expected):
    assert order_by(tab, None, 'desc') == expected


def test_refuses_a_sort_column_the_table_does_not_have():
    with pytest.raises(FilterError, match='sort_field must be one of'):
        order_by('top_pages', 'spam_score', 'desc')
