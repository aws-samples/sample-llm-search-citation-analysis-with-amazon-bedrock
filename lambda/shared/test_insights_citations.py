"""Tests for shared/insights_citations.py — who the AI engines cite, and which owned pages."""

from __future__ import annotations

from typing import Any

import pytest

from shared.insights_citations import (
    DOCUMENT_SEGMENTS,
    DOCUMENT_SUFFIXES,
    OWNED_PAGES_LIMIT,
    citation_ownership_facts,
    competitor_domains_from,
    owned_pages_facts,
    page_of,
)
from shared.kpi_engine import Answer, answers_from_rows
from testing.search_results_fixtures import search_result_row

RUN = '2026-10-07T06:00:00.000000Z'
OWNED = ('aurora-airways.com',)
BOREALIS = {'Borealis Air': ['borealis-air.com'], 'Cirrus Jet': ['cirrusjet.com']}
FARES = 'https://www.aurora-airways.com/fares'
REPORT = 'https://investors.aurora-airways.com/files/annual-report.pdf'
RIVAL_DEALS = 'https://borealis-air.com/deals'
RIVAL_APP = 'https://app.borealis-air.com/'
GUIDE = 'https://travel-guide.org/south-america'


def _cited(provider: str, *urls: str, keyword: str = 'cheap flights to Lima') -> list[Answer]:
    """One answer of ``provider`` citing ``urls``."""
    return answers_from_rows([search_result_row(keyword, provider, [], timestamp=RUN, citations=list(urls))])


class TestCompetitorDomainsFrom:
    def test_normalises_each_competitors_domains_like_the_owned_domains(self):
        config = {'competitor_domains': {'Borealis Air': ['https://www.Borealis-Air.com/', 'borealis-air.com', 'borealis.travel']}}

        assert competitor_domains_from(config) == {'Borealis Air': ['borealis-air.com', 'borealis.travel']}

    def test_leaves_out_a_competitor_without_a_usable_domain(self):
        config = {'competitor_domains': {'Borealis Air': ['', None], ' ': ['x.com'], 'Cirrus Jet': 'cirrusjet.com', 'Nimbus': ['nimbus.aero']}}

        assert competitor_domains_from(config) == {'Nimbus': ['nimbus.aero']}

    @pytest.mark.parametrize('config', [{}, {'competitor_domains': None}, {'competitor_domains': ['borealis-air.com']}])
    def test_is_empty_without_a_competitor_domain_map(self, config):
        assert competitor_domains_from(config) == {}


class TestCitationOwnership:
    def test_splits_each_engines_citations_into_owned_competitor_and_third_party(self):
        answers = [*_cited('openai', FARES, RIVAL_DEALS, RIVAL_APP, GUIDE), *_cited('openai', REPORT), *_cited('gemini', GUIDE)]

        assert citation_ownership_facts(answers, OWNED, BOREALIS)['engines'] == [
            {'engine': 'gemini', 'answers': 1, 'citations': 1, 'owned': 0, 'competitors': {'Borealis Air': 0, 'Cirrus Jet': 0}, 'third_party': 1},
            {'engine': 'openai', 'answers': 2, 'citations': 5, 'owned': 2, 'competitors': {'Borealis Air': 2, 'Cirrus Jet': 0}, 'third_party': 1},
        ]

    def test_counts_a_url_cited_twice_in_one_answer_once(self):
        [row] = citation_ownership_facts(_cited('openai', FARES, FARES, f' {FARES} '), OWNED)['engines']

        assert (row['citations'], row['owned']) == (1, 1)

    def test_counts_every_non_owned_citation_as_third_party_without_competitor_domains(self):
        facts = citation_ownership_facts(_cited('claude', FARES, RIVAL_DEALS), OWNED)

        assert (facts['competitors_configured'], facts['engines'][0]['competitors'], facts['engines'][0]['third_party']) == (False, {}, 1)

    def test_gives_an_owned_domain_precedence_over_a_competitor_listing_it(self):
        [row] = citation_ownership_facts(_cited('openai', FARES), OWNED, {'Borealis Air': ['aurora-airways.com']})['engines']

        assert (row['owned'], row['competitors']) == (1, {'Borealis Air': 0})

    def test_says_which_domains_are_configured(self):
        facts = citation_ownership_facts([], (), BOREALIS)

        assert (facts['owned_configured'], facts['competitors_configured'], facts['engines']) == (False, True, [])


