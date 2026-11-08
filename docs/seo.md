# SEO

The SEO features put Google organic data next to the AI-visibility numbers: where you rank, what a domain ranks
for, who links to it, how a business shows on Google Maps, and whether your site is technically fit for search
engines and answer engines. Search data comes from [DataForSEO](https://dataforseo.com/), a pay-per-use API.

Everything lives in its own stack, `CitationAnalysisSeoStack` (`lib/seo-stack.ts`), with its own API
(`CitationAnalysis-SeoApi`, Cognito-protected, routes under `/api/seo/`), so it can be deployed and removed without
touching the main stack. It imports only the user pool and the `CitationAnalysis-CorsOrigin` export from
`CitationAnalysisStack`; the [README](../README.md#stacks-and-deploy-order) lists the five stacks and their deploy
order.

## Where to find it

The sidebar's **SEO** section opens `/seo`. The page is laid out like Settings: a section list on the left (Overview,
then **Research**: Domain Overview, Backlinks; **Your site**: Rank Tracking, Site Audit, Performance, Local SEO; a
scrollable row on phones) and the open page on the right. The overview has one card per page and, when
something is missing, the setup step to do next. Each page has its own URL (`/seo/<page>`), so it can be bookmarked
and the browser's back button works.

| Page | Path | What it does | Details |
|---|---|---|---|
| Rank Tracking | `/seo/rank-tracking` | Google positions of a domain (from Settings › Brand Tracking) for the Settings keywords of the header market or of one keyword group, desktop and/or mobile, checked on a schedule or on demand, with history and the position distribution per check. Admins create trackers, add and remove keywords and start checks. | [seo-rank-tracking.md](seo-rank-tracking.md) |
| Domain Overview | `/seo/domain` | Organic traffic estimate, ranking keywords, top pages and Google competitors of any domain; traffic snapshots of your and your competitors' domains, run by a schedule on Operations › Schedule. | [seo-domain.md](seo-domain.md) |
| Backlinks | `/seo/backlinks` | Links pointing to a domain, subdomain, subfolder or page: referring domains, anchors, new and lost links, authority over time. | [seo-backlinks.md](seo-backlinks.md) |
| Local SEO | `/seo/local` | Google Maps and Local Finder results, Google Business Profiles (reviews, questions, posts) and a local rank grid around a point. | [seo-local.md](seo-local.md) |
| Site Audit | `/seo/site-audit` | Crawls your own site and lists technical SEO issues and AI-readiness checks per page. | [seo-site-audit.md](seo-site-audit.md) |
| Performance | `/seo/performance` | Lighthouse scores and Core Web Vitals of your pages, and IndexNow submissions of changed URLs. | [seo-performance.md](seo-performance.md) |

Elsewhere in the dashboard:

- **Keyword Explorer** (Keyword Research › Keyword Explorer): keyword ideas for a seed in the header market with
  search volume, 12-month trend, keyword difficulty, CPC, competition and intent; filters, Export all (from the
  cached answer, on the server), the Google
  results page of a keyword (top 20, or 50 on request) and "Track keywords" into a keyword group. Every national
  research stores its rows' metrics in `CitationAnalysis-SeoKeywordMetrics`, so tracking adds no cost. "Use a tracked
  keyword" fills the seed with one of the header market's Settings keywords (no lookup until Search).
- **Google AI Overviews** as an answer engine in every analysis run: the AI Overview of the Google results page for
  the plain keyword (one search per keyword per run, whatever the personas). A page without an overview is *no
  answer* and counts in no KPI; the same call records the organic top 10.
- **SEO vs GEO report** (`/reports/seo-geo`) and the custom report blocks *SEO vs GEO quadrants* and *SEO vs GEO
  table*: organic position against AI mention rate per keyword. Definitions: [seo-metrics.md](seo-metrics.md).
- **Action Center**: the SEO recommendations (for example "ranks on Google but AI answers rarely name you") are
  listed with the answer-based ones, marked **SEO**, and their status is tracked the same way. If the SEO API cannot
  be reached, the answer-based recommendations still show.
- **Dashboard**: two cards, *SEO vs GEO* (keywords per quadrant) and *Rankings* (tracked keywords in Google's top 3
  and top 10 at each tracker's newest check). Both are free reads of stored data; the dashboard never starts a paid
  call.
- **MCP tools**: free reads of the stored SEO data (`get_keyword_metrics`, `get_seo_geo_comparison`,
  `get_seo_recommendations`, `get_rank_tracking`, `get_domain_snapshots`, `get_backlink_snapshots`,
  `get_site_audits`, `get_local_job`) and the paid lookups and jobs behind an estimate and a confirmation token
  (`estimate_seo_*`, `run_seo_*`, `start_seo_job`). See [mcp.md](mcp.md).

The header market selector applies to every SEO page: lookups run in the selected market (the global market when
every market is combined).

## Setup

1. Create a DataForSEO account and open **API Access** in its dashboard (https://app.dataforseo.com/api-access) for
   the API login and password. New accounts get $1 of free credit.
2. Deploy: `npm run deploy` deploys every stack together, the SEO stack and the Google AI Overviews engine
   included. The analysis workflow always has the engine's branch (it calls
   `CitationAnalysis-Search-google_ai_overview` by name); the engine is off until step 5, so it makes no paid call before then.
3. Rebuild the dashboard (`./scripts/build-web.sh` reads `SeoApiUrl` into `VITE_SEO_API_URL`). Without the SEO stack
   the SEO pages say "SEO data is not set up" and the SEO overview says the stack is not deployed.
4. As an Admin, open **Settings › AI Providers › SEO data › DataForSEO**, enter the login and password and save. The
   login is checked with DataForSEO's free account endpoint, which also shows the balance on the card. The secret is
   stored as `citation-analysis/dataforseo-key`. Until then the SEO overview shows a "Set up SEO data" panel.
5. Switch on **Google AI Overviews** in Settings › AI Providers. It uses the DataForSEO login and has no key of its own.
   It stays off until you do, even with the login saved, because it bills one DataForSEO call per keyword and run.

## Who can do what

Every signed-in user can read every SEO page and run one-off lookups (a domain overview, a backlinks table, a
results page, a business profile). Anything that creates, changes, deletes or schedules recurring paid work (rank
trackers and their keywords, snapshot schedules, site audits, batches) is for Admins.

Each user may make at most 100 paid DataForSEO calls per UTC day for one-off lookups. An Admin changes the number in
**Settings › AI Providers › SEO data** (`0` turns paid lookups off). It is one limit for every client: the dashboard, a
script on the REST API, AI assistants through MCP and the server exports all go through `CitationAnalysis-SeoRouter`,
which counts each billed DataForSEO call (a lookup that makes three calls uses three; a cached answer uses none).
The call that would pass the limit is not sent, and the request answers 429 `DAILY_LIMIT`. A paid lookup whose
billed work the SEO jobs Lambda does later (a local rank grid: one task per grid point; a single Lighthouse run:
one call) counts those calls when it is started, all at once, and is not started when they do not fit. A job that then
fails to start gives its calls back, since nothing was billed. `GET /api/seo/daily-calls`
answers your calls today, the limit and when it resets. Every paid lookup writes an audit record (who, which route,
how it ended, how many calls) to `CitationAnalysis-McpState`, kept 365 days, and so does an Admin's change to the
limit. That table belongs to the MCP stack, which `npm run deploy` deploys with the others; without it the
records are not written (each failed write is logged). SEO jobs an Admin starts (rank checks,
snapshots, site audits, Lighthouse batches) are not counted here: each is confirmed with its price. A paid
snapshot schedule can only be saved enabled, or run now, with `confirm_paid: true` (the dashboard sends it after
its confirmation).

## Prices

DataForSEO bills per call; your account is billed directly. The figures below are list prices the code estimates
with; check DataForSEO's own pricing for current values. Each page's document has its full table.

| Area | Typical cost |
|---|---|
| Keyword research, Labs countries (auto mode: two calls of half the result limit each) | $0.012 + $0.00012 per row per call; ×2 with clickstream data |
| Keyword research, Google-Ads-only countries | $0.09 per call |
| Keyword metrics (up to 700 keywords per call) | $0.012 + $0.00012 per keyword (Labs) or $0.09 (Google Ads) |
| Google results page (SERP panel) | $0.002 for the first 10 results + $0.0015 per further 10; ×5 for search operators |
| Google AI Overviews (per keyword per run) | $0.004 ($0.002 when no overview loads) |
| Rank Tracking, per keyword and device | $0.002 live (manual), $0.0006 queued (scheduled), + per extra page of results |
| Domain Overview | about $0.03 per analysis; $0.144 per traffic snapshot |
| Backlinks | about $0.06 per domain overview; about $0.03 per 100-row table page |
| Local SEO | $0.002 per Maps results page; $0.0054 per business profile; $0.0012 per rank-grid point |
| Site Audit | free (no DataForSEO call) |
| Performance | see [seo-performance.md](seo-performance.md) |
| Account balance, SEO vs GEO, recommendations, stored results | free |

How spending is kept in check (there are no spend caps):

- Paid lookups run only when you press the button; opening a page, switching tabs or focusing a field costs nothing.
- Batch and recurring work (rank checks and schedules, snapshots, audits, the rank grid, Lighthouse batches) asks
  for confirmation first, naming the paid calls it starts when the count is known.
- The dashboard shows no prices, except in the paid export dialog: no cost captions, estimates or charged amounts
  on the SEO screens, the Keyword Explorer or the SEO vs GEO report. The figures in these docs are for reference;
  the DataForSEO card in Settings › AI Providers shows the account balance.
- Answers are cached (keyword research 24 h, a seed with no ideas 1 h, results pages and domain lookups 12 h,
  backlinks 6 h), so a repeat is free until the entry expires; an empty answer never replaces cached data.
- DataForSEO bills a call when it is made, so a billed call that timed out or failed is never re-sent automatically,
  and every call is cut off before the API's 29-second limit.
- Scheduled work uses DataForSEO's queued mode, which costs less than live calls.

The SEO API's stage throttle (20 requests a second) is the only rate limit.

## Exports

Every SEO table exports as Excel or CSV through the dashboard's server export service (2.45.0); nothing is built in
the browser, and the file appears on the Exports page (kept 7 days). The export worker reads the rows by invoking
the SEO router, `CitationAnalysis-SeoRouter`, by name, so SEO exports need this stack deployed.

- **Stored data, free:** SEO vs GEO (keywords and traffic share), a rank tracker's results, a finished or cancelled
  site audit, a Lighthouse result, Domain Overview traffic snapshots.
- **Cached answers, free:** Local SEO (businesses, local results, a finished rank grid), the Keyword Explorer and the
  SERP competitors read cache-only forms of their routes. When the answer has left the cache, the export fails with a "no longer cached" message (search again, then
  export) instead of paying.
- **Paged from DataForSEO, priced:** Domain Overview keywords and pages, and the three Backlinks tables. The export
  dialog asks how many rows (up to 10,000) and shows the price; the server refuses an export without that
  confirmation or at a different price, reads 1,000-row windows, and re-reads a window it already paid for only from
  the cache, so no window is billed twice. "Export the N rows on screen (free)" exports the cached page.

## Markets

A market's country maps to DataForSEO's location code and its language to a language DataForSEO serves for that
country (`lambda/shared/dataforseo_locations.py`); the global market asks the United States in English. Keyword
difficulty and intent are not available in the 49 countries DataForSEO serves only through Google Ads data. A market
DataForSEO does not serve answers `UNSUPPORTED_MARKET` before any paid call.

## See also

- [seo-metrics.md](seo-metrics.md): definitions of the SEO vs GEO metrics and quadrants.
- [geo-corrections.md](geo-corrections.md): why some AI-visibility figures changed when cited sources, empty
  replies and branded queries started being treated differently.

## Data

The SEO stack's tables (keys, contents, which items expire) and the `seo` bucket's key layout are listed in the
README, "Data".
