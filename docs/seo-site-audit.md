# Site Audit: technical SEO and AI readiness

The Site Audit page (SEO › Site Audit, `/seo/site-audit`) crawls the brand's own website and reports technical SEO issues and **AI readiness**: whether
answer engines (ChatGPT search, Claude, Perplexity, Google AI Overviews, Copilot) can reach, read and quote it.

## Cost

None beyond AWS: the audit fetches pages with plain HTTP from a Lambda function and calls no paid API (no
DataForSEO, no browser rendering). A 500-page audit is a few hundred small DynamoDB writes and roughly ten
minutes of Lambda time.

## Who can do what

- **Admins** start and cancel audits (SEO › Site Audit). One audit runs at a time.
- **Every signed-in user** reads the audits, their issues and the affected pages, and exports the issue types,
  the affected pages of an issue and the AI crawler access to Excel.

## What is crawled

- The start URL must be on one of the brand's own domains (Settings › Brand tracking › owned domains) or a
  subdomain. The start form offers exactly those domains, the first one preselected; without one it links to
  Settings › Brand tracking instead. An apex domain that redirects to `www` is crawled on `www`.
- The crawler identifies itself as `CitationAnalysisAudit/1.0`, obeys robots.txt (its own
  `User-agent: CitationAnalysisAudit` group if there is one, else `*`) and sends **one request per second**. When
  the site answers 429 it slows down (Retry-After is honoured); after more than three 429s in a row, or 30
  minutes of pauses, it stops and reports *Crawl stopped early: rate limit*.
- Pages come from links (followed from the start page) and from the XML sitemaps listed in robots.txt plus
  `/sitemap.xml` (index depth 3, at most 300 sitemap files, files over 10 MiB skipped).
- Page limit per audit: 100, 500 (default) or 2,000. HTML is read up to 1 MiB per page and never stored; only
  the facts the checks need (title, headings, word count, links, structured-data types, ...) are kept.
- Redirects are not followed automatically: every hop is recorded as its own page, so chains and loops show up.
- A robots.txt that answers with a server error or not at all means "disallow everything" for compliant
  crawlers; the audit then crawls nothing and reports *robots.txt unreachable*.
- Pages are not rendered with JavaScript. A page whose HTML is an empty app container is reported as *Content
  may require JavaScript* and skipped by the content checks.

Results (the audit, its pages, issues and link summary) are kept, never expired; only the crawl's internal URL queue expires, 90 days after it is queued.

## Score

`100 − Σ penalties`, never below 0. Each issue type found costs its severity weight (critical 15, warning 5,
notice 1), half of it for appearing at all and the other half in proportion to the share of crawled pages it
affects. Compare scores of the same site over time rather than across sites.

## Issues

Severity: **Critical**, **Warning**, **Notice**. Groups: Crawlability, Indexing, Content, Links and redirects,
Performance, AI readiness. Each issue type in the dashboard carries its explanation and how to fix it.

| Group | Issues (thresholds) |
|---|---|
| Crawlability | Crawler was blocked; Rate limited (429); Crawl stopped early; Server error (5xx); Page returns 4xx |
| Indexing | Conflicting canonical signals; Page is noindex; Canonicalized to another URL |
| Content | Missing title; Title too long (> 60 chars) / too short (< 10); Missing meta description; Meta description too long (> 160) / too short (< 70); Duplicate title / meta description / content; Missing H1; Multiple H1; Heading levels skip; Thin content (< 150 words); Images missing alt text |
| Links and redirects | Broken internal link; Redirect chain (2+ redirects); Redirect loop; Orphan page; No outgoing links; Deep page (5+ clicks) |
| Performance | Slow server response (> 1.5 s) |
| AI readiness | see below |

Orphan pages are only reported when the crawl finished (no page limit or rate limit hit) and no page was a
JavaScript shell.

## AI readiness

| Check | Severity | Rule |
|---|---|---|
| AI search crawler blocked | Critical | robots.txt blocks `/` for OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot or Bingbot |
| AI search crawler blocked on some pages | Warning | one of those crawlers is blocked on some crawled pages (up to 20 listed) |
| AI user-triggered fetcher blocked | Warning | ChatGPT-User, Claude-User or Perplexity-User blocked on `/` |
| AI training crawler blocked | Notice | GPTBot, ClaudeBot, Google-Extended, Applebot-Extended or CCBot blocked (a legitimate choice) |
| AI search blocked while training is allowed | Warning | a vendor's training crawler allowed but its search crawler blocked |
| robots.txt unreachable | Warning | robots.txt answers 5xx / 429 / not at all |
| Snippets restricted | Warning | an indexable page sets `nosnippet`, `max-snippet:0`, `noai` or `noimageai` (meta robots, googlebot, bingbot or X-Robots-Tag) |
| Hidden from Bing | Warning | a bingbot noindex while the generic directives allow indexing |
| No llms.txt / llms.txt not valid | Notice | `/llms.txt` absent, served as HTML, or without a `# Title` first line. No major answer engine documents reading it |
| llms.txt links are broken | Warning | up to 20 same-site links of llms.txt checked; any answering 400+ |
| Invalid structured data | Warning | a JSON-LD block is not valid JSON or has an object without `@type` |
| No structured data | Notice | an indexable page without JSON-LD, microdata or RDFa |
| No Organization or WebSite markup on the start page | Warning | |
| Organization has no sameAs links | Notice | |
| Article without Article markup | Notice | `og:type=article` (or `<article>` with a publication date) without Article / BlogPosting / NewsArticle |
| FAQ markup without questions | Notice | `FAQPage` whose `mainEntity` holds no Question |
| Content may require JavaScript | Warning | the raw HTML is an app shell |

The panel also lists every AI crawler with its access (allowed, partly blocked, blocked) and the robots.txt
rule and line that decided it. The crawler list is a code constant (`lambda/shared/audit_geo.py`, checked 2026-10)
because these tokens change often.

Four further checks (content, metadata, H1 and navigation that only appear after JavaScript runs) are
implemented but need a rendered copy of the page, which the audit does not make yet.

## Limits and safety

- Requests go only to public addresses on ports 80/443: every name is resolved and checked before connecting,
  the address actually connected to is checked again, internal names and IP literals are refused, and every
  redirect hop is re-validated.
- No cookies or credentials are sent; response bodies are capped (HTML 1 MiB, robots.txt 500 KiB, sitemaps
  10 MiB).
- An audit runs as the Step Functions state machine `CitationAnalysis-SiteAudit` (4-hour limit); its input
  holds the audit id only.
