# Domain Overview, estimated traffic snapshots and SEO recommendations

The Domain Overview page (SEO › Domain Overview, `/seo/domain`) shows a domain's organic Google keywords, estimated
traffic, top pages and SERP competitors from DataForSEO Labs. This page also covers the scheduled traffic snapshots of
your and your competitors' domains, and the SEO recommendations built on them.

## Domain Overview

What any domain ranks for on Google in the header market, from DataForSEO Labs. Enter a domain or URL and a
scope, then **Analyze**.

The page starts from Settings › Brand tracking: with the input empty, the button reads **Analyze &lt;own domain&gt;**
(the first owned domain; nothing is fetched until it is clicked), and the own and competitor domains are quick picks.
Without an owned domain the page links to Settings › Brand tracking.

| Scope | Covers | Example |
|---|---|---|
| Subdomains (default for a bare domain) | The domain and every subdomain | `*.example.com/*` |
| Domain | The host only, without subdomains | `example.com/*` |
| Subfolder (default when the input has a path) | The path and everything under it (`/blog` covers `/blog/post`, not `/blogging`) | `example.com/blog/*` |
| Exact URL | One page | `example.com/pricing` |

- **Overview**: organic keywords (top 100), estimated organic traffic per month, its value as Google Ads clicks,
  and keywords per position bucket (1, 2-3, 4-10, 11-20, 21-50, 51-100). The overview is always domain-wide (the
  host and its subdomains), whatever the scope; the page says so for a narrower scope.
- **Top keywords**: paged (50 or 100 rows), sorted (estimated traffic by default, rank, volume, CPC, difficulty)
  and filtered by DataForSEO. "Rank" is the absolute rank (every results-page element counted). "Intent" is
  DataForSEO's main search intent of the keyword (informational, commercial, transactional, navigational, or
  unknown when it names none), one chip tone per intent.
- **Top pages**: loaded with "Load top pages"; sorted by estimated traffic or keyword count.
- **SERP competitors**: the domains ranking on the keywords on screen, by visibility ("Find SERP competitors").

**Filters.** DataForSEO accepts at most 8 filter conditions per request: each include/exclude term, each min/max
bound, the keyword search (2: keyword or URL), the page search (1), and the scope itself (Domain 1 for keywords /
2 for pages, Subfolder and Exact URL 4). Over the budget, Apply is disabled and the API refuses the request; it
never silently drops a filter. Terms split on `,` or `+`.

**Markets.** Labs covers its own countries only. A Google-Ads-only market is refused before any call ("DataForSEO
does not serve this market"): DataForSEO would bill and fail it.

**Targets.** A host with characters outside `a-z 0-9 . -` (such as `my_site.com`), without a dot, with a numeric or
one-letter top-level label, an IP address or a URL with a login is refused before any call, for the same reason.

## Prices and caching

| Action | DataForSEO calls | About |
|---|---|---|
| Analyze | overview (1 row) + first keyword page (50 rows) | $0.012 + $0.018 |
| A keyword or page page | one Labs call at the page size | $0.018 (50) / $0.024 (100) |
| SERP competitors | one Labs call (50 rows) | $0.018 |
| Snapshot (Admin, or per domain x market on each scheduled run) | overview + 1,000 ranked keywords | $0.144 |
| Export to Excel (keywords or pages) | one Labs call per 1,000 rows, up to 10,000 rows | $0.132 per 1,000 rows |

Every lookup is cached 12 hours (a repeat is free and is marked "Cached" or "From cache (refreshes every 12 hours)"); keyword pages cached before 2.43.0
(without intent) are not reused. An empty overview is never cached, so
a transient empty answer does not stick; an empty page never replaces a cached page with rows. No paid call is
ever re-sent automatically: DataForSEO bills at request time. Nothing is fetched on page load.

## Estimated traffic snapshots

Snapshots run from a **Domain traffic snapshots** schedule (paid) on Operations > Schedule, daily, weekly or monthly
at the time and zone the Admin picks; saving an enabled one asks first and names its paid calls (two per domain and market). Each
run snapshots every domain in Brand tracking (your domains and your competitors' domains; a domain covered by
another as its subdomain once) in the global market and every configured market Labs serves, at most 40 domain x
market pairs, two at a time. Nothing runs until such a schedule exists, and a disabled one costs nothing. An Admin
can also snapshot the analyzed domain now from the Domain Overview (a confirmation names its two paid calls, without
a price; at most once per domain and market per hour).

A snapshot stores the overview figures and the top 1,000 ranked keywords by estimated traffic (keyword, organic
position, estimated visits, URL, search volume). The keywords are written once to the SEO bucket
(`citation-analysis-seo-<account>`) under `seo/domain-snapshots/<domain>/<market>/<snapshot time>.json`, so a later
snapshot never overwrites an earlier one. Snapshots are kept, never expired. A failed snapshot does not stop the others and is
never retried. When DataForSEO answers a known domain with nothing, the previous snapshot is kept instead of a
"zero traffic" one.

All traffic figures are **DataForSEO estimates** (search volume x click-through curve by position), never
measured clicks; for your own measured clicks use Search Console.

## SEO vs GEO

The SEO vs GEO report (`/reports/seo-geo`) reads the latest snapshots: each keyword's estimated traffic, a deeper
organic position when the AI Overviews results page has none of your domains in its top 10, and a "share of
estimated search traffic vs share of AI mentions" comparison. Definitions: [seo-metrics.md](seo-metrics.md).

## SEO recommendations

`GET /api/seo/insights` (and the "SEO recommendations" section of the report) turns the SEO vs GEO rows into
Action Center items:

| Type | Priority | When |
|---|---|---|
| AI Overviews leave you out despite a top-3 ranking | high | Google shows an AI Overview, you rank top 3, it does not cite you |
| AI Overviews cite competitors you outrank | high | The AI Overview cites a competitor ranking below you (or outside the top 10) |
| Ranks on Google but AI answers rarely name you | medium | Top 10 on Google, AI mention rate under 50% |
| AI knows you, Google doesn't rank you | medium | AI mention rate 50% or more, not in Google's top 10 |

Each lists up to five keywords (largest search volume first) and their combined search volume. Their ids are the
Action Center's, so a status set in the report (new, in progress, done, won't fix) is stored by the Action Center's
status route.

## Access

Every route needs a signed-in user. Lookups, snapshot history and recommendations are open to every user; taking a
snapshot is Admin only.
