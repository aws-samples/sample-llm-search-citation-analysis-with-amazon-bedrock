"""Tests for the ``/citations`` aggregation and the entry views of ``shared.citation_pages``."""

from __future__ import annotations

from shared.citation_pages import (
    DICT_VIEW,
    CitationQuery,
    EntryView,
    aggregate_citations,
    tracked_brand_terms,
)

_BRANDS = tracked_brand_terms({'tracked_brands': {
    'first_party': [{'name': 'Meliá', 'aliases': ['melia']}],
    'competitors': ['nh-hotels'],
}})

_ROWS = [
    {'keyword': 'hotels', 'normalized_url': 'https://melia.example/a', 'citation_count': 3, 'citing_providers': ['openai']},
    {'keyword': 'spa', 'normalized_url': 'https://melia.example/a', 'citation_count': 2, 'citing_providers': ['gemini', 'openai']},
    {'keyword': 'spa', 'normalized_url': 'https://nh-hotels.example/b', 'citation_count': 4, 'citing_providers': ['claude']},
    {'keyword': 'spa', 'normalized_url': 'https://other.example/c', 'citation_count': 1, 'citing_providers': []},
    {'keyword': 'spa', 'normalized_url': '', 'citation_count': 9, 'citing_providers': ['openai']},
]

_TUPLE_VIEW: EntryView[tuple] = EntryView(
    url=lambda row: row[0],
    citation_count=lambda row: row[1],
    keyword_count=lambda row: row[2],
    content_type=lambda row: row[3],
    domain=lambda row: row[4],
)


def test_sums_each_urls_citations_under_the_brand_its_url_names():
    aggregate = aggregate_citations(_ROWS, _BRANDS)

    assert aggregate.brand_mentions == {'Meliá': 5, 'nh-hotels': 4, 'Other': 1}


def test_counts_every_row_including_one_without_a_url():
    assert aggregate_citations(_ROWS, _BRANDS).row_count == 5


def test_counts_rows_per_citing_provider():
    assert aggregate_citations(_ROWS, _BRANDS).provider_totals == {'openai': 2, 'gemini': 1, 'claude': 1}


def test_lists_distinct_urls_most_cited_first_with_their_keywords():
    top = aggregate_citations(_ROWS, _BRANDS).top_urls[0]

    assert top == {
        'url': 'https://melia.example/a', 'citation_count': 5, 'by_provider': {'openai': 2, 'gemini': 1},
        'keyword_count': 2, 'keywords': ['hotels', 'spa'], 'content_type': 'page',
    }


def test_totals_carry_every_scope_wide_field_of_a_page():
    totals = aggregate_citations(_ROWS, _BRANDS).totals()

    assert (totals['total_urls'], totals['total_citation_count'], totals['content_type_counts']) == (3, 10, {'video': 0, 'page': 3})


def test_sorts_compact_tuples_exactly_like_dicts():
    entries = aggregate_citations(_ROWS, _BRANDS).top_urls
    tuples = [(e['url'], e['citation_count'], e['keyword_count'], e['content_type'], e['url'].split('/')[2]) for e in entries]
    query = CitationQuery(sort='domain', order='desc')

    assert [row[0] for row in query.apply(tuples, _TUPLE_VIEW)] == [e['url'] for e in query.apply(entries, DICT_VIEW)]

