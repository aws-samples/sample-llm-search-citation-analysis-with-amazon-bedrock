"""Regression tests: citation URLs must match the deduplication key form.

bugs.md 1.1 — ``clean_url`` (search) and ``normalize_url`` (deduplication)
had drifted, so the same citation could be stored in two different forms
across the SearchResults and Citations tables.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from api_clients import clean_url
from shared.utils import normalize_url


@pytest.mark.parametrize(
    ('url', 'expected'),
    [
        pytest.param(
            'https://example.com/reviews?ref=newsletter',
            'https://example.com/reviews',
            id='strips-ref-tracking-param',
        ),
        pytest.param(
            'https://example.com/reviews?source=chatgpt',
            'https://example.com/reviews',
            id='strips-source-tracking-param',
        ),
        pytest.param(
            'https://example.com/guide#top-picks',
            'https://example.com/guide',
            id='drops-fragment',
        ),
        pytest.param(
            'https://example.com/list?page=2&utm_source=ai',
            'https://example.com/list?page=2',
            id='keeps-meaningful-params-while-stripping-utm',
        ),
    ],
)
def test_returns_deduplication_key_form_when_url_has_tracking_noise(url, expected):
    assert clean_url(url) == expected


@pytest.mark.parametrize(
    'url',
    [
        pytest.param('https://example.com/a?ref=x&b=2#frag', id='tracking-and-fragment'),
        pytest.param('https://example.com/plain', id='already-canonical'),
        pytest.param('https://example.com/?utm_source=&keep=', id='blank-query-values'),
        pytest.param('not a url', id='unparseable-text'),
    ],
)
def test_matches_shared_normalizer_for_every_citation_input(url):
    assert clean_url(url) == normalize_url(url)
