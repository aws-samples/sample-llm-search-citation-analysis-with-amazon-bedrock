"""Domain Overview targets, scopes and the DataForSEO filter budget (``shared.dataforseo_domain_scope``)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.dataforseo_domain_scope import (
    FilterBudgetError,
    InvalidTargetError,
    ResearchTarget,
    count_conditions,
    escape_like,
    join_clauses,
    parse_research_target,
    parse_terms,
    ranked_keywords_scope,
    relevant_pages_scope,
    scoped_expression,
)

RELATIVE = 'ranked_serp_element.serp_item.relative_url'
DOMAIN = 'ranked_serp_element.serp_item.domain'


class TestParseResearchTarget:
    def test_defaults_a_bare_host_to_subdomains_without_www(self):
        assert parse_research_target('WWW.Example.com') == ResearchTarget(scope='subdomains', hostname='example.com', path='')

    def test_defaults_an_input_with_a_path_to_subfolder(self):
        assert parse_research_target('https://example.com/Blog/?page=2#top').scope == 'subfolder'

    def test_keeps_the_path_casing_without_trailing_slashes_query_or_fragment(self):
        assert parse_research_target('example.com/Blog//?page=2#top').path == '/Blog'

    def test_shows_the_path_only_for_path_scopes(self):
        assert (parse_research_target('example.com/blog').display, parse_research_target('example.com/blog', 'domain').display) == (
            'example.com/blog', 'example.com',
        )

    @pytest.mark.parametrize('text', ['my_site.com', 'localhost', '192.168.0.1', 'example.c0m', 'exa mple.com', '-bad.example.com', ''])
    def test_refuses_a_host_dataforseo_would_bill_and_fail(self, text):
        with pytest.raises(InvalidTargetError, match=r'Enter a'):
            parse_research_target(text)

    def test_refuses_embedded_credentials(self):
        with pytest.raises(InvalidTargetError, match='credentials'):
            parse_research_target('https://user:secret@example.com/')

    def test_refuses_subfolder_for_a_root_input(self):
        with pytest.raises(InvalidTargetError, match='Add a path'):
            parse_research_target('example.com', 'subfolder')

    def test_accepts_a_punycode_top_level_label(self):
        assert parse_research_target('example.xn--p1ai').hostname == 'example.xn--p1ai'


class TestTerms:
    def test_splits_on_commas_and_plus_signs_lower_cased(self):
        assert parse_terms(' Shoes, RED+ ,  ') == ['shoes', 'red']

    def test_escapes_the_like_wildcards_and_the_escape_character(self):
        assert escape_like('50%_off\\now') == '50\\%\\_off\\\\now'


class TestRankedKeywordsScope:
    def test_adds_no_condition_for_subdomains(self):
        assert ranked_keywords_scope(parse_research_target('example.com')).clauses == ()

    def test_pins_the_host_with_and_without_www_for_domain(self):
        scope = ranked_keywords_scope(parse_research_target('example.com', 'domain'))

        assert (scope.clauses, scope.condition_count) == (([DOMAIN, 'in', ['example.com', 'www.example.com']],), 1)

    def test_matches_the_path_and_its_children_for_subfolder(self):
        scope = ranked_keywords_scope(parse_research_target('example.com/blog_x'))

        assert (scope.clauses[1], scope.condition_count) == (
            [[RELATIVE, '=', '/blog_x'], 'or', [RELATIVE, 'like', '/blog\\_x/%'], 'or', [RELATIVE, 'like', '/blog\\_x?%']], 4,
        )

    def test_matches_one_page_with_or_without_slash_for_exact_url(self):
        scope = ranked_keywords_scope(parse_research_target('example.com/a', 'exact_url'))

        assert scope.clauses[1][0] == [RELATIVE, 'in', ['/a', '/a/']]


class TestRelevantPagesScope:
    def test_uses_two_like_patterns_for_domain(self):
        scope = relevant_pages_scope(parse_research_target('example.com', 'domain'))

        assert (scope.clauses[0], scope.condition_count) == (
            [['page_address', 'like', '%://example.com/%'], 'or', ['page_address', 'like', '%://www.example.com/%']], 2,
        )

    def test_uses_four_like_patterns_for_subfolder(self):
        assert relevant_pages_scope(parse_research_target('example.com/blog')).condition_count == 4

    def test_matches_the_root_page_for_an_exact_root_url(self):
        patterns = relevant_pages_scope(parse_research_target('example.com', 'exact_url')).clauses[0][0]

        assert patterns == ['page_address', 'like', '%://example.com/']


class TestBudget:
    def test_counts_every_member_of_a_nested_group(self):
        assert count_conditions([['a', '=', 1], 'and', [['b', '=', 1], 'or', ['c', '=', 1]]]) == 3

    def test_refuses_a_ninth_condition_instead_of_dropping_it(self):
        scope = ranked_keywords_scope(parse_research_target('example.com/blog'))

        with pytest.raises(FilterBudgetError, match='9 of 8'):
            scoped_expression(scope, [['x', '>=', value] for value in range(5)])

    def test_accepts_exactly_eight_conditions(self):
        scope = ranked_keywords_scope(parse_research_target('example.com/blog'))

        assert count_conditions(scoped_expression(scope, [['x', '>=', value] for value in range(4)])) == 8

    @given(st.lists(st.integers(), max_size=6))
    def test_joins_clauses_with_one_operator_between_each_pair(self, values):
        joined = join_clauses([['x', '=', value] for value in values], 'and')

        assert (len(joined), joined.count('and')) == (max(0, 2 * len(values) - 1), max(0, len(values) - 1))
