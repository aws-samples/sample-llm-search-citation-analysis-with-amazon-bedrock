"""Single-page issue checks (``shared.audit_page_checks``)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from shared.audit_page import analyze_page
from shared.audit_page_checks import CrawledPage, page_issues
from shared.audit_structured import read_json_ld
from testing.site_audit_fixtures import html_page

URL = 'https://www.example.com/page'


def crawled(html: str = '', *, status: int = 200, fetch_class: str = 'ok', **overrides) -> CrawledPage:
    facts = analyze_page(html or html_page(), URL)
    page = CrawledPage(url=URL, status=status, fetch_class=fetch_class, response_ms=200,
                       content_type='text/html', depth=1, facts=facts, structured=read_json_ld(facts.json_ld))
    return replace(page, **overrides)


def types_of(page: CrawledPage) -> list[str]:
    return [issue.issue_type for issue in page_issues(page)]


def test_a_complete_page_has_no_issues():
    assert types_of(crawled()) == []


@pytest.mark.parametrize(('fetch_class', 'expected'), [
    ('blocked', ['blocked-page']), ('rate_limited', ['rate-limited-page']), ('error', []),
])
def test_an_unreadable_fetch_stops_with_its_own_issue(fetch_class, expected):
    assert types_of(crawled(fetch_class=fetch_class, status=403)) == expected


@pytest.mark.parametrize(('status', 'expected'), [(500, ['server-error']), (404, ['broken-page']), (301, [])])
def test_error_and_redirect_statuses_stop_after_their_status_issue(status, expected):
    assert types_of(crawled(status=status)) == expected


def test_slow_response_is_reported_for_a_non_html_answer():
    assert types_of(crawled(content_type='application/pdf', response_ms=1_600)) == ['slow-response']


def test_title_checks_are_mutually_exclusive_and_missing_wins():
    page = crawled(html_page(title=''))

    assert [kind for kind in types_of(page) if kind.startswith(('missing-title', 'title-'))] == ['missing-title']


@pytest.mark.parametrize(('title', 'expected'), [('x' * 61, 'title-too-long'), ('Short', 'title-too-short')])
def test_title_length_thresholds_are_ten_and_sixty(title, expected):
    assert expected in types_of(crawled(html_page(title=title)))


@pytest.mark.parametrize(('description', 'expected'), [
    ('', 'missing-meta-description'), ('d' * 161, 'meta-description-too-long'), ('too short', 'meta-description-too-short'),
])
def test_meta_description_thresholds_are_seventy_and_one_sixty(description, expected):
    assert expected in types_of(crawled(html_page(description=description)))


def test_multiple_h1_and_heading_skip_are_reported():
    page = crawled(html_page(body='<h1>A</h1><h1>B</h1><h4>C</h4><a href="/x">x</a>' + ' word' * 200))

    assert {'multiple-h1', 'heading-order-skip'} <= set(types_of(page))


def test_thin_content_is_under_one_hundred_fifty_words():
    page = crawled(html_page(body='<h1>A</h1><a href="/x">x</a>' + ' word' * 140))

    assert 'thin-content' in types_of(page)


def test_noindex_page_is_not_reported_as_thin():
    page = crawled(html_page(body='<h1>A</h1>', head='<meta name="robots" content="noindex">'))

    assert ('noindex-page' in types_of(page), 'thin-content' in types_of(page)) == (True, False)


def test_canonical_conflict_and_canonicalized_page_are_reported():
    page = crawled(html_page(head='<link rel="canonical" href="https://www.example.com/a">'),
                   header_canonical='https://www.example.com/b')

    assert {'canonical-conflict', 'canonicalized-page'} <= set(types_of(page))


def test_deep_page_starts_at_depth_five():
    assert ['deep-page'] == [kind for kind in types_of(crawled(depth=5)) if kind == 'deep-page']


def test_javascript_shell_skips_the_content_checks():
    shell = '<html><head><script src="/a.js"></script></head><body><div id="app"></div></body></html>'

    assert types_of(crawled(shell)) == ['javascript-rendering-suspected']


def test_snippet_restriction_is_an_ai_readiness_issue_on_an_indexable_page():
    page = crawled(html_page(), x_robots_tag='max-snippet: 0')

    assert 'ai-snippet-restricted' in types_of(page)


def test_bing_only_noindex_is_reported():
    page = crawled(html_page(head='<meta name="bingbot" content="noindex">'))

    assert 'noindex-for-bing' in types_of(page)


def test_missing_structured_data_is_reported_on_an_indexable_page():
    html = '<html><head><title>Example Air flights</title></head><body><h1>A</h1><a href="/x">x</a>' + ' w' * 160
    assert 'structured-data-missing' in types_of(crawled(html))


def test_article_without_article_markup_is_reported():
    page = crawled(html_page(head='<meta property="og:type" content="article">'))

    assert 'article-schema-missing' in types_of(page)


def test_faq_without_questions_is_reported():
    page = crawled(html_page(head='<script type="application/ld+json">{"@type": "FAQPage", "mainEntity": []}</script>'))

    assert 'faq-schema-mismatch' in types_of(page)


def test_rendered_copy_with_more_content_reports_javascript_dependence():
    raw = analyze_page('<html><body><div id="root"></div><script src="/a.js"></script></body></html>', URL)
    rendered = analyze_page(html_page(), URL)
    page = replace(crawled(), facts=raw, rendered=rendered)

    assert {'content-requires-javascript', 'h1-requires-javascript', 'metadata-requires-javascript'} <= set(types_of(page))