class TestPageOf:
    @pytest.mark.parametrize(('url', 'expected'), [
        pytest.param(FARES, ('aurora-airways.com/fares', 'aurora-airways.com/fares', False), id='web_page'),
        pytest.param('https://aurora-airways.com/', ('aurora-airways.com', 'aurora-airways.com', False), id='home_page'),
        pytest.param(
            'https://aurora-airways.com/es/fares/lima/?utm_source=x#top',
            ('aurora-airways.com/es/fares/lima', 'aurora-airways.com/es', False),
            id='query_fragment_and_trailing_slash_dropped',
        ),
        pytest.param(REPORT, ('investors.aurora-airways.com/files/annual-report.pdf', 'investors.aurora-airways.com/files', True), id='pdf_under_files'),
        pytest.param('aurora-airways.com/Policies/Baggage.DOCX', ('aurora-airways.com/Policies/Baggage.DOCX', 'aurora-airways.com/Policies', True), id='upper_case_suffix'),
        pytest.param('https://aurora-airways.com/dam/brochure', ('aurora-airways.com/dam/brochure', 'aurora-airways.com/dam', True), id='download_segment'),
        pytest.param('https://aurora-airways.com/pdf-guide', ('aurora-airways.com/pdf-guide', 'aurora-airways.com/pdf-guide', False), id='pdf_in_a_name'),
    ])
    def test_names_the_page_its_section_and_whether_it_is_a_document(self, url, expected):
        assert page_of(url) == expected

    def test_recognises_every_document_suffix_and_segment(self):
        urls = [f'https://a.com/x{suffix}' for suffix in DOCUMENT_SUFFIXES] + [f'https://a.com/{segment}/x' for segment in DOCUMENT_SEGMENTS]

        assert [page_of(url)[2] for url in urls] == [True] * (len(DOCUMENT_SUFFIXES) + len(DOCUMENT_SEGMENTS))


def _pages(answers: list[Answer]) -> dict[str, Any]:
    return owned_pages_facts(answers, OWNED)


class TestOwnedPages:
    def test_lists_the_most_cited_owned_pages_with_their_section_and_engines(self):
        answers = [*_cited('openai', FARES, REPORT), *_cited('gemini', REPORT, GUIDE), *_cited('claude', REPORT)]

        assert _pages(answers)['pages'] == [
            {'url': 'investors.aurora-airways.com/files/annual-report.pdf', 'section': 'investors.aurora-airways.com/files', 'is_document': True,
             'citations': 3, 'engines': ['claude', 'gemini', 'openai']},
            {'url': 'aurora-airways.com/fares', 'section': 'aurora-airways.com/fares', 'is_document': False, 'citations': 1, 'engines': ['openai']},
        ]

    def test_totals_each_section_over_its_pages(self):
        answers = [*_cited('openai', 'https://aurora-airways.com/es/a', 'https://aurora-airways.com/es/b.pdf'), *_cited('openai', 'https://aurora-airways.com/es/a')]

        assert _pages(answers)['sections'] == [{'section': 'aurora-airways.com/es', 'citations': 3, 'document_citations': 1, 'pages': 2}]

    def test_splits_documents_and_web_pages_per_engine_and_in_total(self):
        answers = [*_cited('openai', FARES, REPORT), *_cited('openai', REPORT), *_cited('gemini', FARES)]
        facts = _pages(answers)

        assert (facts['engines'], facts['document_citations'], facts['page_citations']) == (
            [{'engine': 'gemini', 'document_citations': 0, 'page_citations': 1}, {'engine': 'openai', 'document_citations': 2, 'page_citations': 1}],
            2,
            2,
        )

    def test_counts_one_page_cited_under_two_urls_in_one_answer_once(self):
        facts = _pages(_cited('openai', FARES, 'https://aurora-airways.com/fares/?utm_source=ai'))

        assert (facts['pages'][0]['citations'], facts['page_citations']) == (1, 1)

    def test_keeps_the_twenty_five_most_cited_pages_and_counts_the_rest(self):
        answers = [answer for index in range(OWNED_PAGES_LIMIT + 2) for answer in _cited('openai', f'https://aurora-airways.com/p{index:02}')]
        facts = _pages(answers)

        assert (len(facts['pages']), facts['pages_omitted'], len(facts['sections'])) == (25, 2, 27)

    def test_is_empty_without_owned_domains(self):
        assert owned_pages_facts(_cited('openai', FARES, REPORT)) == {
            'pages': [], 'pages_omitted': 0, 'sections': [], 'engines': [], 'document_citations': 0, 'page_citations': 0,
        }
