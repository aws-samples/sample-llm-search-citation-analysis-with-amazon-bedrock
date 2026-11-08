"""robots.txt per RFC 9309 (``shared.audit_robots``) and sitemap reading (``shared.audit_sitemaps``)."""

from __future__ import annotations

import pytest

from shared.audit_robots import RobotsRule, evaluate, parse_robots, policy_for
from shared.audit_sitemaps import looks_like_sitemap, parse_sitemap

ROBOTS = """
User-agent: *
Disallow: /private/
Allow: /private/press/

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: OAI-SearchBot
Disallow: /*.pdf$

Sitemap: https://www.example.com/sitemap-pages.xml
"""


@pytest.mark.parametrize(('token', 'path', 'allowed'), [
    ('*', '/private/x', False),
    ('*', '/private/press/a', True),
    ('*', '/public', True),
    ('GPTBot', '/anything', False),
    ('ccbot', '/', False),
    ('OAI-SearchBot', '/report.pdf', False),
    ('OAI-SearchBot', '/report.pdf?x=1', True),
    ('OAI-SearchBot', '/private/x', True),
    ('Bingbot', '/private/x', False),
])
def test_rules_resolve_by_group_and_longest_match(token, path, allowed):
    assert evaluate(parse_robots(ROBOTS), token, path).allowed is allowed


def test_an_equal_length_tie_goes_to_allow():
    robots = parse_robots('User-agent: *\nDisallow: /page\nAllow: /page\n')

    assert evaluate(robots, '*', '/page').allowed


def test_groups_naming_the_same_token_are_merged():
    robots = parse_robots('User-agent: Googlebot\nDisallow: /a\n\nUser-agent: googlebot/2.1\nDisallow: /b\n')

    assert [evaluate(robots, 'Googlebot', path).allowed for path in ('/a', '/b', '/c')] == [False, False, True]


def test_percent_encoding_is_normalized_on_both_sides():
    robots = parse_robots('User-agent: *\nDisallow: /caf%C3%A9\n')

    assert not evaluate(robots, '*', '/café').allowed


def test_an_empty_disallow_allows_everything():
    robots = parse_robots('User-agent: *\nDisallow:\n')

    assert evaluate(robots, '*', '/x').allowed


def test_the_matched_rule_carries_its_line_number():
    verdict = evaluate(parse_robots(ROBOTS), 'GPTBot', '/')

    assert verdict.rule == RobotsRule(allow=False, pattern='/', line=8)


def test_sitemap_lines_are_collected():
    assert parse_robots(ROBOTS).sitemaps == ('https://www.example.com/sitemap-pages.xml',)


@pytest.mark.parametrize(('status', 'kind'), [(200, 'parsed'), (404, 'allow_all'), (410, 'allow_all'),
                                              (500, 'disallow_all'), (503, 'disallow_all'), (0, 'disallow_all'),
                                              (429, 'disallow_all')])
def test_fetch_status_decides_the_policy(status, kind):
    assert policy_for(status, '').kind == kind


def test_robots_txt_itself_is_always_allowed():
    assert policy_for(503, '').verdict('*', '/robots.txt').allowed


def test_the_audit_crawler_uses_its_own_group_before_the_wildcard():
    policy = policy_for(200, 'User-agent: *\nDisallow: /\n\nUser-agent: CitationAnalysisAudit\nAllow: /\n')

    assert policy.allows(('CitationAnalysisAudit',), '/page')


URLSET = """<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.example.com/a?x=1&amp;y=2</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc><![CDATA[https://www.example.com/b]]></loc></url>
  <url><loc>  </loc></url>
</urlset>"""


def test_urlset_locations_are_entity_decoded_and_blank_ones_dropped():
    assert parse_sitemap(URLSET).locations == ('https://www.example.com/a?x=1&y=2', 'https://www.example.com/b')


def test_sitemap_index_is_recognised():
    body = '<sm:sitemapindex xmlns:sm="x"><sm:sitemap><sm:loc>https://www.example.com/s1.xml</sm:loc></sm:sitemap></sm:sitemapindex>'

    assert (parse_sitemap(body).kind, parse_sitemap(body).locations) == ('index', ('https://www.example.com/s1.xml',))


def test_entities_declared_in_the_document_are_never_expanded():
    body = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "https://evil.example.org/">]><urlset><url><loc>&e;</loc></url></urlset>'

    assert parse_sitemap(body).locations == ('&e;',)


@pytest.mark.parametrize(('content_type', 'body', 'expected'), [
    ('application/xml', '', True),
    ('text/plain', '\ufeff  <?xml version="1.0"?><urlset/>', True),
    ('text/html', '<html><body>sitemap</body></html>', False),
])
def test_a_sitemap_is_recognised_by_content_type_or_first_element(content_type, body, expected):
    assert looks_like_sitemap(content_type, body) is expected
