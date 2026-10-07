"""Tests for the details shared/kpi_engine.py keeps on an answer beyond the KPIs: cited URLs and sentiment reasons."""

from __future__ import annotations

import pytest

from shared.kpi_engine import answer_from_row, matches_domain, sighting_from_brand
from testing.search_results_fixtures import search_result_row
from testing.sentiment_examples_fixtures import stored_brand

RUN = '2026-10-07T06:00:00.000000Z'


def _cited_urls(citations: object) -> tuple[str, ...]:
    answer = answer_from_row(search_result_row('k', 'openai', [], timestamp=RUN, citations=citations))
    assert answer is not None
    return answer.cited_urls


class TestCitedUrls:
    def test_keeps_every_cited_url_once_in_citation_order(self):
        urls = ['https://b.com/x', 'https://a.com/y', 'https://b.com/x', ' https://a.com/y ']

        assert _cited_urls(urls) == ('https://b.com/x', 'https://a.com/y')

    def test_drops_entries_without_a_host(self):
        assert _cited_urls(['', '   ', 'https://', 'https://[broken', 5, None, 'a.com/page']) == ('a.com/page',)

    @pytest.mark.parametrize('citations', [None, 'https://a.com', {'url': 'https://a.com'}])
    def test_is_empty_when_the_citations_are_not_a_list(self, citations):
        assert _cited_urls(citations) == ()

    def test_names_the_same_hosts_as_the_cited_domains(self):
        answer = answer_from_row(search_result_row('k', 'openai', [], timestamp=RUN, citations=['https://www.a.com/x', 'https://b.com/']))

        assert answer is not None
        assert answer.cited_domains == frozenset({'a.com', 'b.com'})


class TestSightingReason:
    @pytest.mark.parametrize(('reason', 'expected'), [(' Fees add up ', 'Fees add up'), ('  ', None), (None, None), (7, None)])
    def test_keeps_the_stored_sentiment_reason_as_text(self, reason, expected):
        sighting = sighting_from_brand(stored_brand('Borealis Air', 'mixed', classification='competitor', sentiment_reason=reason))

        assert sighting is not None
        assert sighting.reason == expected

    def test_is_empty_for_a_brand_stored_without_a_reason(self):
        sighting = sighting_from_brand(stored_brand('Borealis Air', 'mixed'))

        assert sighting is not None
        assert sighting.reason is None


class TestMatchesDomain:
    @pytest.mark.parametrize(('domain', 'expected'), [('borealis-air.com', True), ('app.borealis-air.com', True), ('notborealis-air.com', False)])
    def test_matches_a_listed_domain_and_its_subdomains_only(self, domain, expected):
        assert matches_domain(domain, ['https://www.borealis-air.com/']) is expected
