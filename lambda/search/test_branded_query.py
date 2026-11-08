"""Whether a query names the tracked brand (``branded_query``): whole words for names, label-guarded domains."""

from __future__ import annotations

import pytest
from branded_query import branded_query_matcher, branded_query_matcher_for, first_party_names

_NAMES = ('Hotel Example', 'Acme', 'C++ Tools')
_DOMAINS = ('example.com',)

#: (query, whether it names a first-party name of ``_NAMES`` or the owned domain, case id).
_QUERIES = [
    ('is hotel example good for families', True, 'name-lower-case'),
    ("Acme's loyalty programme", True, 'name-possessive'),
    ('HOTEL   EXAMPLE reviews', True, 'name-case-and-whitespace'),
    ('best C++ Tools for beginners', True, 'name-with-punctuation'),
    ('(acme) vs others', True, 'name-in-brackets'),
    ('acmeville hotels', False, 'name-prefix-of-a-word'),
    ('myacme rewards', False, 'name-suffix-of-a-word'),
    ('acme_tools review', False, 'name-joined-by-underscore'),
    ('hotel examples near the beach', False, 'name-plural-of-the-last-word'),
    ('reviews of example.com', True, 'domain-bare'),
    ('is www.example.com safe', True, 'domain-www'),
    ('docs.example.com/booking help', True, 'domain-subdomain'),
    ('https://example.com/rooms prices', True, 'domain-url'),
    ('Is it example.com.', True, 'domain-end-of-sentence'),
    ('example.com.evil.test login', False, 'domain-further-labels'),
    ('notexample.com deals', False, 'domain-longer-label'),
    ('my-example.com deals', False, 'domain-hyphenated-label'),
    ('example.community forum', False, 'domain-longer-tld'),
    ('', False, 'empty-query'),
]

#: (names, query, expected, case id): Unicode names folded like the query.
_UNICODE_QUERIES = [
    (['Café Coruña'], 'opiniones del cafe coruna', True, 'accents-dropped'),
    (['Café'], 'le cafe\u0301 du port', True, 'combining-accent'),
    (['Отель Пример'], 'отзывы отель пример москва', True, 'cyrillic-name'),
    (['Пример'], 'примерно лучший отель', False, 'cyrillic-inside-a-word'),
    (['A'], 'a good hotel', False, 'one-letter-name-ignored'),
]


@pytest.mark.parametrize(('query', 'expected'), [case[:2] for case in _QUERIES], ids=[case[2] for case in _QUERIES])
def test_marks_a_query_branded_only_when_it_names_a_brand_word_or_an_owned_domain(query, expected):
    assert branded_query_matcher(_NAMES, _DOMAINS)(query) is expected


@pytest.mark.parametrize(
    ('names', 'query', 'expected'), [case[:3] for case in _UNICODE_QUERIES], ids=[case[3] for case in _UNICODE_QUERIES],
)
def test_matches_unicode_names_as_whole_words_across_accents_and_scripts(names, query, expected):
    assert branded_query_matcher(names, [])(query) is expected


class TestConfiguration:
    def test_reads_the_first_party_names_of_a_brand_config(self):
        config = {'tracked_brands': {'first_party': ['Acme', 7, 'Acme Rewards'], 'competitors': ['Rival']}}

        assert first_party_names(config) == ['Acme', 'Acme Rewards']

    def test_matches_nothing_without_names_or_domains(self):
        assert branded_query_matcher_for({})('Acme example.com') is False

    def test_matches_the_owned_domains_of_a_brand_config(self):
        assert branded_query_matcher_for({'first_party_domains': ['https://www.Example.org/']})('example.org prices') is True

    def test_does_not_match_a_competitor_name(self):
        config = {'tracked_brands': {'first_party': ['Acme'], 'competitors': ['Rival']}}

        assert branded_query_matcher_for(config)('is rival any good') is False
