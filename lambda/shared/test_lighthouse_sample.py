"""Which audit pages a Lighthouse batch measures (``shared.lighthouse_sample``)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from shared.lighthouse_sample import canonical_url_key, is_measurable, select_sample, url_template

SITE = 'https://www.example.com'


def _page(path: str, *, status: int = 200, fetch_class: str = 'ok', is_html: bool = True) -> dict:
    return {'url': f'{SITE}{path}', 'status': Decimal(status), 'fetch_class': fetch_class, 'is_html': is_html}


@pytest.mark.parametrize(('path', 'expected'), [
    ('/products/12345', '/products/:id'),
    ('/orders/0b9c3f2e-1d4a-4c1b-9f00-123456789abc', '/orders/:uuid'),
    ('/news/2026-10-02/launch', '/news/:date/launch'),
    ('/blog/my-first-post', '/blog/:slug'),
    ('/my-account/settings', '/my-account/settings'),
    ('/', '/'),
])
def test_url_template_replaces_segments_that_look_like_values(path, expected):
    assert url_template(path) == expected


def test_canonical_key_ignores_scheme_www_fragment_and_query_order():
    assert canonical_url_key('http://www.Example.com/a?b=2&a=1#top') == canonical_url_key('https://example.com/a?a=1&b=2')


def test_canonical_key_keeps_the_trailing_slash_unless_asked():
    assert (canonical_url_key(f'{SITE}/a/'), canonical_url_key(f'{SITE}/a/', strip_trailing_slash=True)) == (
        'https://example.com/a/', 'https://example.com/a')


@pytest.mark.parametrize('page', [
    _page('/blocked', fetch_class='blocked'),
    _page('/gone', status=404),
    _page('/moved', status=301),
    _page('/file.pdf', is_html=False),
])
def test_pages_that_did_not_load_cleanly_as_html_are_not_measured(page):
    assert is_measurable(page) is False


def test_the_start_page_comes_first_even_when_crawled_later():
    pages = [_page('/about'), _page('/')]

    assert select_sample(pages, f'{SITE}/') == [f'{SITE}/', f'{SITE}/about']


def test_the_exact_start_page_wins_over_its_trailing_slash_twin():
    pages = [_page('/home'), _page('/home/')]

    assert select_sample(pages, f'{SITE}/home/')[0] == f'{SITE}/home/'


def test_a_start_page_crawled_only_without_its_trailing_slash_still_counts():
    assert select_sample([_page('/about'), _page('/home')], f'{SITE}/home/')[0] == f'{SITE}/home'


def test_one_page_is_kept_per_url_template():
    pages = [_page('/'), _page('/blog/first-great-post'), _page('/blog/second-great-post'), _page('/products/1'),
             _page('/products/2')]

    assert select_sample(pages, f'{SITE}/') == [f'{SITE}/', f'{SITE}/blog/first-great-post', f'{SITE}/products/1']


def test_the_sample_stops_at_ten_pages():
    pages = [_page('/'), *(_page(f'/section-{index}') for index in range(15))]

    assert len(select_sample(pages, f'{SITE}/')) == 10


def test_a_sample_without_a_measurable_start_page_still_lists_the_other_templates():
    pages = [_page('/', fetch_class='blocked'), _page('/about')]

    assert select_sample(pages, f'{SITE}/') == [f'{SITE}/about']
