"""
The "AI readiness" issue types: can answer engines (ChatGPT search, Claude, Perplexity, Google AI Overviews,
Copilot) reach, read and quote the site?

* robots.txt access per AI crawler group (search bots, user-triggered fetchers, training bots), and a
  robots.txt that is unreachable (crawlers then treat the whole site as disallowed);
* page directives that keep text out of AI answers (``nosnippet``, ``max-snippet:0``) or hide a page from
  Bing (and so from Copilot);
* ``llms.txt`` (informational: no major answer engine documents reading it);
* JSON-LD structured data: invalid blocks, pages without any, the organization entity of the start page and
  its ``sameAs`` links, article and FAQ markup;
* content, metadata, headings and navigation that only appear after JavaScript runs (needs a rendered copy).
"""

from __future__ import annotations

from shared.audit_issue_registry import IssueType

GEO_ISSUE_TYPES: dict[str, IssueType] = {
    'ai-search-bot-blocked': IssueType(
        'critical', 'ai_readiness', 'AI search crawler blocked',
        'robots.txt blocks the home page for at least one search crawler that answer engines rely on (ChatGPT '
        'search, Claude, Perplexity, Google, Bing). Pages it cannot crawl are not shown or cited in those '
        'answers.',
        'Remove the Disallow rule that applies to these crawlers (see the matched rule and line), or add an Allow '
        'rule for them.',
    ),
    'ai-search-bot-partially-blocked': IssueType(
        'warning', 'ai_readiness', 'AI search crawler blocked on some pages',
        'robots.txt blocks some crawled pages for an AI search crawler. Those pages cannot appear in its answers.',
        'Check that the blocked paths are meant to be private; otherwise narrow or remove the Disallow rules.',
    ),
    'ai-user-fetch-blocked': IssueType(
        'warning', 'ai_readiness', 'AI user-triggered fetcher blocked',
        'robots.txt blocks the home page for a fetcher that answer engines use when a user asks about a page '
        '(ChatGPT-User, Claude-User, Perplexity-User). Citations made on demand cannot load the page.',
        'Allow these user agents in robots.txt unless you deliberately want to stop on-demand reads.',
    ),
    'ai-training-bot-blocked': IssueType(
        'info', 'ai_readiness', 'AI training crawler blocked',
        'robots.txt blocks a crawler used to train AI models (GPTBot, ClaudeBot, Google-Extended, '
        'Applebot-Extended, CCBot). That is a legitimate choice; it is listed so the policy is visible.',
        'Nothing to do if this is intentional. Blocking training crawlers does not remove the site from AI search '
        'answers, which use the search crawlers.',
    ),
    'ai-search-blocked-training-allowed': IssueType(
        'warning', 'ai_readiness', 'AI search blocked while training is allowed',
        "robots.txt allows a vendor's training crawler but blocks the same vendor's search crawler: the content "
        'can be used to train models but is not shown or cited in that vendor\'s search answers. This inverted '
        'policy is almost always a mistake.',
        'Allow the search crawler (or block both, if that is the intent).',
    ),
    'robots-unreachable': IssueType(
        'warning', 'ai_readiness', 'robots.txt unreachable',
        'robots.txt answered with a server error or did not answer. Compliant crawlers then treat the whole site '
        'as disallowed until it is reachable again, and this audit did not crawl past it.',
        'Make /robots.txt answer 200 (or 404 if you have no rules); never let it fail with a 5xx.',
    ),
    'ai-snippet-restricted': IssueType(
        'warning', 'ai_readiness', 'Snippets restricted',
        'The page is indexable but sets nosnippet or max-snippet:0 (meta robots or X-Robots-Tag). That keeps its '
        'text out of search snippets and AI Overviews, so it is not quoted in answers.',
        'Remove nosnippet / max-snippet:0 unless the text must not be quoted; use data-nosnippet on specific '
        'passages instead.',
    ),
    'noindex-for-bing': IssueType(
        'warning', 'ai_readiness', 'Hidden from Bing',
        'A bingbot-specific directive sets noindex while the generic robots directives allow indexing, so the page '
        'is hidden from Bing and the answers of Copilot built on it.',
        'Remove the bingbot noindex unless hiding the page from Bing is intended.',
    ),
    'llms-txt-missing': IssueType(
        'info', 'ai_readiness', 'No llms.txt',
        'The site has no /llms.txt. It is a proposed summary file for language models; no major answer engine is '
        'documented as reading it, so its absence has no known effect today.',
        'Optional: publish /llms.txt with an H1 title, a short summary and links to your key pages.',
    ),
    'llms-txt-invalid': IssueType(
        'info', 'ai_readiness', 'llms.txt is not valid',
        '/llms.txt exists but is served as HTML or does not start with an H1 title ("# Name"), as the proposal '
        'requires.',
        'Serve /llms.txt as plain text or Markdown starting with "# <site name>".',
    ),
    'llms-txt-broken-links': IssueType(
        'warning', 'ai_readiness', 'llms.txt links are broken',
        'Some links listed in /llms.txt return an error status, so a reader following them finds nothing.',
        'Update or remove the broken links.',
    ),
    'structured-data-invalid': IssueType(
        'warning', 'ai_readiness', 'Invalid structured data',
        'A JSON-LD block on the page is not valid JSON or contains an object without @type, so search and answer '
        'engines ignore it.',
        'Fix the block (validate it with a structured-data testing tool) so every object declares its @type.',
    ),
    'structured-data-missing': IssueType(
        'info', 'ai_readiness', 'No structured data',
        'The page has no structured data (JSON-LD, microdata or RDFa). Structured data states explicitly what '
        'the page is about, which helps engines identify entities.',
        'Add JSON-LD describing the page (for example Article, Product, Service or FAQPage).',
    ),
    'organization-schema-missing': IssueType(
        'warning', 'ai_readiness', 'No Organization or WebSite markup on the start page',
        'The start page declares neither an Organization (or a subtype such as LocalBusiness) nor a WebSite. That '
        'markup is how engines link the site to the brand as an entity.',
        'Add Organization JSON-LD (name, url, logo, sameAs) to the home page.',
    ),
    'organization-sameas-missing': IssueType(
        'info', 'ai_readiness', 'Organization has no sameAs links',
        'The Organization markup lists no sameAs URLs, the links that tie the brand to its profiles elsewhere '
        '(encyclopedia entry, social profiles) for entity matching.',
        "Add a sameAs array with the brand's official profile URLs.",
    ),
    'article-schema-missing': IssueType(
        'info', 'ai_readiness', 'Article without Article markup',
        'The page looks like an article (og:type=article, or an <article> element with a publication date) but '
        'has no Article, BlogPosting or NewsArticle markup.',
        'Add Article JSON-LD with headline, author and datePublished.',
    ),
    'faq-schema-mismatch': IssueType(
        'info', 'ai_readiness', 'FAQ markup without questions',
        'The page declares an FAQPage whose mainEntity holds no Question, so the markup says nothing.',
        'List each question as a Question with an acceptedAnswer in mainEntity, or remove the FAQPage markup.',
    ),
    'content-requires-javascript': IssueType(
        'warning', 'ai_readiness', 'Content requires JavaScript',
        'The rendered page has at least 150 words, but the HTML before JavaScript has less than half of them (or is '
        'an app shell). Answer-engine crawlers generally read the HTML without running JavaScript.',
        'Server-render or prerender the main content.',
    ),
    'metadata-requires-javascript': IssueType(
        'warning', 'ai_readiness', 'Metadata requires JavaScript',
        'The title, meta description or canonical is missing from the HTML before JavaScript, or differs from the '
        'rendered page. Crawlers that do not run JavaScript see the wrong metadata.',
        'Put the final title, description and canonical in the server-rendered HTML.',
    ),
    'h1-requires-javascript': IssueType(
        'warning', 'ai_readiness', 'H1 requires JavaScript',
        'The rendered page has an H1, but the HTML before JavaScript has none.',
        'Server-render the main heading.',
    ),
    'navigation-requires-javascript': IssueType(
        'warning', 'ai_readiness', 'Navigation requires JavaScript',
        'Most internal links only appear after JavaScript runs, so crawlers that read the HTML cannot discover the '
        'linked pages.',
        'Render navigation links as plain <a href> elements in the initial HTML.',
    ),
}
