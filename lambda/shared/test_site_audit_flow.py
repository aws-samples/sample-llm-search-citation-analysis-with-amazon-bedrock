"""A whole audit against a fake site: discovery, chunked crawl and the closing checks."""

from __future__ import annotations

from shared.audit_fetch import RawResponse
from testing.site_audit_fixtures import (
    AUDIT_ID,
    SITE,
    FakeSite,
    html_page,
    html_response,
    redirect,
    run_audit,
    text_response,
)

ROBOTS_OPEN = text_response('User-agent: *\nAllow: /\n')


def site_with(pages: dict[str, RawResponse], robots: RawResponse = ROBOTS_OPEN, **extra: RawResponse) -> FakeSite:
    responses: dict[str, RawResponse | list[RawResponse]] = {f'{SITE}/robots.txt': robots, **extra}
    responses.update({f'{SITE}{path}': response for path, response in pages.items()})
    return FakeSite(responses)


HOME = html_response(html_page(body='<h1>Home</h1>' + ' word' * 200 + '<a href="/a">A</a><a href="/missing">M</a>'))
PAGE_A = html_response(html_page('Example Air page A title', body='<h1>A</h1>' + ' text' * 200 + '<a href="/">Home</a>'))


def test_links_are_followed_from_the_start_page():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))

    assert sorted(store.pages_by_url) == [f'{SITE}/', f'{SITE}/a', f'{SITE}/missing']


def test_a_link_to_a_missing_page_is_a_broken_internal_link():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))

    assert store.issue_pages('broken-internal-link') == [f'{SITE}/']


def test_the_audit_completes_with_a_summary():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))
    audit = store.audits[AUDIT_ID]

    assert (audit['status'], audit['pages_crawled'], audit['summary']['counts_by_severity']['critical']) == (
        'completed', 3, 1,
    )


def test_apex_start_url_is_anchored_on_the_www_host_it_redirects_to():
    site = site_with({'/': HOME, '/a': PAGE_A}, **{'https://example.com/': redirect(f'{SITE}/')})
    store = run_audit(site, start_url='https://example.com/')

    assert store.audits[AUDIT_ID]['origin'] == SITE


def test_robots_disallowed_pages_are_not_crawled():
    robots = text_response('User-agent: *\nDisallow: /a\n')
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}, robots))

    assert f'{SITE}/a' not in store.pages_by_url


def test_the_audit_crawler_group_wins_over_the_wildcard():
    robots = text_response('User-agent: *\nDisallow: /\n\nUser-agent: CitationAnalysisAudit\nAllow: /\n')
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}, robots))

    assert f'{SITE}/a' in store.pages_by_url


def test_unreachable_robots_stops_the_crawl_and_is_reported():
    site = site_with({'/': HOME}, RawResponse(503, {'content-type': 'text/plain'}, b''))
    store = run_audit(site)

    assert (store.pages_by_url, store.issue_types()) == ({}, ['robots-unreachable'])


def test_sitemap_urls_are_crawled_and_an_unlinked_one_is_an_orphan():
    sitemap = text_response(f'<urlset><url><loc>{SITE}/lonely</loc></url></urlset>', content_type='application/xml')
    lonely = html_response(html_page('Example Air lonely page', body='<h1>L</h1>' + ' x' * 200 + '<a href="/">H</a>'))
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A, '/lonely': lonely, '/sitemap.xml': sitemap}))

    assert store.issue_pages('orphan-page') == [f'{SITE}/lonely']


WIDE_HOME = html_response(html_page(body='<h1>Home</h1>' + ' word' * 200
                                      + ''.join(f'<a href="/p{index}">p</a>' for index in range(20))))


def test_max_pages_caps_the_crawl():
    store = run_audit(site_with({'/': WIDE_HOME}), max_pages=5)

    assert len(store.pages_by_url) == 5


def test_orphans_are_not_judged_when_max_pages_stops_the_crawl():
    store = run_audit(site_with({'/': WIDE_HOME}), max_pages=5)

    assert store.issue_pages('orphan-page') == []


def test_redirect_hops_are_pages_and_a_chain_is_reported():
    home = html_response(html_page(body='<h1>Home</h1>' + ' word' * 200 + '<a href="/old">old</a>'))
    store = run_audit(site_with({'/': home, '/old': redirect('/older'), '/older': redirect('/a'), '/a': PAGE_A}))

    assert store.issue_pages('redirect-chain') == [f'{SITE}/old']


def test_a_redirect_off_site_is_not_followed():
    home = html_response(html_page(body='<h1>Home</h1>' + ' word' * 200 + '<a href="/out">out</a>'))
    site = site_with({'/': home, '/out': redirect('https://acme.example.org/')})
    run_audit(site)

    assert 'https://acme.example.org/' not in site.requests


def test_repeated_429s_stop_the_crawl_and_report_it():
    limited = RawResponse(429, {'retry-after': '1'}, b'')
    home = html_response(html_page(body='<h1>Home</h1>' + ' word' * 200 + '<a href="/a">a</a>'))
    store = run_audit(site_with({'/': home, '/a': limited}))

    assert 'crawl-rate-limited' in store.issue_types()


def test_ai_crawler_access_is_recorded_for_the_panel():
    robots = text_response('User-agent: GPTBot\nDisallow: /\n')
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}, robots))
    bots = {bot['token']: bot['access'] for bot in store.audits[AUDIT_ID]['ai_readiness']['bots']}

    assert (bots['GPTBot'], bots['OAI-SearchBot']) == ('blocked', 'allowed')


def test_llms_txt_absence_is_reported_as_informational():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))

    assert store.audits[AUDIT_ID]['ai_readiness']['llms_txt'] == 'missing'


def test_link_graph_summary_counts_pages_and_edges():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))

    assert store.link_summary == {'pages': 3, 'edges': 3, 'pages_with_truncated_links': 0, 'orphan_check': True}


def test_page_html_is_never_stored():
    store = run_audit(site_with({'/': HOME, '/a': PAGE_A}))

    assert not any('<html' in str(value) for page in store.pages_by_url.values() for value in page.values())
