"""
The site-audit issue types: id, severity, group, title, explanation and how to fix (the user-facing contract).

Severities order ``critical`` < ``warning`` < ``info``. Groups: ``crawl`` (could the page be fetched),
``indexing`` (what search engines are told), ``content`` (titles, descriptions, headings, text, images),
``links`` (internal links and redirects), ``performance`` and ``ai_readiness`` (what answer engines can reach
and read; most of those types live in ``shared.audit_geo_registry``; ``shared.audit_issues`` merges both).

Thresholds: title 10-60 characters, meta description 70-160, thin content under 150 words, slow response over
1,500 ms, deep page at 5+ clicks from the start URL.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from shared.audit_fetch import CRAWLER_NAME

Severity = Literal['critical', 'warning', 'info']
IssueGroup = Literal['crawl', 'indexing', 'content', 'links', 'performance', 'ai_readiness']

SEVERITY_ORDER: dict[str, int] = {'critical': 0, 'warning': 1, 'info': 2}
GROUPS: tuple[IssueGroup, ...] = ('crawl', 'indexing', 'content', 'links', 'performance', 'ai_readiness')

TITLE_MAX_CHARS = 60
TITLE_MIN_CHARS = 10
META_DESCRIPTION_MAX_CHARS = 160
META_DESCRIPTION_MIN_CHARS = 70
THIN_CONTENT_WORDS = 150
SLOW_RESPONSE_MS = 1_500
DEEP_PAGE_DEPTH = 5


@dataclass(frozen=True)
class IssueType:
    severity: Severity
    group: IssueGroup
    title: str
    explanation: str
    how_to_fix: str


_ALLOW_CRAWLER = (
    f'If you own this site, allow the "{CRAWLER_NAME}" user agent in your firewall or bot-protection settings '
    f'(for example a rule that skips bot protection when the user agent contains "{CRAWLER_NAME}"), then re-run '
    'the audit.'
)

SEO_ISSUE_TYPES: dict[str, IssueType] = {
    'blocked-page': IssueType(
        'critical', 'crawl', 'Crawler was blocked',
        'The site returned a bot challenge or access denial (for example a challenge page or a 403) instead of the '
        'page. It is reported as a block rather than as a broken page, but this page could not be audited, and '
        'other crawlers such as search engines may face the same friction.',
        _ALLOW_CRAWLER,
    ),
    'javascript-rendering-suspected': IssueType(
        'warning', 'ai_readiness', 'Content may require JavaScript',
        "The page's HTML contains a JavaScript app container with very little readable content and no headings, "
        'links or images. The content is probably built in the browser, and answer-engine crawlers generally read '
        'the HTML without running JavaScript. Content checks were skipped because this HTML does not represent '
        'the complete page.',
        'Serve the important content and navigation in the initial HTML with server-side rendering or '
        'prerendering. This warning does not prove that search engines cannot index the page.',
    ),
    'rate-limited-page': IssueType(
        'warning', 'crawl', 'Rate limited (429)',
        'The server answered 429 Too Many Requests, so this page could not be audited. The crawler waits and '
        'retries when the requested pause fits within the audit time limit.',
        f'Raise the rate limit for crawlers, or exempt the "{CRAWLER_NAME}" user agent from your rate-limiting '
        'rules, then re-run the audit. Re-running with fewer pages also helps when the limit is strict.',
    ),
    'crawl-rate-limited': IssueType(
        'warning', 'crawl', 'Crawl stopped early: rate limit',
        'The site asked the crawler to wait longer than the audit allows, so it stopped requesting pages. This '
        'report is incomplete; URLs that were not fetched are not recorded as broken or rate limited.',
        f'Re-run the audit after the rate limit resets, or exempt the "{CRAWLER_NAME}" crawler from it.',
    ),
    'server-error': IssueType(
        'critical', 'crawl', 'Server error (5xx)',
        'The page returned a 5xx server error. Search engines that keep seeing server errors crawl the site less '
        'and may drop the page from the index.',
        'Check the server logs for this URL and fix the underlying error. If the page is gone, return a 404/410 or '
        'redirect it to a relevant page instead of erroring.',
    ),
    'broken-internal-link': IssueType(
        'critical', 'links', 'Broken internal link',
        'This page links to an internal URL that returns an error status (4xx/5xx). Broken links waste crawl '
        'budget, leak link equity and frustrate users.',
        'Point the link at the correct live URL, or remove it. If the target moved, link directly to the new URL '
        'rather than relying on a redirect.',
    ),
    'missing-title': IssueType(
        'critical', 'content', 'Missing title tag',
        'The page has no <title>. The title is the strongest on-page relevance signal and the headline shown in '
        'search results; without it search engines write one themselves, usually badly.',
        "Add a unique, descriptive <title> of roughly 50-60 characters that includes the page's primary topic.",
    ),
    'broken-page': IssueType(
        'warning', 'crawl', 'Page returns an error (4xx)',
        'This crawled URL returned a client error (for example 404). If your sitemap or other pages reference it, '
        'crawlers keep wasting requests on it.',
        'If the page should exist, restore it. If it is gone on purpose, remove it from the sitemap and internal '
        'links, and consider a 301 redirect to the closest live page.',
    ),
    'duplicate-title': IssueType(
        'warning', 'content', 'Duplicate title',
        'Several pages share the same title. Search engines use titles to tell pages apart; duplicates make pages '
        'compete with each other and lower click-through rates.',
        'Write a unique title for each page. For templated pages, put the distinguishing attribute (name, '
        'category, location) in the template.',
    ),
    'duplicate-meta-description': IssueType(
        'warning', 'content', 'Duplicate meta description',
        'Several pages share the same meta description, so search results show identical snippets and users '
        'cannot tell the pages apart.',
        'Write a unique meta description per page, or remove the duplicated one: a snippet generated from the '
        'page content beats a wrong duplicate.',
    ),
    'duplicate-content': IssueType(
        'warning', 'content', 'Duplicate page content',
        'Two or more URLs serve identical visible text. Search engines index one version and ignore the rest, and '
        'ranking signals are split across the duplicates.',
        'Pick the canonical URL, add rel=canonical from the others and 301-redirect duplicates where possible '
        '(common causes: trailing-slash variants, URL parameters, http/https or www variants).',
    ),
    'missing-meta-description': IssueType(
        'warning', 'content', 'Missing meta description',
        'The page has no meta description. Search engines assemble a snippet from the page text, which is often '
        'less compelling.',
        'Add a meta description of roughly 70-160 characters that summarizes the page and gives a reason to click.',
    ),
    'missing-h1': IssueType(
        'warning', 'content', 'Missing H1 heading',
        'The page has no H1. The H1 tells users and search engines what the page is about.',
        "Add a single H1 that states the page's main topic, consistent with the title.",
    ),
    'multiple-h1': IssueType(
        'warning', 'content', 'Multiple H1 headings',
        'The page has more than one H1, which dilutes the main-topic signal and usually points to a template '
        'mistake (for example a logo and a headline both marked up as H1).',
        'Keep one H1 for the main heading and demote the others to H2/H3 (or plain elements for logos).',
    ),
    'redirect-chain': IssueType(
        'warning', 'links', 'Redirect chain',
        'Reaching the final page takes two or more consecutive redirects. Each hop adds latency, leaks link equity '
        'and uses crawl budget; long chains may not be followed at all.',
        'Point the first URL (and every internal link) straight at the final destination, so there is at most one '
        'redirect.',
    ),
    'redirect-loop': IssueType(
        'warning', 'links', 'Redirect loop',
        'This redirect eventually points back to itself, so the URL never resolves. Browsers and crawlers give up '
        'with an error.',
        'Trace the redirect rules for this URL and break the cycle so the chain ends at a real 200 page.',
    ),
    'canonical-conflict': IssueType(
        'warning', 'indexing', 'Conflicting canonical signals',
        'The page declares different canonical URLs in its HTML <link rel=canonical> and its HTTP Link header. '
        'When the signals conflict, search engines ignore both and choose their own.',
        'Declare one canonical URL in exactly one place (the HTML head is the most common) and remove or align '
        'the other.',
    ),
    'thin-content': IssueType(
        'warning', 'content', 'Thin content',
        'The page has very little visible text. Thin pages rarely rank or get cited, and can drag down how the '
        'whole site is assessed.',
        'Expand the page with genuinely useful content, noindex it, or merge it into a stronger page. If the '
        'content exists but is rendered by JavaScript, serve it in the initial HTML.',
    ),
    'images-missing-alt': IssueType(
        'warning', 'content', 'Images missing alt text',
        'One or more images have no alt attribute. Alt text is an accessibility requirement and the main way '
        'search engines understand images.',
        'Add descriptive alt text to meaningful images; use an empty alt (alt="") only for decorative ones.',
    ),
    'orphan-page': IssueType(
        'warning', 'links', 'Orphan page',
        'No crawled page links to this URL; it was only found through the sitemap. Pages without internal links '
        'get little crawl attention and no internal link equity, and users cannot reach them by browsing.',
        'Link to this page from relevant pages (navigation, related content, hub pages), or remove it from the '
        'sitemap if it should not be indexed.',
    ),
    'no-outgoing-links': IssueType(
        'warning', 'links', 'Page has no outgoing links',
        'The page contains no links at all: a dead end for link equity, crawlers and users.',
        'Add links to related pages, the parent category or the homepage. If the navigation is rendered by '
        'JavaScript, make sure it is also in the initial HTML.',
    ),
    'title-too-long': IssueType(
        'info', 'content', 'Title too long',
        'The title is longer than about 60 characters, so search results truncate it.',
        'Shorten the title to roughly 50-60 characters, with the most important words first.',
    ),
    'title-too-short': IssueType(
        'info', 'content', 'Title too short',
        'The title is shorter than about 10 characters, usually too generic to describe the page.',
        'Expand the title into a descriptive phrase (roughly 30-60 characters) that says what the page offers.',
    ),
    'meta-description-too-long': IssueType(
        'info', 'content', 'Meta description too long',
        'The meta description is longer than about 160 characters, so search engines truncate the snippet.',
        'Trim the description to roughly 70-160 characters, keeping the core message.',
    ),
    'meta-description-too-short': IssueType(
        'info', 'content', 'Meta description too short',
        'The meta description is shorter than about 70 characters. It wastes snippet space, and search engines '
        'often replace it with text from the page.',
        'Expand the description to roughly 70-160 characters that summarize the page.',
    ),
    'heading-order-skip': IssueType(
        'info', 'content', 'Heading levels skip',
        'The heading hierarchy skips levels (for example an H4 straight after an H2), which weakens the document '
        'structure for accessibility tools and content parsers.',
        'Adjust heading levels so they descend one step at a time (H1, H2, H3).',
    ),
    'slow-response': IssueType(
        'info', 'performance', 'Slow server response',
        'The response took more than 1.5 seconds. A slow time to first byte drags down every later performance '
        'metric and lowers the crawl rate of large sites.',
        'Look at server and database time and caching for this route; cached or statically generated HTML usually '
        'fixes it.',
    ),
    'noindex-page': IssueType(
        'info', 'indexing', 'Page is noindex',
        'The page asks search engines not to index it (robots meta tag or X-Robots-Tag header). That is often '
        'intentional; this is a heads-up, not an error.',
        'If this page should rank, remove the noindex directive. If it is intentional (admin, thank-you or filter '
        'pages), nothing needs to change.',
    ),
    'canonicalized-page': IssueType(
        'info', 'indexing', 'Canonicalized to another URL',
        'The page declares a different URL as its canonical, telling search engines to index that URL instead. '
        'Fine when intentional (parameter pages, syndication); a problem if this page was meant to rank.',
        'If this page should rank on its own, make its canonical point to itself. Otherwise nothing needs to '
        'change.',
    ),
    'deep-page': IssueType(
        'info', 'links', 'Page is deep in the site structure',
        'The page is 5 or more clicks from the start page. Deep pages are crawled less often and receive less '
        'link equity.',
        'Link to it from higher-level pages (hubs, category pages, navigation) to shorten the path.',
    ),
}
