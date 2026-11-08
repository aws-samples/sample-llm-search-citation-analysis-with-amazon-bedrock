# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version is kept identical in `package.json` and `web/package.json` and is
shown in the dashboard under Settings and the About modal. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-changelog) for the release
process.

## [2.46.0] - 2026-11-08

Google AI Overviews is part of every deployment. `npm run deploy` (`cdk deploy --all`) deploys the SEO stack and
the engine's Lambda with the main stack, and the analysis workflow always has the engine's branch. The
`-c seoEngine=true` flag and the second deploy it needed are gone.

### Upgrade notes

- **Deploy every stack together** (`npm run deploy`). A `seoEngine` value in `cdk.json` or on the command line is
  now ignored, and you can remove it.
- **Nothing paid starts on its own.** Google AI Overviews only runs once the DataForSEO login is saved in Settings
  › AI Providers › SEO data, and only while it is enabled there. Without the login, its function answers no rows.
  If a deployment without the flag already has the DataForSEO login saved, Google AI Overviews is asked in the next
  run, because an engine with no saved setting counts as enabled. Turn it off in Settings first if you don't want
  that.

### Changed

- `lib/constructs/provider-search.ts`: `EXTERNAL_SEARCH_PROVIDERS` (Google AI Overviews) replaces
  `readExternalSearchProviders` and its CDK context flag. The `Search-google_ai_overview` branch catches
  `Lambda.ResourceNotFoundException` into `NotDeployed-google_ai_overview`, which answers no rows. So a main stack
  deployed without the SEO stack runs as before, instead of writing a failed Google row for every keyword. Any
  other failure still becomes the failed provider row, and the branch still never re-runs a billed call.
- README (workflow, deploy order, setup, CDK context table), `docs/seo.md` (Setup) and the architecture diagram
  no longer mention the flag.

## [2.45.2] - 2026-11-08

### Changed

- **Python dependencies** (Dependabot #197–#203, in one change):
  - Crawler layer: bedrock-agentcore 1.23.1 → 1.25.2, playwright 1.63.0 → 1.64.1, websockets 17.1 → 17.4, and
    the bundled boto3/botocore 1.43.98 → 1.43.123 and s3transfer 0.19.2 → 0.19.3. AgentCore 1.25.2 needs
    boto3/botocore ≥ 1.43.115. The layer build's import check asserts the new SDK version.
  - Shared layer: beautifulsoup4 ≥ 4.15.0 and tzdata ≥ 2026.6.
  - The function `requirements.txt` files keep their boto3 floors. These functions run the Lambda runtime's boto3
    (1.42.x on Python 3.12), not a bundled one, and each file now says so.
  - Dev tools: pytest ≥ 9.2.0, hypothesis ≥ 6.170.14, ruff 0.15.11 → 0.17.3, and boto3-stubs 1.43.123.
- Ruff 0.17 adds two checks. Implicitly concatenated strings in a list or tuple are now wrapped in parentheses
  (ISC004). The scope snapshot build logs a skipped builder's error with `logger.error(..., exc_info=error)`,
  because it is not always called inside an `except` block (LOG004). The log line is unchanged.

## [2.45.1] - 2026-11-08

### Fixed

- **A Kiro issue triage reply carries one banner and one footer** (`scripts/kiro-issue/issue.mjs`). Earlier replies
  reached the triager with their banner and footer, and the triager copied them into its answer, so a comment showed
  the banner twice and a second, HTML-escaped footer (`&lt;sub>`). Earlier replies now reach it without that frame,
  and a banner or footer in its answer is dropped before the comment is built.

### Changed

- The tenet 8 gap row in TENETS.md names the export state machine's `WaitForViewJob` wait-and-re-check, tracked in
  [#214](https://github.com/aws-samples/sample-llm-search-citation-analysis-with-amazon-bedrock/issues/214).

## [2.45.0] - 2026-11-08

2.44.0 made KPI history complete, but a scoped view still read at most 100 keywords (`capped_scope`), and several
views read fewer without saying so: Citation Gaps 10 keywords by default, Prompt Insights and the Competitor Gap
report 50, the Action Center 20, content ideas 30. Most exports were built in the browser from the same capped
answers. This release makes every scoped view complete at any scope size, from a precomputed scope snapshot when a
live read would be too large, and moves every Excel and CSV export to a server export service that runs until the
file is written. It includes the fixes from the code review (F1–F13) and the performance review (PERF-1 to PERF-8) of
that work, and the Lambda sizes the owner decided on 2026-11-07.

### Upgrade notes

- **Deploy with one `npm run deploy` (or `cdk deploy --all`).** `CitationAnalysisStack` is updated first. It adds the
  tables `CitationAnalysis-KeywordRunBrands` and `CitationAnalysis-Exports`, the state machines
  `CitationAnalysis-Export` and `CitationAnalysis-ScopeSnapshotBuild`, the functions `CitationAnalysis-ExportWorker`,
  `CitationAnalysis-ScopeSnapshotWorker`, `CitationAnalysis-API-Exports` and `CitationAnalysis-KpiWriteFailureRelay`,
  and the SSM parameters the API stack now reads. `CitationAnalysisApiStack` is updated next and adds the
  `/api/exports` routes. The API URL does not change.
- **`retainLegacyApiStackExports` keeps the old API-stack exports for one release.** In 2.44.0 the API stack imports
  16 CloudFormation exports of the main stack; from 2.45.0 it imports none. The main stack keeps those exports under
  the same names so that this deploy can pass, and the release after 2.45.0 removes them. Deploy 2.45.0 before that
  release. If you deploy the stacks one at a time, deploy `CitationAnalysisStack` first. Details: README, "Upgrading
  from 2.44.0".
- **Run the `latest` backfill once after deploying.** It writes every keyword's `KeywordLatest` object, the input of
  the scope snapshots, then starts a snapshot build. With `chain` it invokes itself again until it is done:

  ```bash
  aws lambda invoke --function-name CitationAnalysis-Deduplication --invocation-type Event \
    --cli-binary-format raw-in-base64-out \
    --payload '{"action":"backfill_keyword_run_kpis","latest":true,"chain":true}' out.json
  ```

  Without it, the first build finds keywords whose newest run has no object, serves their scopes `stale` with
  `coverage.complete: false`, and asks for their backfill itself.
- **SEO exports need the SEO stack.** The export worker invokes `CitationAnalysis-SeoRouter` by name, because the SEO
  stack deploys after the main stack and a reference would be a cycle. Without the SEO stack an SEO export fails with
  a clear error; every other export works.
- **Exports notify in the dashboard only.** Email notification is not built: it would need a verified SES sender.
- **API clients:** a scoped GET can now answer `202 {status: "computing", job, retry_after_ms}`; repeat the same GET
  until it answers 200. A list cursor can answer `400 cursor_expired`; restart the list without `next_token`. The
  group KPI drill-down's `next_token` changed format, so a 2.44.0 offset token answers 400. `/api/brand-mentions` no
  longer takes `export=`; use `POST /api/exports`. Without `brand`, brand appearances come in keyword order (keyword,
  then brand, then row). The MCP tools handle all of this (see Changed).
- **GenerateSummary drops from 3,008 MB to 1,769 MB,** and several API functions change size (see Changed).

### Added

- **Scope snapshots** (`shared/scope_snapshot*.py`, under `scope-snapshots/` in the keywords bucket). One rule in
  `shared/scope_source.py` decides where a scoped view is computed: estimated rows = keywords × (max(1, enabled
  personas) × engines + plain engines) × runs needed. At most `LIVE_ROWS_BUDGET` (8,000 rows) the view is read live,
  exact and complete at request time; one keyword or a `keyword_ids` scope (at most 100) is always live. A larger
  scope is served from the snapshot. The new workflow state `BuildScopeSnapshots` (GenerateSummary action
  `build_scope_snapshots`) builds `all`, every market, and every group or group × market over the live budget after
  each run. Keyword, group, market and promotion writes ask for a rebuild, and a reader that finds the build stale
  does too, at most once per 5 minutes. The build writes `current.json` last and keeps the previous build.
- **KeywordLatest objects:** one per keyword (`scope-snapshots/keywords/<hash>.json.gz`), written by
  DeduplicateCitations next to the KPI row with a conditional PUT. It holds what the keyword adds to any scope: the
  latest and previous runs' counts with every brand, per persona, cited domains, mentions, the sentiment index,
  citation gaps, the prompt classification, recommendation findings, competitor evidence, insight facts, the last 62
  days of runs and row counts. Brand configuration and persona writes start the `latest` backfill, chained, and its
  last pass starts a build.
- **`CitationAnalysis-KeywordRunBrands`** (PK `keyword`, SK `run_timestamp`): the full brand list of a keyword run,
  written only when the run names more brands than the 25 a KeywordRunKpis row keeps. The scope series and the window
  view jobs read it, so brand leaderboards over a period stay exact.
- **Scope series:** one row per run for each built scope, up to 365 runs, updated with each new run and rebuilt in
  full every 7th build as a self-check. Trends and group KPIs over 7, 30, 90, 180 and 365 days come from it.
- **View jobs.** When the snapshot does not hold a view (another number of days, an older run on a large Brand
  Mentions scope, no build yet), the GET answers 202 and GenerateSummary (`view_job`) computes that one view. The same
  GET answers 200 once it is stored; job results under `scope-snapshots/jobs/` expire after 7 days. The dashboard
  polls from 2 s up to 10 s for at most 3 minutes and shows a placeholder with "Computing…". MCP tools return a
  non-error result that says to call again.
- **Cursors over snapshots.** A list page's `next_token` is tied to the snapshot build it came from, or to the scope's
  keyword list for live pages. When that build is gone or the scope changed, the API answers `400 cursor_expired` and
  the dashboard restarts the list.
- **Coverage on every scoped answer:** `coverage` (`keywords_total`, `keywords_analyzed`, `complete`), `source`
  (`live` or `snapshot`), `as_of`, `stale`, `refreshing` and `scope`. `ScopeCoverageNote` shows it on every scoped
  view ("Covers X of Y keywords", a time-budget cut, "figures as of …"). A stale snapshot shows its figures with an
  "Updating…" note and is fetched again every 10 s until it is fresh.
- **Distributed snapshot build,** `CitationAnalysis-ScopeSnapshotBuild` (Standard, 6-hour timeout, every step on
  `CitationAnalysis-ScopeSnapshotWorker`): PlanSnapshotBuild → in parallel FoldUnits → SeriesBatches (each batch
  loops 480 s turns until done) and RollupShards → RollupMerges → PublishSnapshotBuild. The Distributed Maps run 10
  items at a time and every step is idempotent. GenerateSummary starts it when the build needs more than one 450 MB
  unit or Citations holds more than 100,000 rows; one build runs at a time. Smaller tenants still build in process.
  Tests compare the distributed artifacts, `current.json`, series and citation rollup with the in-process build.
- **Server export service.** Routes on the new `CitationAnalysis-API-Exports` Lambda: `POST /api/exports {view,
  params, format}` (202 with the export), `GET /api/exports`, `GET` and `DELETE /api/exports/{id}`, `POST
  /api/exports/{id}/seen`. The Standard state machine `CitationAnalysis-Export` (7-day timeout) runs PrepareExport,
  then ExportChunk until every row is written, then FinalizeExport; any failure goes to MarkExportFailed. Each chunk
  (one ExportWorker invocation) writes rows until 60 s before its 900 s timeout, uploads S3 multipart parts and saves
  a cursor, so an export of any size finishes. Formats: XLSX (streamed ZIP, a new sheet every 1,048,575 rows) or CSV
  (UTF-8 BOM, one file with a `sheet` column when the view has several). Rows come from 36 row sources
  (`EXPORT_VIEWS` in `shared/export_contract.py`) that replay the dashboard's own routes with the view's filters and
  follow every page, so a file holds the whole view.
- **Export storage:** jobs in `CitationAnalysis-Exports` (PK `export_id`, GSI `OwnerCreatedIndex`, TTL `expires_at`)
  and files under `exports/<owner>/<id>/` in the keywords bucket, both kept 7 days. A user has at most 5 exports
  queued or running (one more answers 429) and sees only their own, Admin included.
- **Exports center** (`/exports`, in the sidebar's Data section, with a header badge). Each row shows the view,
  format, status, rows and creation time, with Download (a new link on each click), Cancel or Delete. The list
  survives reloads and is refreshed every 5 s. The badge counts finished exports not seen yet. A toast says when an
  export starts and when it is ready, and an opt-in browser notification does the same while the dashboard is open.
- **"Export all" on every data view** (`ui/ExportAllButton.tsx`, Excel or CSV): the view's full data with its current
  filters, sort, scope and market, every page. Summary widgets that keep a top N link to the full view ("See all").
  Settings lists (keywords, groups, markets, personas, schedules and, for admins, users) export through
  `config-lists`. Views without it: the Raw Responses browser, the Run Analysis monitor, single-record dialogs and
  configuration forms.
- **KPI write-failure alarm** `CitationAnalysis-KeywordRunKpisWriteFailure` (first failure in 5 minutes). The relay
  Lambda `CitationAnalysis-KpiWriteFailureRelay` publishes it to `CitationAnalysis-KpiAlerts`, because CloudWatch
  alarms cannot publish to a topic encrypted with the AWS-managed SNS key.

### Changed

- **The paid export dialog** names the table's own cache window (Backlinks 6 hours, Domain Overview 12): the SEO
  API sends it as `cache_hours` in each answer's `export` pricing. `xlsx-js-style` is no longer a dashboard dependency.
- **Scoped views read every keyword.** `SCOPE_KEYWORDS_CAP` and `capped_scope` are removed; the live path keeps the
  2.42.0 time budget only as a safety net, and a cut sets `keywords_truncated` and `coverage.complete: false`.
  - `/visibility`: keyword rows, brands (`view=brands`) and sources (`view=sources`) are paged.
  - `/visibility/sentiment-examples`: `total` is exact.
  - `/brand-mentions`: the summary keeps 100 brands and pages the rest (`aggregated.brands_total`, `view=brands`);
    appearances have an exact `total_appearances`.
  - `/trends` and `/reports/overview`: `keyword_trends` and `latest_brands` are paged.
  - `/reports/group-kpis`: the summary and drivers are read live or from the snapshot; the keyword drill-down reads
    one page at any group size; `view=runs` lists every run.
  - `/reports/insights`: no keyword cap; every competitor caveat reason is paged (`view=caveat_reasons`).
  - `/reports/competitor`: honours the scope, rolls up every configured competitor and pages outranked keywords and
    outreach targets (`keyword_limit` still works).
  - `/citation-gaps`: `limit` is the page size of `keyword_summaries`; totals count every keyword.
  - `/prompt-insights`: classifies every active keyword from its latest run, with counts per list.
  - `/recommendations`: paged (`limit` 50, at most 200, `total`). The Bedrock prompt names at most 50 keywords,
    chosen by impact, on the first page only.
  - `/content-studio/ideas`: every active keyword, a scope and market, paged (`ideas_next_token`, `ideas_total`).
  - `/alerts`: paged with `next_token` and `total`. `/stats?market_id` reads a large market from the snapshot.
- **GenerateInsights** has no per-group cap (it was 100, silently). A large group reads the snapshot's facts, KPIs
  and 90-day stability.
- **Workflow order:** … → KpiAlerts → BuildScopeSnapshots → GenerateInsights → BuildCitationRollup. A failed snapshot
  build is caught (`BuildScopeSnapshotsFailed`) and the run keeps its report. A tenant with more than 100,000
  Citations rows gets its citation rollup from the distributed build.
- **KpiAlerts** pools each (group, market) snapshot from the run's KeywordRunKpis rows, one BatchGet per 100 keywords.
  A keyword is read from its raw answers only when its row is missing, counted against other owned domains, or may
  have dropped a competitor the pair tracks.
- **Every Excel and CSV export runs on the server,** including every SEO table. The browser Excel generator is gone:
  `exporters/excelGenerator.ts`, `exporters/tableExcel.ts`, `ui/ExportExcelButton.tsx`, the per-view `*Excel.ts`
  builders and the client chunk fetcher of the paid SEO exports. Only Content Studio's DOCX is still built in the
  browser. The per-view `?export=` path of `/brand-mentions` is removed.
- **SEO exports** (row sources S28–S36). Stored data exports for free: SEO vs GEO, rank tracking, site audit,
  Lighthouse, Domain Overview traffic snapshots. The Local SEO, Keyword Explorer and SERP competitors exports read
  cache-only forms of their routes (`GET /api/seo/local/businesses`, `GET /api/seo/local/serp`, `GET
  /api/seo/keywords/research`, SERP competitors with `cached_only`), and fail with a "no longer cached" error instead
  of paying. The new GET forms have no API Gateway method; only the export worker reaches them.
- **Paid SEO exports** (Domain Overview keywords and pages, the three Backlinks tables) keep the row picker and price,
  and add a file format. The server refuses an export without the confirmed row count (1 to 10,000) or with a price
  that differs from its own calculation. It reads 1,000-row windows and cuts the last one to the confirmed count. A
  chunk that resumes inside a window asks it again with `cached_only: true`, and the route answers from the cache or
  409 `NOT_CACHED`, so no window is billed twice. "Export the N rows on screen (free)" exports the cached page.
- **SEO tables share one order with their export.** Rank tracking results and local listings are sorted on the
  route. Keyword Explorer filters run in the browser and on the route, and both pass the same 8 cases
  (`lambda/testing/keyword_explorer_filter_cases.json`). The site audit export puts every issue type's pages in one
  sheet and is offered only for a finished or cancelled audit; `GET /audits/{id}/issues` answers `audit_running`.
- **Lambda sizes (owner decision, 2026-11-07).** 1,769 MB (one vCPU): API-StatsInsights, API-CitationsContent,
  API-GetBrandMentions, ReportInsights, KpiAlerts, ExportWorker (900 s), GenerateSummary (was 3,008 MB) and
  ScopeSnapshotWorker (900 s). 1,024 MB: API-ConfigMgmt, API-ExecutionMgmt, API-ManageBrandConfig (was 256 MB) and
  API-GetPersonaRankings (was 256 MB). 512 MB: API-Health, API-ManageUsers and API-SelfReflection (each was 256 MB),
  API-ContentStudio, Mcp and API-Exports. KpiWriteFailureRelay: 256 MB. Unchanged: API-KeywordMgmt, ParseKeywords,
  Deduplication and Crawler at 1,024 MB.
- **The API stack imports nothing from the main stack.** It builds the function ARNs from their fixed names and reads
  the user pool id, distribution id and dashboard origin from the SSM parameters `/citation-analysis/user-pool-id`,
  `/citation-analysis/web-distribution-id` and `/citation-analysis/cors-origin`, so later main-stack changes cannot be
  blocked by an export in use.
- **MCP:** a 202 becomes a "computing, call again in N s" result, a failed view job an error result, and
  `cursor_expired` tells the model to restart without `next_token`.
- **Replayed onto the SEO release (2.43.0).** These decisions were made while merging:
  - KpiAlerts pools the snapshots from KeywordRunKpis, but reads both runs' raw rows for the like-for-like comparison
    when the pair has a previous snapshot. At very large scale such a pair may therefore be listed under
    `time_budget_scopes`.
  - The Visibility Queries filter (neutral, branded, all) is carried in the scope snapshots, so it works on large
    scopes too.
  - The live-read budget counts Google AI Overviews once per keyword (`PLAIN_ENGINES`), whatever the personas, so at
    10 personas the largest live scope is 97 keywords.
  - A snapshot's `total_crawled` may lag by up to `CRAWLED_RECOUNT_DAYS` (7 days).

### Fixed

- **Replayed onto the final 2.43.0 and 2.44.0.** A filtered (`neutral` / `branded`) visibility view again leaves out a
  run stored before the branded flag (2.43.0): such a run's pool has no filtered slices, since its old rows would
  read as neutral and a delta would compare a filtered run with an unfiltered one. KPI alerts leave a group/market
  pair unevaluated when any of its previous run's reads failed, not only when the deadline ran out (2.44.0 review).
  The backlinks on/off snapshot setting stays removed (2.43.0 moved recurring snapshots to Schedules).
- **Silent caps:** Citation Gaps (10 keywords by default), Prompt Insights (the first 50 keywords, 20 newest rows
  each), the Action Center (the first 20 keywords), the Competitor Gap report (the first 50 keywords, scope ignored),
  content ideas (30 keywords) and GenerateInsights (100 keywords per group) now cover every keyword. The group KPI
  report no longer says "only the first N" when the time budget cut the read.
- **F1:** an export whose row source stopped for time near the deadline was finalised short. A source now says
  whether it finished, and the file is closed only when it did.
- **F2:** a filter that left pages empty could not save progress, so a large export failed as stalled. Empty pages
  now save a cursor.
- **F3:** a snapshot claimed complete coverage for keywords it had not folded (a failed KeywordLatest write). Such
  keywords are now counted as behind, their scopes are served `stale` with `coverage.complete: false`, and the build
  asks for their backfill. The new alarm reports the failed writes.
- **F4:** a missing list key in a route answer was read as an empty list. It now fails the export, unless the list is
  marked optional.
- **F5:** newest-first lists duplicated or skipped rows when rows arrived during an export. The cursor keeps the last
  row's identity and resumes after it.
- **F6:** the 5-running-exports limit was check-then-act. A per-owner slots item is now written in the same
  transaction as the export.
- **F7:** a router timeout plus retries could outrun the chunk's 60 s reserve. A route read starts only while enough
  time remains, and the worker's Lambda client makes one attempt.
- **F8:** a multi-sheet export could mix two snapshot builds. The cursor pins the first build and the export fails
  with "rebuilt while the export ran" if it changes.
- **F9:** cancelling during a chunk left that chunk's checkpoint behind. It is deleted now.
- **F10:** XLSX cut cells over Excel's 32,767 characters without saying so. They now end with a marker, and the
  Exports page shows how many cells were cut; the CSV keeps the full text.
- **F11:** the API stack's imports of main-stack exports could block later main-stack deploys (see Changed).
- **F12:** an export ran with the permissions checked when it was queued. PrepareExport checks the view again and,
  for an Admin-only list, reads the owner's groups from Cognito; a refusal fails the export.
- **F13:** MarkFailed could leave an export `running` if aborting the upload failed. It saves `failed` first.
- **Dashboard:** top movers come from the server's `top_movers`; group drivers and keyword runs follow `next_token`;
  the brand drill-down loads one page per "Load more"; the Content Action Plan joins follow every page.

### Performance

- **PERF-1, PERF-2:** the snapshot build no longer holds every scope at once. Scopes are folded in passes and their
  memory is released once written, and the series is built resumably in turns. Measured at 10x per invocation (5,000
  keywords, 365 runs, 10 personas, tracemalloc): 78 fold units, at most 118 CPU s and 592 MB; series turns at most
  482 CPU s and 606 MB; rollup shards at most 89 CPU s and 108 MB; merges at most 405 MB. The citation rollup in one
  invocation would have needed about 1,400 CPU s and 1.6 GB.
- **PERF-3:** the live window row cap takes half of the memory above the baseline (`WINDOW_MEMORY_SHARE` 0.5, was
  0.75).
- **PERF-4:** window view jobs read only the runs inside their window, not the whole history.
- **PERF-5:** decoded snapshot objects are cached per container (`shared/snapshot_cache.py`, up to 64 MB of JSON), so
  an export paging a large artifact decodes it once.
- **PERF-6:** a KeywordLatest object keeps 62 days of per-run counts and folds older runs into a base count; the
  CrawledContent count is read again at most every 7 days.
- **PERF-7:** DeduplicateCitations writes citations through `shared.bounded_writes.map_writes`, several at a time.
- **PERF-8:** the snapshot artifact registry is imported only when a snapshot is read, which shortens cold starts.

### Security

- Export files are private. A download is a 15-minute presigned URL minted by the Cognito-gated API on each click,
  only for keys under the owner's `exports/<owner>/` prefix; the key is never returned. Another user's export id
  answers 404, Admin included.
- A CSV text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a
  spreadsheet does not run it as a formula.
- The cache-only SEO routes are reachable only by the export worker's direct invoke, never from the network.
- An export's paid SEO reads count against its owner's daily limit (`SEO_PAID_REQUESTS_PER_DAY`), not one shared
  `export-service` counter: the worker's route reads carry the owner in the claim `custom:export_owner`, which the SEO
  router honours only for the export service (`shared/seo_spend_limit.py`).
- No Lambda waits for a view job. A chunk that meets `202 computing` ends and answers `wait_seconds`; the export
  state machine's `WaitForViewJob` state waits that long before the next chunk, and a wait does not count as a stall.
- Custom-report scope blocks show the coverage note (the `/visibility` or `/trends` answer that was cut short or is
  stale, otherwise the complete line).

### Known limits

- **No email notification** for finished exports (in-app only).
- **The first full series build at 10x is long:** about 67 turns of 480 s over 34 batches, with the `all` batch the
  longest (about 11 turns). It repeats on every 7th build. Summing the market series into `all` would not be exact
  for brands (a market row keeps 500 brands, a 10x market run names about 14,700), so it is not done.
- **KpiAlerts at very large scale** may list pairs with a previous snapshot under `time_budget_scopes` (see Changed).
- **Snapshot `total_crawled`** may lag by up to 7 days.
- **An older run on a large Brand Mentions scope** starts one view job per appearances page; use the export instead.
- **Sentiment examples** assume no two keywords differ only in letter case.
- **Runs from before this release** keep at most 3 competitor caveat reasons per keyword.
- **The write-failure alarm** emails the KPI alert subscribers even when alerts are disabled in Settings.
- **`CitationAnalysisMcpStack`** still imports main-stack function ARNs and the user pool.

## [2.44.0] - 2026-11-08

2.42.0 put a time budget on every API request but left three gaps: long KPI windows could come back partial, the main
stack had 499 of CloudFormation's 500 resources, and the toolchain and web majors were deferred. This release moves
the dashboard REST API into its own stack, stores one row of KPI counts per keyword run so history windows are
complete, and takes the majors. It addresses the items 2.42.0 listed under "Not changed / known limits" as follows:

- *minimatch on 10.x, majors deferred:* ESLint 10, TypeScript 6, vitest 5, React 19, Tailwind 4 and jsdom 31 are in
  this release, and so is @vitest/eslint-plugin 1.6.28. minimatch is on the patched 11.x except under nx and
  eslint-plugin-import-x (Security). TypeScript 7 remains blocked upstream (Known limits).
- *Long KPI windows can be partial:* resolved. Trends, overview, group KPIs and insights read per-run KPI rows and
  return whole 365-day windows (`truncated_before: null`).
- *Main stack at 499 of 500 resources:* resolved. The main stack has about 188 resources.
- *Docker branches of the bytecode build untested:* resolved. Both layer builds and the handler bundling fallback were
  run in Docker and give the same bytes as the local path.
- *A run that fails before `BuildCitationRollup` keeps the previous citation rollup:* unchanged; `as_of` still shows
  its age.

### Upgrade notes

Deploying this release changes the dashboard API's URL. Read this before upgrading.

- **The REST API moves to `CitationAnalysisApiStack`** (`lib/api-stack.ts`, routes in `lib/constructs/rest-api.ts`).
  The main stack goes from 499 to about 188 resources; the API stack has about 315.
- **Deploy with one `npm run deploy` (or `cdk deploy --all`).** CDK updates `CitationAnalysisStack` first. Its
  cleanup phase deletes the old API, and only then is `CitationAnalysisApiStack` created. No table, bucket, function,
  user pool or distribution is replaced.
- **The dashboard API is unavailable for a few minutes** between those two steps. The new dashboard shows "The API is
  being updated" and opens by itself once `/config.json` exists. A browser tab still running the old dashboard gets
  errors and must be reloaded.
- **The API URL changes.** The new URL is the `ApiGatewayUrl` output of `CitationAnalysisApiStack`, with the same
  export name, `CitationAnalysis-ApiGatewayUrl`. Update anything outside this repository that pinned the old
  `execute-api` URL (scripts, bookmarks, monitors).
- **The dashboard reads the API URL at run time** from `/config.json`, which the API stack writes into the web bucket.
  `VITE_API_URL` is only used by `npm run dev`. Rebuild `web/dist` with the new `scripts/build-web.sh` before
  deploying: a `web/dist` built by an older script has the old URL built in.
- **If another stack imports `CitationAnalysis-ApiGatewayUrl`,** CloudFormation cannot delete the old export, so the
  main stack update fails and rolls back. Remove the import first, deploy, then import the new export.
- **The MCP server URL does not change.** The MCP server calls the API Lambdas directly.
- **Run the KPI backfill once after deploying,** and again after changing the owned domains. Each call stops before
  its time budget and returns `done` and a `cursor` to resume from:

  ```bash
  aws lambda invoke --function-name CitationAnalysis-Deduplication --cli-binary-format raw-in-base64-out \
    --payload '{"action":"backfill_keyword_run_kpis"}' out.json
  while [ "$(jq -r '.done' out.json)" = "false" ]; do
    aws lambda invoke --function-name CitationAnalysis-Deduplication --cli-binary-format raw-in-base64-out \
      --payload "$(jq -c '{action:"backfill_keyword_run_kpis",cursor:.cursor}' out.json)" out.json
  done
  ```

  The backfill skips runs whose row is current for the owned domains; add `"rebuild": true` to the first payload to
  rewrite every row. Until it has run, runs older than a keyword's first row are read from the raw answers as in
  2.42.0, under the same time budget.

### Changed

- `minimatch` is on the patched 11.x (GHSA-g3hv-75wg-m249, by override) except under `nx` and
  `eslint-plugin-import-x`, lint-time tools that call `makeRe`, which minimatch 11 removed: they keep 10.2.6 (scoped
  overrides) until they support 11. Their glob patterns come from our own config. aws-cdk-lib bundles 10.2.6, which
  no override reaches.
- **Dashboard REST API stack.** The 106 routes are unchanged (method, function, authorizer). The API stack imports the
  fixed-name `CitationAnalysis-API-*` functions by ARN, the user pool, the distribution and the web bucket; the main
  stack imports nothing from it. Each of the 8 router Lambdas gets one wildcard invoke permission (18 permissions,
  as before). `cloudWatchRole` is pinned off, which matches what real synths already produced. Stack specs cap the
  main stack at 350 resources and the API stack at 400.
- **`/config.json`** (`{"apiUrl": "<stage URL>/api"}`) is written by a BucketDeployment in the API stack: no prune,
  retained on delete, served no-cache, invalidated on deploy. The dashboard loads it before the app (`main.tsx`
  imports `App` after `loadRuntimeConfig`), treats CloudFront's `index.html` fallback as missing and retries every
  15 s. `build-web.sh` no longer builds the URL in; both `s3 sync --delete` calls exclude `config.json`;
  `deploy.sh` checks the API stack.
- **KPI rows per keyword run** (table `CitationAnalysis-KeywordRunKpis`, PK `keyword`, SK `run_timestamp`, no TTL,
  in the main stack). DeduplicateCitations writes one row of additive counts per keyword and run
  (`shared/kpi_tally.py`, `shared/keyword_run_kpis.py`), about 3 KB each. A failed write logs, emits the EMF metric
  `KpiRollup/KeywordRunKpisWriteFailure` and never fails the keyword. API-StatsInsights and ReportInsights read the
  table. The KPI definitions are unchanged: property tests prove the pooled counts equal `brand_kpis` (share of voice,
  position, visibility, citations), `brand_table` and `run_models`. A row keeps at most 25 brands: every first-party
  brand, every tracked competitor, then the most visible. Share of voice still divides by every sighting.
- **Deduplication: 256 MB / 120 s → 1,024 MB / 300 s,** because the rollup and the backfill deserialize whole
  SearchResults partitions. New environment variables: `DYNAMODB_TABLE_KEYWORD_RUN_KPIS`,
  `DYNAMODB_TABLE_SEARCH_RESULTS`, `DYNAMODB_TABLE_BRAND_CONFIG`, `DYNAMODB_TABLE_KEYWORDS`.
- **Root toolchain.** TypeScript 6.0.3 (tsconfig lists `types: ["node"]`, since TS 6 defaults `types` to `[]`; `lib`
  ES2021). ESLint 10.14 with eslint-plugin-sonarjs 4.2.2, eslint-plugin-unicorn 79, @nx/eslint-plugin 24.0.4,
  @vitest/eslint-plugin 1.6.28 and @eslint/js 10 (the @nx flat configs require it and ESLint 10 no longer bundles it).
  vitest 5.1 and @types/node 22: vitest 5 needs Node `^22.12`, unicorn and @vitest/eslint-plugin need Node 22, and
  the repository's only Node Lambda runtime is `NODEJS_22_X`, so Node 22.12 is the toolchain floor.
- **ESLint plugin forks.** eslint-plugin-import 2.32.0, eslint-plugin-react 7.37.5 and eslint-plugin-jsx-a11y 6.10.2
  support ESLint up to 9; the ESLint 10 PRs (jsx-eslint/eslint-plugin-react#4022,
  jsx-eslint/eslint-plugin-jsx-a11y#1081) are not released. They are replaced by eslint-plugin-import-x 4.17.1,
  eslint-plugin-react-x 5.28.8 and eslint-plugin-jsx-a11y-x 0.2.0, with the same rule names. A probe file gave the
  same 8 errors before and after; react-x `no-array-index-key` flags a superset of the original's cases. The custom
  rules in `.eslint-rules/` use `context.filename`.
- **New sonarjs 4 and unicorn 79 findings are fixed** (`replaceAll` in `python-bytecode.ts`, a redundant optional in
  `api/reports.ts`, four spec groups merged into `it.each`, a float compared with `toBeCloseTo`).
- **Web majors.** TypeScript 6.0.3, React 19.3.1 (`RefObject<X | null>` props, `JSX` from `react`, `SubmitEvent` for
  form submits; StrictMode specs use RTL's `reactStrictMode`, because a wrapper-level StrictMode no longer replays
  effects in React 19), vitest 5.1, jsdom 31 and jest-dom 7.
- **Tailwind CSS 4.3.4** through `@tailwindcss/vite` (postcss, autoprefixer and `tailwind.config.js` removed). The
  look is preserved: the v3 hex palette and sans font stack are pinned in `web/src/palette.css`, the Amplify UI and
  custom CSS sit in cascade layers that keep v3's order, v3 `space-y`/`space-x` selectors and preflight details
  (field background, `td` padding, button cursor, dialog margin) are restored. Computed styles of 2,172 class strings
  in light and dark mode match the 2.42.0 build except for equivalent notations. One visible change:
  `dark:contrast-95`, which v3 never generated, now applies as `docs/design-system.md` documents, so dark-mode
  screenshots have 5% less contrast.

### Fixed

- **History windows are complete.** `shared/scoped_reports.load_window_runs` reads the KPI rows first, reads runs
  older than a keyword's first row from the raw answers, and recounts a row counted against other owned domains. The
  2.42.0 deadline rules still apply to the raw reads. API response shapes are unchanged; long windows now answer
  `truncated_before: null`. KpiAlerts reads only the finished run and is unchanged.
- **The visibility score adds position weights as exact integers** (`position_points`); float sums depended on the
  order answers were added in. The weights are the same.
- **Python bytecode is the same on every host.** Every `.pyc` recorded its build path as `co_filename` (`/tree/...` in
  Docker, the host path for pip, a temp dir or `/asset-output` for handlers), so no two hosts built the same bytes.
  Layers now compile with `-d /opt/python` and handlers with `-d /var/task`. pip's console scripts (`python/bin`) are
  removed. Runtime behavior was not affected.
- **The Docker build paths are tested.** Shared layer in the Lambda 3.12 image: x86-64 extensions, a current `.pyc`
  for all 208 modules, identical trees across builds and identical bytecode to the pip branch (only 2 `RECORD` files
  differ). Crawler layer: 873 modules, 7 x86-64 extensions, 186 of 250 MB. Handler bundling without a local 3.12
  gives the same 60 files (sha256, mode, uid) as the local path. A read-only import test loads every module from our
  `.pyc` and attempts no writes.
- **`scripts/verify-python-artifacts.sh`** runs after every compile in both branches of both layer builds. It fails on
  a missing or stale `.pyc`, timestamp or other-version bytecode, a recorded build path, or a non-x86-64 `.so`.

### Performance

- **History windows from KPI rows:** with 100 keywords × 365 runs, `/api/trends` and `/api/reports/group-kpis` return
  the whole window in about 2 s with no SearchResults reads. Worst case (25 brands per row, loaded host): decode
  2.8 s, trend 1.6 s, group 1.9 s.
- **Bytecode cold-start saving, measured.** This corrects 2.42.0's estimate of about 1.5–3 s per cold start at
  256 MB. In the Lambda image, our `.pyc` save 120–150 ms CPU per router under amd64 emulation (about 25%), which is
  about 80–100 ms per router natively, or about 0.5 s at 256 MB.

### Security

- **npm audit:** root 21 → 28 moderate, web 3 moderate, no high or critical. Every entry is minimatch
  GHSA-g3hv-75wg-m249; the new root entries are the new ESLint plugins that depend on minimatch.
- **minimatch 11 where it can run.** minimatch 11 exports no `makeRe`. nx 24 calls `minimatch.makeRe` and
  eslint-plugin-import-x 4.17.1 imports it, so those two keep 10.2.6 by scoped override; everything else resolves the
  patched 11.x. aws-cdk-lib bundles minimatch 10.2.6, which an override cannot reach. Dev-only: the glob patterns come
  from our own config.

### Known limits

- **TypeScript 7** is blocked upstream: typescript-eslint 8.72.1 peers `typescript >=4.8.4 <6.1.0`.
- **minimatch 11** cannot reach nx, eslint-plugin-import-x or the copy aws-cdk-lib bundles (see Security).
- **The ESLint plugin forks** stay until eslint-plugin-react and eslint-plugin-jsx-a11y release ESLint 10 support
  (#4022, #1081).
- **@xstate/react 3.2.2** (through @aws-amplify/ui-react 6.15.7, which declares React 19) peers React ≤18. npm warns;
  the sign-in page renders identically.
- **KPI history leaderboards** (`brand_trends`, `latest_brands`) see at most 25 brands per keyword run (first-party
  and tracked competitors always kept); `brands_truncated` in `/api/trends` and the overview says when a run was cut,
  and the Competitor Benchmark shows it. There is no per-persona split of the KPI rows.
- **A missing KPI row** (failed write, or a keyword whose Deduplication step never ran) leaves that run out of history
  until the backfill runs again; the write-failure metric flags it. After an owned-domain change, windows are read
  raw, within the time budget, until the backfill runs again.
- A `space-y-N` value not listed in `web/src/index.css` gets Tailwind 4 spacing.

## [2.43.0] - 2026-11-08

### Added

- **SEO stack** (`CitationAnalysisSeoStack`, `lib/seo-stack.ts`): Google organic data from DataForSEO next to the
  AI-visibility numbers, behind its own Cognito-protected API (`CitationAnalysis-SeoApi`, routes under `/api/seo/`,
  one router Lambda `CitationAnalysis-SeoRouter` plus a jobs Lambda for work longer than an API call). A separate
  stack because the main stack is at the 500-resource limit; it builds its own shared layer and imports only the
  user pool and the CloudFront origin. Nothing paid runs on page load: every DataForSEO call follows a click, batch
  or recurring spend asks for confirmation with the price first, billed calls and timeouts are never re-sent, and
  answers are cached (a cached non-empty answer is never replaced by an empty one). Creating, scheduling or
  starting recurring paid work is for Admins; one-off lookups are open to every signed-in user. Setup, pages and
  prices: [docs/seo.md](docs/seo.md).
  - **DataForSEO client** (`shared/dataforseo_client.py`): Basic auth from `citation-analysis/dataforseo-key`
    (`login:password`), one deadline per call capped by the Lambda's remaining time, server errors retried only on
    idempotent reads; DataForSEO's in-body status codes become typed errors and a billed failure keeps its cost.
    Queued tasks (`shared/dataforseo_tasks.py`) for scheduled work at the cheaper queue price.
  - **Keyword Explorer** (Keyword Research › Keyword Explorer): keyword ideas for a seed in the header market with
    volume, trend, difficulty, CPC, competition and intent; filters, CSV export with a formula-injection guard, the
    Google results page of a keyword (top 20 or 50) and *Track keywords* into a keyword group. Every national
    research stores its rows' metrics (`CitationAnalysis-SeoKeywordMetrics`), so tracking costs nothing extra.
  - **SEO vs GEO report** (`/reports/seo-geo`, custom report blocks *SEO vs GEO quadrants* and *SEO vs GEO table*):
    per keyword and market, your organic position next to the AI mention rate, AI Overview presence and citation
    overlap, in four quadrants; plus the ranked position from rank tracking or traffic snapshots when the results
    page has none of your domains, estimated traffic per keyword, and share of estimated search traffic against
    share of AI mentions. Definitions: [docs/seo-metrics.md](docs/seo-metrics.md).
  - **Rank Tracking** (`/seo/rank-tracking`): Google positions of a domain for up to 1,000 keywords per tracker,
    desktop and/or mobile, top 10 to 100, daily, weekly, monthly or manual; organic positions only, subdomains
    match. A suspicious miss or drop is re-checked up to twice through the queue, and a keyword that ranked before
    shows *Not found (unconfirmed)* until a second check confirms it. History and the position distribution per
    check. [docs/seo-rank-tracking.md](docs/seo-rank-tracking.md).
  - **Domain Overview and estimated traffic** (`/seo/domain`): organic keywords, estimated traffic and its value,
    position buckets, top keywords and pages and SERP competitors of any domain, subdomain, subfolder or URL
    (about $0.03 per analysis); traffic snapshots of your and your competitors' domains (a Schedule, below), and SEO
    recommendations built on the SEO vs GEO rows (`GET /api/seo/insights`). [docs/seo-domain.md](docs/seo-domain.md).
  - **Backlinks** (`/seo/backlinks`): totals and a year of history, links, referring domains, anchors, new and lost
    links and top pages of a target (overview about $0.06); authority snapshots of the tracked domains, on a
    Schedule. [docs/seo-backlinks.md](docs/seo-backlinks.md).
  - **Local SEO** (`/seo/local`): Google business listings near a point, Google Business Profiles with reviews,
    updates and questions, Maps and Local Finder results with your business's position, and a 3 × 3 to 7 × 7 local
    rank grid run in DataForSEO's queue. [docs/seo-local.md](docs/seo-local.md).
  - **Site Audit with AI readiness** (`/seo/site-audit`): crawls your own site (100, 500 or 2,000 pages, one request
    per second, robots.txt obeyed, no paid API) and lists technical issues per page and AI-readiness checks: AI
    search and training crawlers blocked in robots.txt, `llms.txt`, structured data and more; CSV export.
    [docs/seo-site-audit.md](docs/seo-site-audit.md).
  - **Performance** (`/seo/performance`): Lighthouse category scores, Core Web Vitals rated against their published
    limits and the top opportunities of a page of your own domains ($0.005 per page and device; an Admin audit
    sample of 10 pages × 2 devices up to $0.10), and **IndexNow** submissions of changed URLs (free).
    [docs/seo-performance.md](docs/seo-performance.md).
  - **SEO navigation**: a sidebar **SEO** section opening `/seo` (one card per page and the next setup step), each
    page on its own URL. The **Action Center** lists the SEO recommendations next to the answer-based ones, marked
    **SEO**, with the same status tracking (the answer-based ones still show when the SEO API is unreachable). The
    **Dashboard** gains *SEO vs GEO* and *Rankings* cards, free reads of stored data.
  - **Settings › AI Providers › SEO data**: a DataForSEO card (login and password, checked with DataForSEO's free
    account endpoint, balance shown to Admins).
  - **MCP tools**: free reads `get_keyword_metrics`, `get_seo_geo_comparison`, `get_seo_recommendations`,
    `get_rank_tracking`, `get_domain_snapshots`, `get_backlink_snapshots`, `get_site_audits` and `get_local_job`;
    and the spend family `seo` (estimate, then run with the confirmation token): `*_seo_keywords`, `*_seo_domain`,
    `*_seo_backlinks`, `*_seo_local` and the Admin `*_seo_job` (rank run, site audit, snapshots, rank grid). Estimates state the most
    calls a request makes and the list price of one call, never a total; a new per-caller daily limit
    `seoCallsPerDay` (default 50). [docs/mcp.md](docs/mcp.md).
- **Google AI Overviews is the fifth answer engine** (`google_ai_overview`): the AI Overview of the Google results
  page for the plain keyword, once per keyword per run whatever the personas, through the DataForSEO login. A page
  without an overview is stored as `no_answer` and counts in no KPI; the same call records the organic top 10. Its
  Lambda (`CitationAnalysis-Search-google_ai_overview`) lives in the SEO stack; the main workflow calls it by name
  when deployed with `-c seoEngine=true`. Like every engine it follows the 2.42.0 search time budget: its one call
  per keyword is stored as soon as it answers and is not asked again when the invocation is retried.
- **Queries filter** on the Visibility tab (all / without your brand / naming your brand; `branded` parameter of
  `/api/visibility`, default all): each answer row records whether its query named a first-party brand or domain.
- **SEO pages start from Settings**: a rank tracker checks the Settings keywords of its market or of one keyword
  group (extra keywords optional), its domain is picked from Brand Tracking, the empty Rank Tracking page offers
  one-click *Track your rankings* / *Track competitors* (paid checks reviewed first), and the other SEO pages are
  prefilled with your domains, markets and keywords.
- **Collapsible sidebar**: on large screens the sidebar folds to an icon rail; the choice is remembered per browser.
- **Domain Overview and Backlinks tables restyled**: page header card with the search form, stat tiles, position
  badges, score chips, compact numbers with exact tooltips, sticky headers and one pager (`ui/DataTable`).
- **Intent column in Domain Overview top keywords**: DataForSEO's main search intent per ranked keyword as a chip
  (informational, commercial, transactional, navigational, unknown); keyword pages cached without it are refetched.

### Changed

- **Review fixes before release** (Kiro review of the 2.43.0 pull request, TENETS.md):
  - SEO measurements are records, not cache, so they are kept (D2, D5): domain and backlink snapshots, site audits
    (the audit, pages, issues and link summary) and Lighthouse runs no longer expire. Only crawl bookkeeping (a site
    audit's URL queue, 90 days) and true caches, receipts and locks keep a TTL. The snapshot tables have no TTL.
  - **Recurring SEO snapshots are Schedules** (Operations › Schedule, `lambda/api/manage-schedule.py`): a schedule's
    new `kind` is `analysis` (the default and every existing schedule), `domain_snapshots` or `backlink_snapshots`,
    each one EventBridge Scheduler schedule that starts the snapshot state machine for every owned and competitor
    domain. Saving an enabled snapshot schedule, or running one now, asks first and names its paid calls. Nothing
    runs, or costs anything, until an Admin creates one; there is no always-on weekly rule and no on/off setting.
  - **Each rank tracker has its own schedule**: a one-time EventBridge Scheduler schedule at its next slot
    (`rank-<tracker id>`, group `citation-analysis-seo-rank`) invokes the jobs function with `rank.due`, which starts
    the check and moves the schedule to the next slot; saving, archiving or switching a tracker to manual moves or
    deletes it. It replaces a 15-minute rule that looked for due trackers, and the table's due index (`GSI2`).
    Operations › Schedule lists the trackers' next checks read-only (`GET /api/schedules?source=rank-trackers`),
    each linking to its tracker (`/seo/rank-tracking?tracker=<id>`).
  - **DataForSEO calls back instead of being polled**: the post step of a rank check and of a local SEO job is a
    `waitForTaskToken` task. It opens a callback gate (`shared/dataforseo_callbacks.py`) and posts every task with
    the gate's `pingback_url`; the public `CitationAnalysis-SeoCallbacks` function URL counts each callback once and
    the last one resumes the state machine, which then collects the results with free `task_get` calls. If a
    callback has not come in time (35 minutes for a rank check, 25 for a local job) the run collects once anyway.
    The Wait / `task_get` loops are gone. The callback function holds no DataForSEO credentials and may only update
    gate items and send task success (SECURITY.md).
  - **SEO working objects have their own bucket** (`citation-analysis-seo-<account>`, `SEO_BUCKET`): oversized
    cache payloads, Lighthouse reports, domain-snapshot keywords (written once per snapshot time) and robots.txt
    copies. The SEO stack no longer writes to the raw-responses bucket except the AI Overviews answers, so it stays
    write-once Bronze (D2).
  - The callback function reserves 5 concurrent executions (a function URL has no throttle of its own); releasing a
    gate claims it first and gives the claim back when sending the token fails, so the next pingback resumes the
    run instead of the safety timeout. A snapshot schedule is refused (400) while the SEO stack's state machines
    are not deployed, and the dashboard offers the snapshot kinds only where the SEO API is configured.
  - The README "Data" section lists the SEO tables and the `seo` bucket's key layout (D7).
  - The Google AI Overviews raw object in `raw-responses` is DataForSEO's task result as returned
    (`raw_api_response.dataforseo_result`), with the rendered markdown beside it under `extracted`, so the overview's
    references can be read again (D2, D3).
  - The callback URL answers 500 when resuming fails, so DataForSEO retries; the rank-tracker schedule list says
    `truncated` past 100 trackers; a filtered Visibility view counts `unclassified_keywords` whose latest run
    predates the branded flag; `CitationAnalysis-SeoKeywordMetrics` is documented as a cache of the latest values.
  - Saving an enabled snapshot schedule or running one now requires `confirm_paid: true` server-side (the dashboard
    sends it after its confirmation). A site audit sleeps at most 3 s inside a step; a longer 429 pause becomes the
    state machine's wait. KPI alerts leave a pair unevaluated when any of the previous run's reads failed.
  - Every new answer row records `citations_version` (2: cited sources only, read pages in `retrieved_urls`),
    beside `branded_version`, so a later figure can tell which citation rule a row was stored under (D2, D3).
  - The paid one-off SEO routes count against a per-caller daily limit in the SEO router
    (`shared/seo_spend_limit.py`, 100 a UTC day, `SEO_PAID_REQUESTS_PER_DAY`); past it they answer 429 and make no
    DataForSEO call (tenet 4).
  - A snapshot schedule can be disabled after the SEO stack is gone; run-now refuses a body that is not a JSON object.
  - Least privilege (tenet 6): the Google AI Overviews search role may only put and query answers on SearchResults
    and get and update its ProviderConfig row (no delete, no batch write). Every SEO feature table is granted per
    action; `DeleteItem` only where the code deletes (rank tracking: the run lock, a removed keyword).
  - KPI alerts read the previous run's rows within the 2.42.0 time budget; a pair whose previous run cannot be read
    in time is left for the budget instead of being compared with part of its past.
  - A `neutral` or `branded` Visibility view no longer compares a keyword with a previous run stored before the
    branded flag existed (`change_unclassified_keywords` counts them), and each answer row records
    `branded_version`, the matcher rule that set its flag (D2, D3).
  - The AI Overviews search role may only put raw answers under `raw-responses/` (no S3 delete), and the SEO keyword
    metrics and cache tables are granted per action without `DeleteItem`.
  - Tenet 8 (events, no polling): the SEO stack's four bounded dashboard polling hooks are recorded in the tenet 8 gap
    of `TENETS.md`; moving them to AppSync Events is tracked in #208.
  - Three duplicated spec blocks are factored away instead of baselined in `.jscpd-baseline/`.

- Dependencies: `jscpd` 5.4.2, `knip` 6.44.1 (root and dashboard), `@stryker-mutator/*` 10.1.1 (the npm group of
  Dependabot #196, without `@vitest/eslint-plugin` 1.6.28, which wants TypeScript 6); the `minimatch` override is
  `^11.0.1` in both packages (GHSA-g3hv-75wg-m249). The copy bundled inside `aws-cdk-lib` (10.2.6, also in its
  latest release) cannot be overridden and stays until AWS CDK ships the fix. Knip 6.44 found the unused
  `CitationsView` re-export in `components/Citations/index.ts`, now removed.
- CI: the pinned gitleaks, actionlint and zizmor installs move to `scripts/install-ci-tools.sh`. Each still comes from
  its GitHub release checked against a committed SHA-256; when the release download fails (GitHub answered 504 for
  hours), the same version is installed from proxy.golang.org (verified by sum.golang.org) or from PyPI (a
  hash-pinned wheel) instead of failing the lint lane.
- `shared.bounded_reads.newest_items` is kept (2.41.0 removed it): the stored domain snapshots and the site-audit
  list read one newest-first page with it.
- **GEO KPI corrections** ([docs/geo-corrections.md](docs/geo-corrections.md)): only the sources an answer cites
  count as citations (OpenAI `url_citation` annotations, Perplexity's numbered markers, Claude's text citations;
  pages an engine only read are kept as `retrieved_urls` and never count); an engine reply without text is *no
  answer* and leaves every KPI; KPI alerts compare only the cells both runs answered, over queries that do not name
  your brand, and a run under 90 % answered raises none. Citation counts and rates usually drop from this release
  on; earlier results keep the citations they were stored with. KPI alerts keep the 2.42.0 time budget: the
  like-for-like comparison runs inside each (group, market) pair's evaluation.
- **Claude and Perplexity are asked to cite.** Every Claude web search (runs and the Settings model check) sends `allowed_callers: ["direct"]`, so its text carries `web_search_result_location` citations (direct mode
  reads full search results: more input tokens); the dynamic-filtering fallback is gone. Every Perplexity request's
  `instructions` ask for inline `[1][2]` markers, after any market instructions; the query itself is unchanged.
- `KPI_VERSION` is 4: KPI alerts do not compare snapshots taken before Google AI Overviews joined the engines or
  before the corrections above, so the first run after the upgrade sets a new baseline.
- The main stack's table, Lambda, CORS and permission helpers moved to `lib/constructs/` so the stacks share them
  (the main stack's template is unchanged).
- `npm run contracts` resolves module-level string constants and shared-table helpers when matching CDK
  environment variables to Lambda reads.
- A deployment of a pre-release SEO stack that already created `CitationAnalysis-SeoPromptExplores` keeps that table
  after the upgrade (tables are retained); nothing reads it any more, so it can be deleted by hand.

### Fixed

- **Resending an invitation works.** For a user who never signed in, *Resend invite* passed the user's id to Cognito,
  which takes only the email for a resend and refused it ("Username should be an email") (`lambda/api/manage-users.py`).

## [2.42.3] - 2026-11-08

### Changed

- **The Kiro PR review follows the conversation instead of starting over** (`scripts/kiro-review/conversation.mjs`).
  Each run now reads the PR's comments, reviews and inline review comments, oldest first, with each author's role
  (maintainer, contributor, bot) and its own previous review marked. The review opens with a **Since the last
  review** section that says, for each earlier point, whether it is resolved, partly resolved, still open or settled
  by a maintainer; it drops a point an answer settles and treats another maintainer's explicit decision on a
  trade-off as final; a maintainer is a commenter GitHub reports with write access or more, looked up per commenter.
  The PR author's own decision is listed as "settled by the author" for a second maintainer to
  see, not silently accepted. A maintainer's comment settles a concern, never a blocking finding (that takes the change, or a trade-off explained in
  the description); nothing settles tenet 1, a data lake tenet, a correctness bug, a security problem or a repository
  rule. Its own previous review is only a list to re-check, never a reason to drop a point, since people with write
  access can edit it. A
  failed conversation fetch costs only the follow-up, never the review. The conversation is untrusted
  text: capped in size (whole oldest entries are dropped first; the reviewer's own last review is always kept),
  read as data, and every line of a body is quoted so a comment cannot forge an author or a maintainer role. The reviewer's
  own comment, edited in place on every push, is dated by its last edit. A steering attempt in someone else's comment is named as a concern, not a blocking
  finding, so a commenter cannot force a BLOCKING verdict on someone else's pull request; in the PR author's own
  comment it stays blocking. Comments are read on the next push or re-run.
- The lockfile excerpt the reviewer reads is cut to 300 characters per line.

## [2.42.2] - 2026-11-08

### Changed

- **Tenet 7 is now "Fully serverless, paid per action. Low cost, or no cost when idle."** (`TENETS.md`): every part
  of the platform is paid per action (request, invocation, state transition, message, read or write, gigabyte
  stored), so an idle deployment costs close to nothing; no polling loop, long poll or waiting Lambda spends actions
  that do nothing, and work starts when an event arrives (tenet 8).

### Added

- **Tenet 8, "Event-driven. Events drive the architecture; nothing polls."** (`TENETS.md`). Why: a poll costs a
  request and a Lambda invocation each time it asks, mostly while nothing has changed; the reader learns of a change
  up to one interval late; and the load grows with the number of open dashboards and headless clients rather than
  with the work being done. Every change of state is an event that consumers subscribe to. Amazon EventBridge routes service events (Step Functions status, S3
  object created, DynamoDB streams) and our own; EventBridge Scheduler is the heartbeat for anything time-based;
  AWS AppSync Events tells the dashboard and API/MCP clients when something happens instead of them polling.
  Polling is the bounded exception (one catch-up read on connect, external APIs without callbacks); a scheduled
  reconcile for missed events stays as a safety net. Events never replace reads: every announced state stays
  readable through REST and MCP for clients that cannot subscribe. A bounded backoff inside one call to a throttled
  service is a retry, not polling. Until AppSync Events exists, a new long-running
  dashboard job may use the existing bounded polling hooks and is listed in the gap table (tracked in #208). The gap table
  lists where the platform polls today, and the pull request checklist, the Kiro PR review and the Kiro issue
  triage now judge changes and feature requests against tenet 8.
- The Kiro PR review sees the lockfile changes it leaves out of the diff (line counts and up to 40 changed lines per lockfile).

## [2.42.1] - 2026-11-07

The quality gate now runs on GitHub as well as before a push, and the repository has written tenets. `npm run
validate` was a local-only chain of npm scripts that stopped at the first failure and ran every step one after
another; it is now `scripts/validate.sh`, which CI runs too. The CI setup follows
[sample-voice-of-customer-datalake](https://github.com/aws-samples/sample-voice-of-customer-datalake). No deployed
behaviour changes.

### Added

- **`TENETS.md`**: the ranked product tenets and the data lake tenets (D1–D7) every design and pull request is
  measured against, adapted from the Voice of the Customer sample, with the known gaps of the platform today. The
  pull request template has a `## Tenets` section.
- **`quality gates` workflow**: `scripts/validate.sh --lane <lane>` on every pull request and push to `main`, one
  job per lane, and a single `scripts/validate.sh` check for branch protection.
- **`dependency audit` workflow** (`scripts/dependency-audit.mjs`, `npm run deps:audit`): `npm audit` on both
  lockfiles and `pip-audit` on both Lambda layers, on pull requests that touch dependencies and weekly; reviewed
  ignores with an expiry in `.github/dependency-audit-ignore.json`. A failing scheduled run opens an issue
  (`scheduled failure watch` workflow).
- **`dependency review` workflow**: a license gate for dependencies a pull request adds or changes
  (`.github/dependency-review-config.yml`).
- **Kiro review** (`.github/workflows/kiro-review.yml`, `scripts/kiro-review/`): a read-only Kiro CLI agent, run
  headless with the `KIRO_API_KEY` repository secret, reviews each pull request against `TENETS.md`, `README.md`
  and `CONTRIBUTING.md` and posts one comment (verdict, findings, tenets), updated on every push. Advisory.
- **Kiro issue triage** (`.github/workflows/kiro-issue-triage.yml`, `scripts/kiro-issue/`): every new issue is
  labeled (bug, enhancement, documentation, question, invalid) with a first reply. A feature request is checked
  against `TENETS.md` (labels `tenets: aligned` / `needs alignment` / `conflicts`), with the closest version that
  fits and a draft of the request; the agent follows up when the author answers, up to five times. The feature
  request template asks for the tenets touched and acceptance criteria.
- **Dependabot** version updates (`.github/dependabot.yml`): weekly, grouped minor and patch, 7-day cooldown.
- **New gates in `validate`**: the version check (`package.json`, `web/package.json` and `CHANGELOG.md` agree),
  gitleaks over the working tree (`.gitleaks.toml`), actionlint and zizmor over `.github/`, and the tests of the
  repo scripts.

### Changed

- **`scripts/validate.sh`** replaces the npm-script chain and `scripts/validate-python.sh`. Steps run in parallel
  lanes (about 3 minutes instead of the steps' 9 minutes end to end on an 8-core laptop), each writes its own log
  under `.cache/validate/logs/`, a failure prints the failing step's log tail and a status table ends every run.
  `--failed` re-runs only what did not pass, `--only` / `--lane` select steps, and `--help`
  (`npm run validate:help`) explains every lane, option and log and the workflow an agent follows on a failure.
  The CDK tests now build the dashboard first (`vite build`), which they need to synthesize the app.
- `version-check.yml` pins `actions/checkout` to a commit SHA and keeps no checkout credential.

## [2.42.0] - 2026-11-05

A customer's dashboard came up blank on every page. `GET /api/citations` without a scope read the whole Citations
table: 71,172 rows in 24.4 s on a 512 MB Lambda, and API Gateway answered 504 at 29 s. `GET
/api/brand-mentions?scope=all` also answered 504 (928 keywords at 2–3 queries each, about 105 s of work). The
dashboard waited for its four startup reads together, so the one failed panel replaced every tab, report and settings
page with "Unable to load dashboard data". Page and row caps bound how much a request reads, not how long it takes. In
this release every API request carries a time budget: capped reads, keyword fan-outs and model calls stop before the
29 s and answer what they have, with the route's truncation flag. Work that grows with table size moves into the
workflow (the citation rollup), CPU-bound Lambdas are sized for CPU, and the dashboard loads, fails and retries each
panel on its own.

### Fixed

- **Every API request has a time budget** (`lambda/shared/request_deadline.py`). `@api_handler` starts a `Deadline`
  per request: the Lambda's remaining time minus 4 s for building the answer (25 s with no Lambda context, never under
  1 s). Capped reads (`dynamodb_batch._collect_pages`), keyword fan-outs (`scope_params.map_scope_keywords`) and
  model and provider calls check it between pages, keywords and attempts. A read it stops sets `Deadline.cut`, and the
  route answers 200 with partial data and its truncation flag (listed below) instead of a 504. Fake-clock tests
  (`lambda/testing/deadlines.py`) pin the contract: a deadline that expires mid-read must give a 200 with the flag set.
- **`/api/citations` answers inside the budget at any table size.** Scope pages come from the citation rollup (see
  Performance). The live read, used when no current rollup exists, reads a small table in one page and a larger one
  with an 8-segment parallel scan (8 pages per segment, 5 attributes projected) that stops 6 s before the deadline:
  at most about 25 s, with `truncated: true` when cut. Each scope has one budget of 100 pages and 200,000 rows. New
  fields: `source` (`"rollup"` or `"live"`), `as_of` (when the figures were built, or `null`) and `stale` (`true`
  when a rollup exists but the keywords or the brand config changed since, so the page was read live and a rebuild was
  requested). The Citations view says "Figures as of …".
- **`/api/brand-mentions` for a group or `scope=all`** reads at most `SCOPE_KEYWORDS_CAP` (100) keywords through the
  deadline-aware fan-out, and its run listing stops at the budget. The scope answer and `view=appearances` carry
  `keywords_truncated` and `truncated`; a single keyword carries `truncated`.
- **History windows stop at the budget** (`shared/scoped_reports.py`, `/api/trends`, `/api/reports/overview`,
  `/api/reports/group-kpis`, `/api/reports/insights`, `/api/visibility`, `/api/reports/competitor`,
  `/api/visibility/sentiment-examples`). A window read gets 0.6 of the remaining time, reads newest first and stops
  between pages and between keywords. One keyword keeps its newest runs and sets `truncated_before`. With several
  keywords, a keyword not read in full is left out, so no keyword's figures are partial.
  - `keywords_truncated` now also means "the time budget left keywords unread"; `keywords_analyzed` counts only the
    keywords read.
  - `WINDOW_ROWS_CAP` follows the Lambda's memory, from a measured 16.7 KiB per row: 15,902 rows at 512 MB, 72,688 at
    1,769 MB. The old 120,000 took about 40 s at 512 MB. Each keyword gets `cap // keywords` rows, so a scope over
    120 keywords can no longer pass the cap (`MIN_ROWS_PER_KEYWORD` removed).
  - `/api/trends` without a scope reads up to 100 keywords, like `scope=all` (it was 20).
  - `/api/reports/overview` adds `keywords_truncated` and `truncated` (it skips the recommendations when the budget
    is spent). The group-kpis `view=keywords` page stops before the first unread keyword and adds `truncated`;
    `next_token` resumes there.
  - `/api/visibility/sentiment-examples` reads the sightings without the answer text, then fetches the texts of the
    page only (at most 50 rows, about 60 MB down to under 1 MB), and adds `truncated` (when set, `answer` may be
    empty).
- **Model and provider calls on API paths are bounded.**
  - `shared/models.invoke_bedrock(..., deadline=)` sets each attempt's read timeout to the time left minus 1 s, turns
    botocore retries off, never sleeps a throttle backoff past the budget and raises `BedrockDeadlineError` with
    under 3 s left. Workflow workers do not pass a deadline and behave as before.
  - `POST /api/self-reflection` answers 200 from the cache, or **202** `{status: "pending", keyword, brand,
    query_prompt_id}` and runs the Bedrock call in an asynchronous invocation of the same function (56 s budget). That
    invocation stores the result and never raises, so an async retry cannot pay twice. `GET` reports the `job` and
    `truncated`; the dashboard polls until the job finishes, fails or two minutes pass.
  - `/api/recommendations` caps its prompt at 50 keywords, runs on the fast tier without thinking and within the
    deadline (at most about 24 s), and adds `llm` (`ok`, `timed_out`, `failed` or `null`). On a timeout the rule-based
    list still comes back, and the Action Center says the AI pass ran out of time.
  - Brand config expand, expand-all and find-competitors run without thinking, list at most 100 brands in the prompt,
    and on a timeout answer 200 with `error` and `timed_out: true`.
  - Market proposals and keyword suggestions answer **503** (try again) when out of time. `PUT /api/markets` reads only
    the markets being dropped and answers 503 with nothing saved when cut.
  - `PUT /api/providers/{id}` runs every check (key, enable, model) before any write and answers **503** with nothing
    saved when out of time; a failed write answers 500 with `saved: [...]`. The dashboard reads the 503 bodies.
- **Scope reads and writes report what they did not finish.**
  - `GET /api/stats?market_id=` reads the last execution in parallel with the counts under an 8 s budget and adds
    `last_execution_approximate`; its keyword scan is capped at 50 pages.
  - Trigger-analysis counts active keywords with a `Select=COUNT` query (under 1 s at 5,000 keywords) and adds
    `keywords_count_approximate` when the count was cut; the run still starts.
  - `DELETE /api/keyword-groups/{id}` deletes the group row first, then detaches members 10 at a time until the
    deadline. An unfinished delete answers **202** with `pending_members` and `truncated`; sending DELETE again
    resumes. Membership updates add `pending` and `truncated`. Promoting research keywords writes 10 at a time (500
    keywords: 12–25 s down to 2–3 s) and adds `pending_keywords` and `truncated`; re-sending is idempotent.
  - `/api/prompt-insights` and the Content Studio ideas read under the deadline and add `truncated`.
- **The dashboard no longer blanks on one failed read.** The four startup reads settle independently
  (`hooks/dashboardPanels.ts`, `components/Layout/DashboardGate.tsx`): each panel shows as soon as it answers, and a
  failed one keeps its last data with "<Panel> did not load: Request timed out." and a Retry button. Time to a usable
  app is now bounded by `/api/stats` (0.6–3 s live), not by the slowest read. Errors carry the HTTP status: 504 and
  408 read "Request timed out", 502 and 503 "Server error occurred".
- **Workflow steps finish inside their Lambda timeout.**
  - GenerateInsights is a Map with one ReportInsights invocation per fully covered (group, market), four at a time,
    behind a `HasCompleteGroups` choice, so one slow group no longer loses the others. Each invocation stops reading 75
    s before its timeout to keep time for Bedrock and the write. `narratives` adds `history_partial` (written from a
    partial history) and `time_budget_skipped`.
  - Search stores each prompt's answers before starting the next and starts a prompt only if its worst case fits the
    time left. Prompts left over raise `SearchTimeBudgetSpentError`, which Step Functions retries (1 s, 10 attempts);
    the retry skips the (provider, prompt) pairs already stored, so no stored prompt is asked or paid for twice. Rows
    carry `error_category`.
  - KpiAlerts evaluates the smallest pairs first, starts none with under 30 s left, and names the rest in
    `skipped_time_budget` and `time_budget_scopes` instead of timing out with nothing written.
  - The crawler's AgentCore session ends 20 s before the invocation (`BROWSER_SESSION_TIMEOUT_SECONDS` 330 → 280),
    so a killed Lambda never leaves its session running.
  - ParseKeywords: 30 s / 256 MB → 120 s / 1,024 MB. Keyword research: 30 → 60 minutes per job (three agent rounds
    can take about 16 minutes each), with the stale sweep at 65 minutes.
- **The MCP server answers `upstream_timeout` instead of a gateway 504.** A tool call waits for its API Lambda only
  for the request's time left minus 1 s and is never re-sent, so a write is never sent twice. The error says a write
  or start may still complete and is audited. A start that timed out keeps the day's use. The run estimate stops
  counting keywords once it passes the cap or the budget, and a count it could not finish now refuses the start
  ("The scope's keywords could not all be counted (too many, or the API was slow)"). See `docs/mcp.md`.

### Changed

- **Lambdas are sized for CPU, not peak memory.** Lambda allocates CPU in proportion to memory, and these functions
  are CPU-bound (deserializing DynamoDB rows): at 512 MB the unscoped citations read used 224 MB and still ran out of
  time. 1,769 MB (one vCPU): API-CitationsContent, API-StatsInsights, API-GetBrandMentions (was 512/512/256),
  ReportInsights (512 MB / 120 s → 300 s), KpiAlerts (512). 1,024 MB: API-KeywordMgmt, API-ConfigMgmt,
  API-ExecutionMgmt (were 256). GenerateSummary: 1,024 MB / 300 s → 3,008 MB / 900 s for the rollup build.
  Pay-per-use cost stays about flat for CPU-bound work, which finishes proportionally sooner.
- **`apiGet` retries once** 300–811 ms (random jitter) after a 502, 503, 429 or network error. It never retries a
  504, a request after abort, or a POST; callers can opt out with `retry: false` (Content Studio status polling does).
  Each group KPI export page goes through it, and a failed export names the part, e.g. "Excel export failed: Keyword
  runs, page 3: Request timed out".
- **The dashboard repeats a keyword-group DELETE that answers 202** and re-sends pending membership and promotion
  writes.
- **`GET /api/executions/{id}` answers 404 for an unknown id** (it answered 500 after 2.8 s).
- **Batch gets can project** (`batch_get_items(projection=, attribute_names=)`, kept on retries of unprocessed keys).
- **The search clients' 429 waits never sleep past the time budget** (they could reach 6.6 minutes, outside the
  search worst case).
- **`cdk synth` and `npm test` need CPython 3.12** (`$PYTHON312`, `python3.12` on `PATH`, or `uv python install
  3.12`) or a running Docker, because they compile the handler assets (see Performance).
- **Main-stack resource budget spec** (`lib/citation-analysis-stack.spec.ts`): the stack has 499 of CloudFormation's
  500 resources and the test fails at 500.

### Performance

- **Citation rollup** (`lambda/shared/citation_rollup*.py`, `lambda/generate-summary/citation_rollup_action.py`).
  Per-scope totals and pages for all keywords, each market, each group and each group × market, stored under
  `citation-rollups/` in the keywords bucket.
  - Built by the new `BuildCitationRollup` state, the workflow's last step (GenerateSummary with `action:
    build_citation_rollup`), after every run. A failed build keeps the report and the previous rollup.
  - Rebuilt on request when `/api/citations` finds a scope stale (the keyword fingerprint or the brand config's
    `updated_at` changed). The route then answers live with `stale: true` and asks GenerateSummary for one
    asynchronous rebuild, at most every 5 minutes.
  - A default-order or `content_type` page costs the manifest and one chunk (3–5 ms locally at 10× today's data).
    Other sorts and filters read an entries file cached per container (4 MB gzipped at 270,000 URLs: about 1.2 s cold,
    150 ms warm). Rollup pages equal live pages (parametrized test).
  - At 10× (700,000 rows, 147 scopes) a build takes 74 s CPU and 1.1 GB. It stops 30 s before its timeout without
    publishing, never replaces a newer build, and deletes old builds except the current, the previous and any under
    30 minutes old.
- **CPython 3.12 bytecode ships in the layers and handler assets** (`scripts/compile-python312.sh`,
  `lib/constructs/python-bytecode.ts`). Lambda's `/var/task` and `/opt` are read-only, so every cold start compiled
  about 430 modules again. Third-party code is compiled `unchecked-hash`, our code `checked-hash`, so builds are
  byte-identical. Import time of a router and its first handler, before → after: citations 1,138 → 409 ms, stats 1,063
  → 373 ms, overview 1,311 → 332 ms, brand mentions 608 → 393 ms, schedules 986 → 398 ms, keywords 1,072 → 345 ms,
  Content Studio 1,332 → 667 ms (35–75% less; about 1.5–3 s saved per cold start at 256 MB). Handler assets carry only
  runtime files (no tests or caches), and their asset hash covers only those files, so editing one API handler
  redeploys only the Lambdas that bundle it. Synth fails when a shared module's bytecode is missing or stale. Layer
  sizes: shared 3.9 → 6.3 MB, crawler 173.1 → 186.6 MB.
- Scope resolution projects four attributes from `StatusIndex` (5,000 keywords: 3.9 MB → 1.1 MB). Recent search
  results (recommendations, ideas) are read in parallel (50 keywords: 3–4 s → under 1 s). `GET /api/providers`
  reads all nine providers in parallel.

### Security

- **Dependencies** (in-range): aws-cdk 2.1148, aws-cdk-lib 2.275, typescript-eslint 8.72.1, vite 8.3.6, aws-amplify
  6.22.2, @aws-amplify/ui-react 6.15.7, react-router-dom 7.18.5, chart.js 4.6.1, docx 9.15.2 and others. Overrides
  raise undici to 7.30.2, zod to 4.6.7, qs to 6.16.2 and fast-uri to 3.1.9. This supersedes Dependabot #191–#193.
- **npm audit:** root 23 (2 high: undici, zod) → 21 moderate; web 8 (1 critical dompurify, 1 high zod) → 3
  moderate. **dompurify 3.4.17** sanitizes rendered answers in the dashboard; its critical fix reaches users with the
  next web deploy.
- Still open: minimatch GHSA-g3hv-75wg-m249, the one advisory behind all 24 remaining entries (eslint, nx,
  typescript-eslint, stryker and aws-cdk-lib depend on it). The fix is minimatch 11, which removes `makeRe` that nx and
  eslint-plugin-import call; aws-cdk-lib bundles its own 10.2.6, which an override cannot reach. Dev-only: glob
  patterns come from our own config.

### Not changed / known limits

- minimatch stays on 10.x (above). Major upgrades (eslint 10, TypeScript 6/7, vitest 5, React 19, Tailwind 4, jsdom
  31) are separate releases; @vitest/eslint-plugin 1.6.28 waits for TypeScript 6.
- Long KPI windows are bounded in time but can be partial (`truncated_before`, `keywords_truncated`). A per
  keyword-run KPI rollup, which would make them complete, is deferred.
- The main stack is at 499 of 500 resources: new infrastructure goes into another stack.
- The Docker branches of the bytecode build (layer compile and handler bundling fallback) were not tested in this
  release; the local CPython 3.12 path was.
- A run that fails before `BuildCitationRollup` leaves the previous rollup in place until the next run or a stale
  read; `as_of` shows its age.

## [2.41.1] - 2026-10-22

### Security

- **Vitest 4.1.12** (root and `web/`, was 4.1.11): fixes GHSA-qxg6-89mg-rqv8 (code injection through unauthenticated
  manual-mock registration) and GHSA-xp26-3454-mjgp (Windows backslash traversal of the `@vitest/mocker` redirect
  allowlist), both in `@vitest/mocker`. Test toolchain only; nothing ships to the dashboard or the Lambdas.

## [2.41.0] - 2026-10-21

A customer's dashboard failed to load with a bare 502: `GET /api/citations` built a response larger than AWS Lambda's
6 MiB cap (`RequestEntityTooLarge`). An audit of every route found the same growth in eight more (the dashboard's
`/api/searches`, brand mentions, group KPI history, the competitor rollup, content and research history, schedules,
raw files) and unbounded reads that would hit API Gateway's 29 s timeout as data grows. Every route now declares how
its response is bounded, the at-risk ones are paginated or summarized, and a response that still outgrows the cap is
handed over through S3 instead of failing.

### Fixed

- **Responses too large for Lambda no longer fail.** `shared.api_response` measures every response the way the Lambda
  runtime does (the whole proxy envelope: the body escaped a second time, every non-ASCII character as a 6-byte
  `\uXXXX`). Above about 5 MB the body goes to the keywords bucket under `api-responses/` (expired after a day) and the
  route answers its original status with `{"spilled_response": {"url", "size_bytes", "expires_in"}}` and
  `X-Spilled-Response: true`. The URL is a 5-minute presigned GET on the regional endpoint; the bucket allows browser
  GETs from the dashboard origin only. The dashboard's `authenticatedFetch` and the MCP server's `invoke_route` follow
  the pointer (no credentials sent; https on `*.amazonaws.com` only; the MCP refuses bodies over 32 MB), so callers
  see the real body. If S3 fails, the route answers a 500 with `code: response_too_large` instead of a bare 502. Each
  spill logs `spilled_api_response route=… bytes=…` as an error and each response over 1 MB `large_api_response` as a
  warning (CloudWatch Logs Insights: `filter @message like /large_api_response|spilled_api_response/`).
- **Persona rankings and the self-reflection POST read the newest run.** Once a keyword's results passed 1 MB they
  took the "latest" run from the oldest page.
- **Prompt insights honours `limit` up to 100** (values above 20 had no effect).
- **Citation URLs longer than 1,024 bytes are stored** (`shared.utils.normalize_url` → `bounded_url`): DynamoDB caps the
  Citations sort key at 1,024 bytes, so a Google Travel hotel link with an opaque `ap=` state blob failed its write and
  the citation was lost. An oversized query string is dropped (the page address stays); anything longer is cut and
  ends with a SHA-256 digest so two long URLs never share a key.
- **The Competitor Gap report no longer asks for a competitor the brand config does not list** (a bookmark from
  another configuration answered 400 while the page redirected); it waits for the configured list first.
- **The pager says "0 of 0"** when a filter matches nothing (it said "1-0 of 0").
- **Raw responses browse every file of a folder** (it stopped at the first 1,000 S3 keys without saying so).
- **Content Studio rows stay under DynamoDB's 400 KB item cap**: `raw_content` is dropped first; a row that still does
  not fit fails with `content_too_large` instead of losing the generation silently.

### Changed

- **Paginated routes** (`limit` + `next_token`, each page cut to 1 MB; `shared.cursors`, `shared.response_budget`):
  - `/api/citations`: server-side sort (`sort`, `order`), filters (`url_contains`, `min_citations`, `content_type`),
    `offset` for the pager; every page carries the scope totals (`total_urls`, `provider_stats`, `brand_stats`, …).
    The per-URL keyword list is sent only with `include_keywords=true`. Keywords are read in parallel with a shared
    100-page cap, reported as `truncated`. The Citations table pages on the server; its Excel export follows every page.
  - `/api/searches`: default 50 rows (max 500), newest first across providers, without the answer text unless
    `include_response=true`. Recent Searches loads older pages on demand; its Excel export follows every page.
  - `/api/crawled-content` (`include_content`), `/api/visibility/sentiment-examples` ("Load more answers"),
    `/api/content-studio/history` and `/api/keyword-research/history` ("Load older"), `/api/schedules` (details
    fetched for the page only, 8 at a time), `/api/raw-responses/browse` ("Load more"), `/api/users` (Cognito's
    token; groups for the page only).
- **Summaries instead of everything:**
  - `/api/brand-mentions` answers the top 100 brands (`matching_brands`, `brands_truncated`) with a five-appearance
    preview each (30 for one keyword) and no duplicated `first_party_brands`/`competitor_brands` lists; engine answers
    are cut at 12,000 characters (the expanded answer says so, with its full length). `view=appearances` pages every appearance for the drill-down and the Excel exports.
    Each keyword reads only its selected run, never its whole history. A 200-keyword group answer went from 49 MB to
    about 0.6 MB.
  - `/api/reports/group-kpis` answers the group series and each keyword's latest KPIs; `view=keywords` and
    `view=drivers` page the per-keyword runs and the per-run drivers, which the report loads when shown and the
    Excel export assembles.
  - `/api/reports/competitor` without `competitor` rolls up at most 10 competitors (`competitors_truncated`) and
    reports exclusive-source counts instead of the lists; reads are one projected latest-run query per keyword.
  - `/api/visibility` lists the top 100 brands plus every first-party and configured brand (`brands_total`,
    `position`).
  - `/api/raw-responses/file` answers files over 1 MB with a presigned `download_url` (`too_large: true`).
- **Bounded reads** (timeouts): `/api/trends`, `/api/reports/overview`, `/api/reports/insights`,
  `/api/reports/group-kpis` and the report-insights worker read at most 120,000 rows newest first; when the cap stops a
  read, every keyword is cut at the same run, the response names it (`truncated_before`,
  `history_truncated_before`) and the reports say where history starts. `/api/stats` counts tables over 64 MB from
  DescribeTable (`counts_approximate`; the dashboard marks those counts "≈") and runs its counters in parallel.
  `/api/citation-gaps` reads at most 100 keywords of a group (`keywords_truncated`). The Content Studio unviewed badge
  stops at "99+". Keyword group counts come from one StatusIndex query instead of a table scan.
- **API Gateway compresses** responses of 1 KiB or more for clients that accept gzip (`minCompressionSize`). This
  cuts transfer, not the Lambda cap, which is measured before compression.
- **MCP tools** gain the new parameters (`next_token` on every paginated tool, citations sort and filters,
  brand-mention appearances, group KPI views). A result the 50,000-character cap cuts keeps its `next_token` with a
  note to ask again with a smaller `limit`. `get_brand_mentions` returns each brand's aggregates and each engine's
  answer without its full text (a 30-keyword group summary came back as a cut text preview; now about 40,000
  characters of structured data), with `view=appearances` for every appearance.
- **The Dashboard lists the newest 5 open alerts**, with "Show all N alerts" to expand the rest (20 open alerts
  filled the page).
- A YouTube video whose details cannot be read (private, removed, not embeddable) is logged at INFO like any failed
  navigation, not as a warning.

### Added

- **Route size-policy registry** (`test-fixtures/route-size-policies.json`): every API Gateway route declares its
  policy (`paginated`, `top_n`, `summary`, `single_item`, `bounded`) and bound. `lib/response-size.spec.ts` fails
  when a route is missing or stale; `lambda/api/test_route_size_policies.py` checks the router route maps and that
  every growing route names a volume test that exists.
- **Volume tests** (`lambda/api/test_*_volume.py`, helpers in `lambda/testing/response_size.py`): each at-risk route
  is fed a large, realistic data set in accented Spanish and must stay within its 1 MB page budget, measured on the
  proxy envelope.

### Security

- **Vite 8.3.5** (root and `web/`, was 8.2.1/8.2.2): fixes the six open Dependabot alerts (GHSA-587h-7wmj-h5pm,
  GHSA-r825-w8mm-5pxw, GHSA-698v-4r3x-3vcv in its `launch-editor`) and three dev-server advisories (GHSA-9jrq-w75r-8gcw,
  GHSA-rq7h-c2jc-7f22, GHSA-vfpm-58rq-9qcg). Rolldown and PostCSS moved with it.
- **pytest 9.0.3+** in `lambda/requirements-dev.txt` (PYSEC-2026-1845; dev toolchain only).
- Still open: `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested glob patterns) reaches the
  dashboard only through Tailwind CSS 3.4's build-time file watcher and content globs, which are our own config, and
  no patched 3.x exists. The fix is the Tailwind 4 migration (`npm audit fix --force`), a separate change to the
  styling of every component.

### Removed

- `shared.bounded_reads.newest_items`, `shared.search_results.query_keyword_items`,
  `shared.scope_params.query_keyword_rows`, `shared.dynamodb_batch.count_partition_items` and `count_all_items`: the
  bounded reads replaced their last callers.

## [2.40.0] - 2026-10-11

### Added

- **Amazon Bedrock Web Search is the tenth provider** (`agentcore`, a search provider next to Brave, Tavily, Exa,
  SerpAPI and Firecrawl). It queries Amazon's own web index through an AgentCore Gateway with the managed `web-search`
  connector and records the results as citations only (no generated answer, so it never counts in the KPIs). It needs
  no API key: the search Lambda signs each call (SigV4) with its role. One search is one stateless `tools/call`
  (`shared/web_search_gateway.py`, `AgentCoreSearchClient`); live probes of the tool answered in about a second with
  up to 20 results for a requested 25.
  - **Gateway stack** (`CitationAnalysisWebSearchStack`, `lib/web-search-stack.ts`): the gateway (`AWS_IAM` inbound
    auth), its `web-search-tool` target, a service role that may only call `bedrock-agentcore:InvokeWebSearch`, and the
    gateway URL in the SSM parameter `/citation-analysis/web-search/gateway-url`. Web Search exists only in us-east-1,
    eu-west-1 and ap-northeast-1, so the stack has its own region (CDK context `webSearchRegion`, default
    `us-east-1`; anything else fails at synth) and the main stack reads the URL from SSM at run time. Nothing is
    referenced across the two stacks, so deploy order and regions do not matter. It is a separate stack because the
    main stack is at the 500-resource limit (the provider itself adds a function, its log group and an IAM overflow
    policy: 499).
  - **Settings › AI Providers**: the card shows *IAM — no key needed* once the gateway stack is deployed and *Gateway
    not deployed* (toggle disabled) before; there is no key field. Enabling is proven with a real one-result search
    through the gateway. `GET /api/providers` gains `auth` (`iam` | `api_key`); `PUT`/`validate` with an API key on an
    IAM provider answer 400.
  - **Markets.** The tool has no country or language parameter (measured: extra `country`/`language` arguments are
    ignored), so a market changes nothing in the request. Results localize by the query's language, which a market's
    translated keywords already carry (Spanish and Portuguese queries returned `.es`/`.cl` and `.br`/`.pt` sources
    where the English one returned `.com`).
  - **Terms.** AWS requires source citations and links to be kept and shown, and forbids bulk extraction or building a
    competing index with the results.
  - `GET /api/stats?provider=` now accepts the search providers too (it answered 400 for everything but the four
    answer engines); the brand-mention and sentiment endpoints still take the answer engines only.
  - The index reports dates as text such as `05:00PM, Sunday, May 10 2026, PDT`, or `unknown` for about half of the
    hits; `published_date` is stored as UTC ISO-8601, or `None` when unknown.

## [2.39.0] - 2026-10-10

A duplication review of the 158 production clones the jscpd gate had accepted over time classified 17 as the same
logic written twice (11 TypeScript, 6 Python), 10 as borderline and 131 as structural (import headers, decorated
handler signatures, the shapes the frameworks mandate). This release removes the 17 — one shared unit each, every
copy moved onto it — plus two twins the scanner could not see. The borderline ones stay as they are; the structural
ones stay in the baseline. TypeScript production clones go from 58 to 42, Python from 100 to 97; no behaviour changes
except the fixes listed below.

### Changed

- **Dashboard.** One `TabBar`/`TabPanel` (`components/ui/TabBar.tsx`, with `role="tablist"`, roving focus and
  arrow-key navigation) replaces nine hand-rolled tab strips (About, Prompt Insights, Keyword Research, competitor
  analysis, the brand and citation detail modals, the raw-response file viewer and explorer, Content Studio). One
  `PaginationHeader` replaces the Citations `PaginationControls` and the Recent Searches copy (`ui/pagination.ts`
  gains `pageWindow` and exports `SHOW_ALL_ITEMS`). `KpiDefinitionList` renders the KPI definitions once for the
  Visibility tab and the reports; `RefreshTextButton` gains `loading` and `showIcon` so panels stop drawing their own
  refresh buttons; `BrandListBody` is the one body behind the first-party and competitor brand lists.
  `formatting/searchSummary.ts` (`summarizeSearches`) computes the run and citation totals and the newest run once
  for the keyword detail, the Recent Searches groups and the Searches view. `hooks/useGuardedLoad.ts` is the one
  load-on-mount/reload/mutate state machine behind `useKeywordGroups`, `useSavedTemplates` and `useMarkets`;
  `useBrandMentions` runs on `useAnalysisEndpoint` (which gains `reset()`); `useBrandConfig`'s API returns decoded
  JSON through `apiGet`/`apiPost`. The report scope is derived in one place: `scopeFromSearch` takes the keyword as
  an optional argument, and the Brand Visibility and Executive Summary reports use it instead of their own copies.
- **Lambdas.** `shared.decorators.json_object_body` is the one home of "the body must be a JSON object" (alerts,
  keyword promotion, run triggering, markets, custom reports). `shared.keyword_groups.open_keyword_tables` opens the
  Keywords and KeywordGroups tables for the handlers that need both. Every module that reads the SearchResults table
  name does so through `shared.search_results.search_results_table_name()` (12 modules used to spell it three ways).
  `shared.dynamodb_conditions.set_update_expression` builds the `SET` update for the saved-template edits of
  Keyword Research and Content Studio. `shared.research_jobs` bounds planned, next-round and signals-step query lists
  with one loop capped at `AGENT_MAX_QUERIES_PER_ROUND`. The test fixtures take the handler directory from one
  `testing.module_loader.API_DIR`.

### Fixed

- **Keyword detail showed the wrong "last run".** The detail panel took the first search of the list as the latest;
  `summarizeSearches` sorts by timestamp, as the Recent Searches tab always did.
- **Saved-template edits aliased only `name`.** The Keyword Research template update used raw attribute names for
  every other field, so a field named after a DynamoDB reserved word (`status`, `data`, ...) would have been
  rejected; the shared builder aliases every attribute.
- **Tab strips were buttons.** The nine migrated tab strips now expose `tablist`/`tab`/`tabpanel` roles, `aria-selected`
  and keyboard navigation.

## [2.38.3] - 2026-10-10

### Changed

- **CodeQL now sees the whole attack surface.** The local gate (`npm run quality:codeql`, also the pre-push hook) ran
  only the code-quality suites, and CodeQL's security queries start from "remote flow sources" it knows for web
  frameworks (Flask, Django, ...) — never for an AWS Lambda handler's `event`. So the security queries had nothing to
  start from on this codebase: 0 results meant 0 sources, not 0 problems. The gate now runs the `security-and-quality`
  suites (Python 172 rules, JavaScript/TypeScript 201, GitHub Actions 27, up from 101 + 98) with a repository model
  pack (`scripts/codeql/python-lambda-models`) that declares the API Gateway `event` reaching every decorated handler
  as attacker-controlled input. GitHub's default setup, which cannot load repository model packs, was switched from
  the `default` to the `extended` query suite. The local config also stops scanning `web/coverage/` (a test report,
  not source), which had produced the one finding the broader suites showed.

### Fixed

What the newly reachable queries found, and the fixes:

- **Log injection (CWE-117, 5 places).** Request-derived values (the caller identity and groups from the token in
  `require_group`'s denial line, a schedule id and name, a Bedrock model id) were logged as they came; a value with a
  line break would have started a forged log record. `shared.log_safety.log_text` escapes line breaks and bounds the
  length, and those lines use it.
- **Polynomial regular expression (CWE-1333).** The notification-email pattern's domain labels
  (`[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?`) could be matched in several ways and backtrack; the pattern is now
  unambiguous (`[A-Za-z0-9](?:-*[A-Za-z0-9])*`) and anchored, and the 63-character label limit it used to carry is
  checked in code with the address and local-part limits (the input was already capped at 254 characters, so this was
  not exploitable).
- **A false positive avoided:** CodeQL does not scope PEP 695 type parameters into nested functions and reported
  `ResultT` in `shared.scope_params.map_scope_keywords` as an uninitialized local; the inner function's return
  annotation is gone (pyright infers it).

## [2.38.2] - 2026-10-10

### Changed

- Citation URLs drop every tracking-only query parameter, not just the UTM classics (`shared.utils.normalize_url`,
  the one normalizer behind the SearchResults citations, the Citations table keys and the crawl cache). The list now
  covers the whole `utm_` family, ad-click ids (`gclid`, `gbraid`, `wbraid`, `dclid`, `fbclid`, `msclkid`, `yclid`,
  `twclid`, `ttclid`), Google Analytics linking and Shopping tracking (`_ga`, `_gl`, `srsltid`), share tracking
  (`igshid`, `igsh`, `mibextid`, `fb_*`), marketing-automation ids (Mailchimp, HubSpot incl. `hsa_*`, Marketo,
  Eloqua, Vero, Klaviyo, ConvertKit, Omeda, Bronto), analytics campaign tags (Adobe, Matomo `pk_*`/`mtm_*`,
  Webtrekk, Yandex, ActiveCampaign), referrer attribution (`ref`, `source`, `ref_src`, `cmpid`, `ncid`, `spm`,
  Branch) and Amazon referral tracking (`pd_rd_*`, `pf_rd_*`); names match in any letter case. Parameters that can
  select content (`id`, `page`, `q`, `lang`, `variant`, and short or generic names such as `s`, `t`, `tag`, `trk`)
  are kept. Rows stored before this release keep their original keys, so a page cited under a now-stripped
  parameter appears once more as a new URL after its first clean citation.

## [2.38.1] - 2026-10-10

Findings of the first full market run (30 keywords, Chile, Brazil and global): every row and KPI was right, but the
crawler logged Playwright tracebacks, two providers were refused and retried at WARNING, and the alerts named cabin
products and loyalty programmes as competitors. All four are fixed at the root.

### Fixed

- **Crawler teardown noise.** The SSRF guard intercepted every browser request (`context.route("**/*")`), so each
  image, script and beacon cost a round-trip through the Lambda and dozens were still in flight when a slow page was
  torn down: Playwright 1.63 then logged `Exception in callback Connection.dispatch._done_callback … CancelledError`
  (7 of 601 invocations) and asyncio `pipe closed by peer` (61 lines). The guard now runs on a CDP session with
  `Fetch.enable` limited to document requests (`lambda/shared/browser_tools.py`): the page, its frames and every
  redirect hop are still checked before they are sent, nothing else pauses, and teardown still never talks to the
  page (the session dies with the connection). A paused request that outlives the page is logged at DEBUG, not ERROR.
- **Alerts about things that are not competitors.** `new_competitor_top` fired for "Delta One", "AAdvantage",
  "Avios" and "American": the extraction model may label anything a competitor and name it as the answer spelled it.
  Extracted brands are now canonicalized against the configured brands (global list plus the market's competitors
  and local names; `lambda/shared/brand_names.py`): case, accents, spacing, ®/™ and a one-word prefix ("Sky",
  "SKY Airline S.A.") all map onto the configured spelling and classification, so "SKY Airline", "Sky" and
  "Sky Airline" are one leaderboard row and "American" counts as American Airlines. The extraction prompt now asks
  for the company, not its loyalty programme, cabin or fare product, and the new-competitor rule considers only the
  competitors configured for the group's market. The KPI engine's brand identity is case-, accent- and
  whitespace-insensitive (`docs/kpi-definitions.md`); the KPI formulas are unchanged.
- **Rate limits are paced, not retried.** Reserved concurrency bounds how many requests to a provider are in flight,
  not how often they start: three Perplexity slots sending every ~15 s met in the same second about one call in five
  (8 refused calls in 30; Perplexity allows one request a second per key), and two Firecrawl slots overran its
  per-minute plan, which counts refused requests too. Each paced provider now claims its send time from a shared
  ledger (`pacer#<provider>` in the ProviderConfig table, one conditional write; `lambda/shared/provider_pacing.py`)
  so no two requests leave within its interval across all slots: Perplexity 1.1 s, Firecrawl 12 s (five searches a
  minute at two slots). Per deployment: `-c providerPacing='{"perplexity":0,"firecrawl":6}'` (0 = no pacing). A 429
  that still happens honours the provider's own `Retry-After` / reset for up to 120 s (the 30 s cap had made Firecrawl
  retry inside a still-closed window and spend quota on it).
- **Less logging that says nothing is wrong.** A refused request retried a second later is the pacing working: the
  first two throttled waits are INFO, a provider that keeps refusing is a WARNING from the third attempt, and the
  `[<PROVIDER>_RETRY]` / `_FAILED` tags are unchanged. A publisher block page or CAPTCHA is an expected, recorded
  outcome (INFO, was WARNING). A Gemini redirect that cannot be resolved is INFO with the failure class, logged once
  instead of twice, and one WARNING names the answer when none of its redirects resolved.

## [2.38.0] - 2026-10-10

### Added

- **Describe this market** (Settings › Markets, `POST /api/markets` with `{"propose": {country, language, city?}}`,
  Admin): adding a market is now two steps. Step 1 takes a country and a language from two lists, named in English
  by the browser, plus an optional city; "Next: describe this market" (also what Enter does there, so nothing is
  saved undescribed) makes one Bedrock call (`shared/market_proposal.py`, the `analysis` role, 2–3 s) that proposes
  everything else a market carries: the BCP 47 tag with the regional variant, the currency, the city's IANA time
  zone, region and coordinates, the id and display name, the local competitors of the tracked brands that the global
  list lacks, and the brand's local names. The proposal is read back through the same `validate_market` as a
  hand-typed market (the request's country and city always win over the model's; the language must keep the
  requested primary subtag; bad coordinates or optional texts are dropped rather than failing it) and the answer says
  whether the id is already configured. Step 2 shows the proposed details to check and edit, with "Describe again"
  and "Back"; the administrator saves from there. When the model cannot answer, step 2 opens with what the choice
  implies (codes and English names) and the rest to fill in by hand. The old `{keyword, market_ids}` body of the same
  route keeps asking for keyword translations.

### Changed

- Settings › Markets: the fourteen-field form became the two steps above; editing an existing market shows the
  details directly. Going back and changing the choice describes it afresh; going back without a change returns to
  the same details, edits kept. The competitors field is labelled "Extra local competitors": the Brand Tracking list
  already counts in every market.

## [2.37.3] - 2026-10-09

### Fixed

- The MCP stack deployed again. Its managed-login branding resource (2.37.0, #174) failed its first real deploy three
  ways, each found against the live user pool: Cognito answers an existing style with
  `ManagedLoginBrandingExistsException` (the handler caught `InvalidParameterException`, so a console-made or
  partially created style failed the stack); the logo SVGs were handed to boto3 still base64-encoded, so Cognito saw
  text and refused every asset; and the theme used invented settings keys (`components.link`, `globalHeader`,
  `light`/`dark`), which Cognito rejects as `UnknownProperty`. The handler now patches only keys present in the
  document `DescribeManagedLoginBrandingByClient` returns (`lightMode`/`darkMode`, RGBA hex, `componentClasses.link`),
  skipping and logging any the schema lacks. The handler was run against the account before the deploy; the pages
  carry the dashboard palette (gray-900 buttons, blue-600 links, 8 px radius) and both logos.

## [2.37.2] - 2026-10-09

### Security

- `aws-cdk-lib` 2.273.0 (was 2.265.0) and the `aws-cdk` CLI 2.1145.0. `aws-cdk-lib` bundles `brace-expansion`, which
  npm overrides cannot reach; 2.273.0 ships 5.0.12, fixing the three Dependabot alerts on it (GHSA-6j4f-fj2g-mc7p,
  GHSA-qhr7-859c-m2p7, GHSA-q2hr-2g5m-vwhr: denial of service through crafted brace patterns, reachable only through
  glob patterns this repository passes at synth time). `npm audit` is clean at the root. The synthesized templates
  change only in asset hashes, CDK's own metadata and its bucket-deployment helper Lambda moving to arm64.
- Still reported in `web/` only: the `braces` advisory with no patched release, reached through Tailwind 3's file
  watcher at build time (the fix is the Tailwind 4 migration).

## [2.37.1] - 2026-10-09

### Changed

- **CodeQL code-quality queries run locally before every push.** `npm run validate` (and so the pre-push hook) ends
  with `npm run quality:codeql` (`scripts/codeql-local.sh`, config `scripts/codeql/codeql-config.yml`): CodeQL's
  Python and JavaScript/TypeScript `code-quality` suites, the queries the github-code-quality review comments from,
  and any result fails the push. Rules ruff and ESLint have no equivalent for (for example
  `py/import-and-import-from`, `py/ineffectual-statement`, `js/superfluous-trailing-arguments`) are now caught before
  a pull request. Needs the CLI once: `gh extension install github/gh-codeql`; without it the step is skipped with a
  notice (`CODEQL_REQUIRED=1` makes that a failure). Results and databases go to the git-ignored `.codeql-local/`.
- All 12 existing findings are fixed: four test modules imported a module both with `import` and `from … import`
  (now module-qualified), the `resolve_table_env` overload stubs had `...` bodies (now docstrings),
  `promote-keywords.py` re-exported an unused constant and kept a dead assignment, a test list relied on implicit
  string concatenation, and two tests built `StorageEvent` with an init dictionary CodeQL's DOM model rejects (now one
  `dispatchStorageEvent` test helper).

## [2.37.0] - 2026-10-09

### Added

- **Markets** (Settings › Markets, `GET`/`PUT /api/markets`): a market is one country plus one language, with an
  optional city, region, coordinates, currency, and the competitors and local brand names to track there. The list is
  one BrandConfig item (`config_id = 'markets'`, `shared/markets.py`); no AWS resource was added for it. A keyword
  belongs to at most one market (`market_id`); one without is asked exactly as before.
  - Runs ask a market's keywords as a local user would: every AI engine gets a short instruction (location, answer
    language, currency) in its system channel (`instructions` / `system` / `systemInstruction`) and its native
    location hint (OpenAI and Claude `user_location`, Perplexity `user_location` with coordinates); Brave, Tavily,
    Exa, SerpAPI and Firecrawl get their country and language parameters. Live tests (Chile vs Brazil, all four
    engines) showed the instruction is what changes the answer's language, currency and competitor set; the
    location hints only steer the search, and search providers localize mostly through the query language.
  - **Add to markets…** on a keyword (`POST /api/markets`, Admin) asks Bedrock how a local user in each chosen market
    would type it and creates linked translations (`concept_id`).
  - Run Analysis, schedules, the MCP run tools and every scoped read endpoint take a market (`scope.market_ids`, the
    `market_id` query parameter). The header's market selector narrows every scoped view, report (`?market=`), the
    Citations tab and the Dashboard totals and charts (`GET /api/stats?market_id=`, whose `last_execution` is then the
    market's newest run); *All markets (combined)* is the default.
  - Content Studio group briefs (single and batch) take a market filter (`scope.market_ids`), research keywords are
    promoted into a chosen market (`POST /api/keywords/promote` `market_id`, defaulting to the header's market), and
    the MCP tools forward `market_id` / `concept_id` (`manage_keywords`, `get_dashboard_stats`, content brief tools).
  - KPI snapshots and alerts are kept per (keyword group, market), and written insights per group and market, in the
    market's language. SearchResults rows carry `market_id`; brand extraction adds the market's competitors and
    local brand names.
- **YouTube citations**: every YouTube link (`youtu.be`, `m.`, `/shorts/`, `/embed/`, `/live/`, nocookie, `&t=`/`&si=`)
  is stored as `https://www.youtube.com/watch?v=<id>`, so a video is one citation (`shared/youtube.py`,
  `test-fixtures/youtube-urls.json`). Citations carry `content_type` (`video` / `page`); the Citations tab and Citation
  Gaps show a *Video* badge, the Citations tab a type filter, a Type column in the export and, in the detail view, the video's title, channel and
  thumbnail. The crawler reads videos from YouTube oEmbed (pinned host, no redirects, 64 KB cap) instead of an
  AgentCore browser session.
- **Themed MCP sign-in**: the Cognito Managed Login pages an MCP client opens (`/oauth2/authorize`, the Allow/Cancel
  consent screen, the token endpoint's error pages) now carry the dashboard palette instead of Cognito's default —
  gray-900 header, white / gray-800 surfaces, blue-600 links, 8 px control radius, and the sidebar's bar-chart logo
  (`lib/constructs/managed-login-branding.ts`). A deploy-time custom resource seeds Cognito's default branding,
  describes it merged, patches only the known colour / radius / logo keys, and calls `UpdateManagedLoginBranding`;
  the MCP server depends on it so the OAuth endpoints are not advertised before their login pages are themed. The
  consent copy and layout remain Cognito's own (branding is colours, radius and logo only).

### Changed

- **Perplexity runs on the Agent API** (`POST /v1/agent`, `web_search` tool, default model `perplexity/sonar`): the
  Sonar Chat Completions API was retired on 2026-09-27. Saved `sonar` / `sonar-pro` / `sonar-reasoning-pro` models
  are read as `perplexity/sonar`; the Settings picker lists the Agent API models. Each answer's vendor-reported cost
  is stored (`metadata.cost_usd`). Keyword research uses the same client.
- **OpenAI** uses the `web_search` tool (not the legacy `web_search_preview`) with `tool_choice: required`, so every
  answer searches; its HTTP timeout is 180 s.
- **Claude** uses the newest web search tool (`web_search_20260318`, dynamic filtering) with no `max_uses` cap and
  4,096 output tokens; a model that refuses dynamic filtering is asked again with `allowed_callers: ["direct"]`, and
  an in-body `too_many_requests` / `unavailable` search error is retried. Default model `claude-sonnet-5-5`.
  OpenAI and Claude get three attempts per answer in analysis runs (was five), so a stalled engine cannot outlast the
  provider Lambda's 900 s.
- **Gemini** default model `gemini-3.6-flash` (the replacement Google lists for `gemini-3-flash-preview`).
- Citations are no longer capped: every deduplicated citation is stored; only the crawl list keeps the
  `MAX_CITATIONS_PER_KEYWORD` cap (Step Functions state size, crawl cost). `total_citations_found` counts every
  stored citation. The deduplication Lambda's timeout is 120 s.
- A 4xx answer other than 429 from a provider is no longer retried (it cannot succeed when resent).

### Fixed

- Raw responses of different personas no longer overwrite each other in S3: the key gained the query prompt,
  `raw-responses/{date}/{keyword}/{provider}/{query_prompt_id}/{timestamp}.json`.

## [2.36.1] - 2026-10-08

### Changed

- ruff now selects `PIE` (flake8-pie). PIE790 reports the no-effect placeholders CodeQL flags as "Statement has
  no effect" (`...` / `pass` beside a docstring), so they fail `npm run validate` instead of reaching code scanning.
  The ten `@route_handler` handler bodies, which the router never calls, now `raise RouteNotHandledError(__name__)`
  (`shared/decorators.py`): reaching one is a bug, and `@api_handler` answers it with a sanitized 500. Two test
  lambdas that only wrapped `dict` and a double `startswith` were fixed by the same rules.
- ruff also selects `DTZ`, `LOG`, `G`, `RET`, `C4`, `PERF`, `FLY`, `FURB`, `PGH`, `T10`, `ISC`, `RSE`, `PLW` and `A`,
  and pyright reports unnecessary `isinstance` calls, unnecessary comparisons and deprecated APIs as errors. The 101
  logger f-strings are lazy `%s` arguments and `logger.error(..., exc_info=True)` in `except` is `logger.exception`
  (`@api_handler` included). Guards on untrusted input (request bodies, Step Functions events, the SSRF check, prompt
  sanitising) are typed `object` so the checks stay; guards on boto3 responses and in-process data were dead and are
  gone. `_update_request` takes `status: str | None`, `@contextmanager` helpers return `Generator`, and the two
  routers share `shared.router.route_not_found`. `global` lazy clients (`PLW0603`) and the API's `id` / `type`
  request parameters (`A002`) are allowed per file.
- **`npm run validate` runs before every push**, locally: `.githooks/pre-push`, linked into `.git/hooks/` by
  `npm install` (`prepare`) or `npm run hooks:install` (`scripts/install-git-hooks.sh`, which never changes git
  config and works under Code Defender's global `core.hooksPath`). Branch/tag deletions skip it;
  `SKIP_VALIDATE=1 git push` is the documented emergency bypass.

### Security

- Dependency fixes that replace Dependabot PRs #169, #170 and #171:
  - `@nx/eslint-plugin` ^23.3.0 (nx 23.3.0): local socket exposure and `nx migrate` path traversal.
  - `undici` pinned to 7.30.0 under nx: two denial-of-service fixes.
  - knip 6.40.0 and `smol-toml` 1.9.0 (root and web).
  - `source-map-js` 1.2.2 (root and web).
  - `postcss-selector-parser` 7.1.6 under Tailwind 3 (web). The built CSS is byte-identical, so Tailwind stays on 3
    rather than taking #169's major upgrade to Tailwind 4.
- Still reported: `brace-expansion` 5.0.9 bundled inside `aws-cdk-lib` (bundled dependencies cannot be overridden;
  still 5.0.9 in the latest 2.272.0; only glob patterns from this repo reach it at synth time), and in `web/` the
  `braces` advisory with no patched release, reached only through Tailwind 3's file watcher at build time (the fix
  is the Tailwind 4 migration).

## [2.36.0] - 2026-10-08

### Added

- **Settings › Bedrock models**: an Admin picks the Bedrock model behind each tier (fast / balanced / deep) from the
  account's active `global.anthropic.claude-*` inference profiles (names cleaned to e.g. "Claude Sonnet 5.5"), tests
  it, and saves it. Served by the new `manage-bedrock-models.py` in the ConfigMgmt Lambda on the existing provider
  routes with `{id} = bedrock` (`GET /api/providers/bedrock/models`, `POST .../validate`, `PUT .../bedrock`); no new
  API Gateway resources. Admin-only.
- **Test** makes a live Converse call ("Reply with the single word OK.", low effort) after reading the account's
  "Global cross-region model inference tokens / requests per minute" quotas for the model (Service Quotas, read in
  time-boxed slices and kept in the ProviderConfig row `bedrock-quotas`). It answers the request style that worked,
  the latency and the quotas, or a reason: `not_subscribed`
  (no Marketplace subscription), `access_denied`, `no_capacity` (a 0 tokens/min quota; the model is not called),
  `throttled` (capacity exhausted right now), `unsupported` (neither request style accepted, or the account's data
  retention mode), `unavailable` (legacy or retired) or `error`, with ARNs and account ids removed from messages.
- **Save** re-tests the model (unless `validate: false`) and stores `model`, `request_style`, `model_updated_at`,
  `updated_at` and `tested_at` in the ProviderConfig row `bedrock-<tier>`; a failed test is refused with 400 and its
  reason. Choosing the default model (or none) removes the override. These rows never appear in
  `GET /api/providers`.

### Changed

- **Runtime Lambdas use the saved model**: `shared/models.get_model_id` resolves `BEDROCK_MODEL_<ROLE>` → the tier's
  saved model → the tier default, reading the row through `DYNAMODB_TABLE_PROVIDER_CONFIG` (cached 60 s per tier per
  container; a DynamoDB error or a missing variable falls back to the default with one warning per period). Every
  Lambda that calls `shared.models` (the per-provider search functions, Crawler, ReportInsights, ResearchWorker,
  StatsInsights, ManageBrandConfig, SelfReflection, Content Studio API and worker) gets the variable and
  `dynamodb:GetItem` on the table; ConfigMgmt gets the Claude-only `bedrock:InvokeModel` grant,
  `bedrock:ListInferenceProfiles` / `GetInferenceProfile` and `servicequotas:ListServiceQuotas` / `GetServiceQuota`.
- **Request-style detection** replaces the 5.5-only list: a saved model uses the style its test proved; any other
  model starts from a first guess by family (adaptive for Haiku 5.5, Sonnet 5 / 5.5, Opus 4.7 / 4.8 / 5 / 5.5;
  budget for the 4.5 and 4.6 models); a refusal naming the other style ("`temperature` is deprecated", "adaptive
  thinking is not supported", ...) is retried once in that style and remembered per model for the container.
  `build_converse_request` is the one request builder for runtime calls and the Settings test.
- **AI assistants moved into Settings** (`/settings/ai-assistants`, under Access) and left the sidebar's
  Configuration menu; `/ai-assistants` redirects there. Settings nav icons carry the design-system accent colours,
  like the sidebar.

### Fixed

- The model test no longer times out (HTTP 504) reading the quotas: Service Quotas lists Bedrock's ~1,000 quotas a
  page at a time (~126 pages and ~41 s at its default page size, rate limited with `TooManyRequestsException` when
  several tiers were tested at once). The reading is now time-boxed and resumable: each page load reads pages for up
  to 6 s and each test for up to 5 s (`MaxResults=100`, about 40 quotas a page; a throttled page ends the slice), and
  the merged global cross-region quotas and the `NextToken` are kept in the ProviderConfig row `bedrock-quotas`, so
  the next request continues where the last stopped. A complete reading is re-read daily, answering from the previous
  map meanwhile. Until the first reading completes a missing quota reads "quota still being read" (`quota.complete:
  false`), afterwards "quota not reported". The test's Converse timeouts drop to 3 s connect / 8 s read, and the
  second request style is only tried when it can still finish inside a 25 s deadline, under API Gateway's 29 s.

## [2.35.0] - 2026-10-08

### Changed

- **Bedrock processing runs on Claude 5.5**: fast = Haiku 5.5, balanced = Sonnet 5.5, deep = Opus 5.5 (global
  inference profiles; the deploy-time Marketplace subscriptions and `BedrockModelsEnabled` follow). The 5.5 models
  refuse `temperature`/`top_p` and token-budget thinking, so `shared/models.invoke_bedrock` sends adaptive thinking
  with an effort per tier (low / medium / high), adds maxTokens headroom for the reasoning, and sends no
  temperature. Without a `thinking` field they think at full effort, so every call names one. A model pinned with
  `BEDROCK_MODEL_<ROLE>` that predates them keeps the token-budget request. Checked with live Converse calls for
  every role.

### Fixed

- CDK unit tests no longer fill the disk: each synthesized test stack left a ~340 MB `cdk.out*` folder in the OS
  temp directory (24,000 of them had used 199 GB here). A Vitest global teardown
  (`lib/test-support/cleanup-synth-output.ts`) removes the folders a run created.

## [2.34.0] - 2026-10-08

### Added

- **AI Assistants page (`/ai-assistants`)**: the dashboard now explains how to connect Claude (claude.ai /
  Desktop), Claude Code, ChatGPT, Kiro, Amazon Quick and other MCP clients to the MCP server. It has the server URL
  and OAuth client id with Copy buttons, per-client steps and snippets (a downloadable Kiro `mcp.json`), the
  one-time admin command for clients whose callback isn't allowed by default, example prompts, copyable assistant
  instructions and the tool list. It's reachable from the sidebar and from Settings › Access. `scripts/build-web.sh`
  reads `McpUrl` and `McpClientId` from `CitationAnalysisMcpStack`; without them the page says the server isn't
  deployed.
- Skeleton placeholders (`components/ui/Skeleton.tsx`) shaped like the content they replace, on the first load of
  every view, the Settings sections and the app frame (instead of the full-screen "Loading dashboard...").

### Changed

- **Settings is a grouped side navigation with a URL per section** (`/settings/keywords`, `/brand`, `/personas`,
  `/providers`, `/alerts`, `/users`), so a section can be linked to and bookmarked. Each entry shows its state on a
  second line ("54 keywords", the tracked industry, "9 of 9 enabled"), with a placeholder while it loads, so the
  nav no longer jumps from "General" / "0/0" to the real values.
- **User management redesign.** One role per person (Admin or Member) instead of group checkboxes; plain statuses
  (Active, Invite pending, Disabled, …); no raw Cognito ids; search and role/status filters; your own row is marked
  "You" and its role, access and delete controls are locked. The Manage dialog is accessible (dialog role, Escape,
  focus kept inside and returned), saves role and access separately, confirms disable / password reset / delete,
  and shows errors inside the dialog. Pending invites get **Resend invite**: `POST /api/users/{username}/reset-password`
  resends the invitation (`MessageAction=RESEND`) when the user has never signed in, since Cognito can't reset their
  password. An invite reports only the groups it actually added, with a warning when one failed.

### Fixed

- Layout shift on first load: Run Analysis (CLS 0.22 → 0), Settings › Alerts (0.14 → 0), Prompt Insights and
  Content Studio tab counts, the Reports landing grid and the Settings tab badges.
- Stacked dialogs (a confirmation over another dialog) no longer unlock page scrolling when the top one closes, and
  a dialog rendered inside a `space-y-*` container is no longer pushed 1.5rem down.

## [2.33.1] - 2026-10-07

### Fixed

- **MCP clients find the OAuth configuration on their own.** The MCP server now sits behind its own CloudFront
  distribution (caching off, every method and header passed through), so it has a host root: `McpUrl` is
  `https://<dist>.cloudfront.net/mcp`, the protected resource metadata is at
  `/.well-known/oauth-protected-resource/mcp` (RFC 9728) and the authorization server metadata at the host root's
  `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`. On the execute-api URL those
  locations returned API Gateway's 403, so Claude Code fell back to a non-existent `/authorize`. Claude Code now
  connects with only `--client-id` and `--callback-port 5173`, whose callback the stack allows by default. A new
  output, `McpApiUrl`, gives the API stage URL for debugging. **Reconnect MCP clients after upgrading:** `McpUrl`,
  the scope names (`<McpUrl>/read|write|run`) and the Cognito resource server change.
- **Admin MCP tools work for admins whatever scopes the client requested.** Cognito writes `cognito:groups` into an
  access token only when the client asked for `openid`, which the metadata no longer offers, so every caller looked
  like a non-admin. The server now reads the caller's groups from the user pool (`AdminListGroupsForUser`, cached a
  minute per container); a removed admin also loses access within that minute instead of at the token's expiry.
- The MCP run limit's refusal names the run still in flight, so an assistant can follow it with `get_run_status`.
- **Written insights say what each number is measured against**, in plain words: a sub-brand's position and
  sentiment gaps are against the best sub-brand, not the brand's overall KPIs, which the first narrative on real data
  had confused.

## [2.33.0] - 2026-10-07

### Added

- **More insights.** `GET /api/reports/insights` adds, for any scope: the brand's best position per keyword and AI
  engine, who the engines cite (your domains, each competitor's domains, third parties, per engine), your most-cited
  pages grouped by section with documents (PDFs and other downloads) told apart from web pages, and the competitors the
  answers word mixed or negative with up to three of the reasons they give. New insights: a competitor's sites cited
  more than yours on an engine, documents cited more than your web pages, a competitor worded mixed or negative in at
  least 30% of 5 or more mentions, and a keyword every answering engine places outside the top 3 (a prompt gap). Each
  shows the figures it rests on; the thresholds are named constants in `lambda/shared/insights_engine.py`.
- **Insight report blocks.** *Top insights*, *Prompts by engine* (cells below the top 3 highlighted, with text for
  screen readers; the 50 weakest keywords shown with a count of the rest), *Who the engines cite*, *Your most-cited
  pages* and *Competitor caveats*.
- **Written insights after each run.** For every keyword group a run fully covers, a new workflow step
  (GenerateInsights, after KpiAlerts) asks Bedrock for up to three insights and six recommendations written from the
  group's computed insights and KPIs only, in the language of the group's keywords. Each item names the insights it
  rests on; an item citing an unknown insight or a number not in their evidence is dropped. The narrative is stored in
  the new on-demand `CitationAnalysis-ReportInsights` table (kept as long as the KPI snapshots), so opening or printing
  a report never calls Bedrock, and a failure in this step never fails the run. The *Written insights* block shows it
  with the insights behind each item, the model and when it was written; admins can regenerate a group's narrative
  after a confirmation (`POST /api/reports/insights/regenerate`).
- **Competitor domains in Brand Tracking.** Each competitor can list up to 10 website domains. **Find Competitors**
  suggests them, shown unticked and saved only once you tick them and save; you can also type them. `POST
  /api/brand-config` validates `competitor_domains` (normalised like Owned Domains; a 400 names the field for an
  unknown competitor, a value that is not a domain or a limit exceeded); configs saved earlier read as having none.
- `GET /api/visibility/sentiment-examples` accepts `classification=competitor` to list competitors' passages; the
  default is still your own brands.
- **MCP spend tools in two steps.** `estimate_run` / `start_run` (admin only, as on the dashboard),
  `estimate_research` / `start_research` and `estimate_content_brief` / `generate_content_brief`: the estimate counts
  the provider and Bedrock calls and returns a single-use confirmation token valid for 5 minutes, bound to the caller
  and the exact request; the start refuses without it. Per-caller limits (1 run in flight, 5 runs and 20 research or
  content jobs per UTC day, 50 keywords per run), configurable with `-c mcpLimits`; refusals name the limit and when it
  resets. Tokens, counters and an audit record of every write and spend call (365 days) live in the new on-demand
  `CitationAnalysis-McpState` table.
- **More MCP tools and prompts.** Catalogue reads for report insights (`get_report_insights`), schedules, KPI alerts,
  run status, research jobs and templates, Content Studio items and one custom report; `get_sentiment_examples` takes
  `classification`; prompts `geo_audit` and `setup_brand_tracking`. User management, provider keys, brand-configuration
  and schedule writes and deletes stay out of reach.
- `docs/mcp.md`: connecting Kiro, Claude.ai / Desktop, Claude Code, ChatGPT and Amazon Quick, and how the
  estimate-then-confirm flow and the limits work.

### Changed

- MCP audit log lines carry the refusal reason. The main stack is at 490 of CloudFormation's 500 resources; the next
  sizeable addition has to go into another stack.

## [2.32.0] - 2026-10-07

### Fixed

- **MCP clients that check PKCE support can connect.** Cognito's discovery document omits
  `code_challenge_methods_supported`, and the MCP authorization spec tells clients to refuse such an authorization
  server; Claude.ai, ChatGPT and Claude Code did. The MCP API now serves its own authorization server metadata at
  `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`, advertising S256 and Cognito's
  managed-login endpoints, and the protected-resource metadata names it. Access tokens are still Cognito's and are
  validated as before. The metadata no longer offers `openid`, so clients do not request an ID token whose issuer
  differs from the metadata issuer.
- **A Claude key with no credit left is refused.** Saving or enabling it failed silently before ("key accepted");
  Settings › AI Providers now shows Anthropic's "Your credit balance is too low…" message.
- **Keyword Deep Dive recommendations cover the report's keyword**, not every keyword.

## [2.31.0] - 2026-10-07

### Added

- **Insights.** `GET /api/reports/insights` computes, from the same KPI engine as every other page, the facts behind
  three kinds of finding for a scope (one keyword, a keyword group or every keyword): the *play* each AI engine
  calls for (get cited, get ranked first, both, or defend, from its top-1 share and citation rate against fixed
  thresholds), the first-party brands measured against the best of them (positions behind, sentiment points below,
  marked weak past a gap), and, for a keyword group, how far each keyword's position swung across the runs of the
  window and how often its mention flipped. Every insight carries its severity and the numbers it rests on, so what
  it says is what the report shows. Rules and thresholds are named constants in `lambda/shared/insights_engine.py`;
  the response has a `narrative` field reserved for a later phase (always `null`).
- **Insight blocks in custom reports.** A new *Insights* category offers *Engine playbook*, *Brand portfolio* and
  (for a group scope) *Run stability*, each a table of the facts with the derived insights called out above it.
- **Insights on the Visibility tab.** A panel reads out the scope's three most pressing insights, most severe first,
  with a link to build a report around them.
- **Scope for Prompt Insights, Citation Gaps and the Action Center.** The three views share one scope picker (every
  keyword, a keyword group or one keyword, as on the Visibility tab); `GET /api/prompt-insights` and
  `GET /api/recommendations` take the scope parameters every KPI endpoint takes (`keyword`, `group_id`,
  `keyword_ids`, `scope=all`) and, without one, behave as before. A scoped recommendation prompt names the keywords
  it covers, so the model recommends for that scope only.
- **MCP server (preview).** A second stack, `CitationAnalysisMcpStack`, exposes the dashboard's data to MCP clients
  such as Claude.ai, ChatGPT and Amazon Quick: a Streamable HTTP endpoint (`POST /mcp` on its own REST API,
  `CitationAnalysis-McpApi`) backed by one Lambda that replays each tool call against the existing API handler
  Lambdas as the signed-in user, so every permission check and every number stays the dashboard's. Eight direct
  tools (`list_keyword_groups`, `list_keywords`, `get_brand_config`, `get_visibility`, `get_report`,
  `get_citations`, `list_recommendations`, `manage_keywords`) plus `search_tools` → `describe_tool` → `call_tool` over
  a catalogue of ten more, so `tools/list` stays small; `-c mcpPinnedTools` promotes catalogue entries. Every tool
  result carries the data twice, as `structuredContent` and as JSON in the text block, because some hosts (Kiro
  among them) show the model only the text. Sign-in is OAuth 2.1 with PKCE through a Cognito Managed Login domain
  (`citation-analysis-<account>`) and a public `mcp` app client, 1-hour access tokens and 90-day refresh tokens.
  The Cognito resource server is identified by the MCP endpoint URL, so the scopes are `<McpUrl>/read`,
  `<McpUrl>/write` and `<McpUrl>/run` and an RFC 8707 `resource` parameter naming the endpoint, which MCP clients
  send, binds the access token's `aud` to it (Cognito refuses custom scopes for a resource bound to any other
  identifier). The Lambda checks the token's issuer, client, use and audience behind the Cognito authorizer and
  answers anonymous calls with `401` and the `WWW-Authenticate` resource-metadata pointer (RFC 9728). Register each
  client's callback URL with `-c mcpRedirectUris`. The stack's outputs (`McpUrl`, `McpClientId`, `McpAuthorizeUrl`,
  `McpTokenUrl`, `McpResourceMetadataUrl`) are what a client's connection form asks for; Kiro connects with
  `oauth.clientId` set to `McpClientId` and needs no dynamic client registration. Proven live from Kiro CLI (chat and
  ACP) on 7 October 2026. Reserved concurrency of 10.

### Changed

- **Two stacks.** `npm run deploy`, `npm run deploy:cdk` and `scripts/deploy.sh` run `cdk deploy --all`; the MCP
  stack depends on the main stack and can be destroyed on its own. The main stack sits just under CloudFormation's
  500-resource limit, which is why the MCP server has its own API. Only the user pool and the router Lambdas cross
  the stack boundary; the MCP stack builds its own version of the shared layer (`CitationAnalysis-McpSharedLayer`)
  from the same build output, because a layer version's ARN changes with every rebuild and CloudFormation refuses to
  update an exported value another stack imports.

### Fixed

- **A scope with no active keyword no longer widens the Executive Summary.** The overview endpoint returned the
  recommendations of every keyword for a group whose keywords are all paused, because an empty keyword list read as
  "discover the active keywords"; it now returns none, and `GET /api/reports/insights` refuses such a scope.

## [2.30.1] - 2026-10-07

### Fixed

- **Switching a provider on proves it first.** `PUT /api/providers/{id}` with `enabled: true` now runs one real call
  with the stored key before the flag is saved: for the AI engines a one-line answer from the configured (or default)
  model, which is the only probe that surfaces an exhausted credit balance (Anthropic reports it as a 400 the key probe
  reads as "key accepted"); for the search providers the key probe. A passing probe records a fresh success on the
  provider row, so the Settings card stops showing the failure that caused the auto-disable weeks earlier; a failing
  probe leaves the provider off, records the failure as of now, and the card and an error notice show the provider's
  own reason ("Provider check failed: Your credit balance is too low…"). `validate: false` skips the probe, as for a
  key or a model. A model that passed its check on save also records the success it just proved.

## [2.30.0] - 2026-10-03

### Added

- **Recommendation status in the Action Center.** Each rule-based recommendation has a status menu (New, In
  progress, Done, Won't fix) that saves through `POST /api/recommendations/{id}/status`, so the status survives a
  reload, a re-run and another user opening the page. The menu is disabled while it saves, done and won't-fix items
  are dimmed, and a failed save says so and keeps the previous status. Notes and links already stored with a
  recommendation are sent back with each change, so the endpoint's full-row write does not erase them.
  AI-enhanced recommendations have no stable id and show no menu.

### Fixed

- **Provider failures are counted by category.** The search Lambda dropped `error_category` from the result it
  hands to Step Functions, so the run summary filed every provider failure under `unknown`; it now shows `insufficient_credit`,
  `invalid_key`, `rate_limited` and `timeout`.
- **Persona Rankings** show the KPI visibility score (`kpi_engine`, position-weighted). They used a second,
  differently weighted formula, so the same brand scored differently there (for example 85.6 instead of 100.0).
- **First-party domains are matched one way everywhere.** Citation Gaps now treats `example.com:443`, `example.com.`
  and bare-domain citations as first-party, as the KPIs already did, and a malformed citation URL no longer breaks
  the KPI calculation. Adding an owned domain in Brand Tracking stores the same canonical domain (no port, query,
  credentials or edge dots). `test-fixtures/domain-identity.json` pins the rules for Python and TypeScript.
- Adding a keyword flags full-width, decomposed-accent and other Unicode variants of an existing keyword as
  duplicates, matching what the API already rejected.
- Provider names read "OpenAI", "Google Gemini" and "Anthropic Claude" everywhere (keyword details showed
  "Openai"); provider badges use the chart colours. A contract test pins provider ids, names and default models
  between the dashboard and the Lambdas.
- The Visibility leaderboard says "first-party", like the KPI guide and the reports.
- A sentiment share note rounds like its chart (28.8%, not 28.7%).
- The self-reflection 24-hour cache is measured in UTC; a stored timestamp with an offset is converted instead of
  having its offset dropped, and a malformed one is a cache miss instead of a 500.
- The decorative Refresh and Invite icons in Settings › Users are hidden from screen readers.

### Changed

- **Duplicate and dead code sweep.** Clones at the new 25-token / 3-line floor went from about 1,950 to 501, all
  reviewed as incidental and recorded in `.jscpd-baseline/`; together with the dead code removed below, production
  code shrank by about 2,450 lines. The CDK stack has one factory each for Lambdas, IAM grants and routes, and
  deduplicating it left the synthesized template unchanged; one search flow for every
  search provider; one conditional-write, paginator, timestamp, percent, priority-order and sentiment-label helper in
  `lambda/shared`; one saved-template hook, error factory and icon component in the dashboard; exports nothing
  imports were removed.
- **Duplication gate:** jscpd runs at 25 tokens / 3 lines, ignoring comments and comparing `.ts` with `.tsx`; any
  clone not in the baseline fails `npm run validate`. `npm run duplication:baseline` rewrites the baseline.
- The lines the sweep changed were mutation-tested (mutmut and Stryker) and the survivors closed with tests or
  removed as dead code: Python tests went from 3,372 to 3,626 and dashboard tests from 4,600 to 4,816. Contract tests
  now also pin the research state-machine timeout against the stale-job sweep and the Bedrock tier defaults between
  the CDK stack and `shared/models.py`.
- `npm run contracts` no longer counts fixture modules under `web/src/types` as type declarations.

### Removed

- **Dead code** no production path reaches: unused shared helpers and constants (`provider_health.describe_category`,
  `auth.USERS_GROUP`, fail-fast table names nothing read), parameters and defaults every caller overrides, a
  never-used raw-response option of research job views, a re-raise-only `try`, `lambda/layer/test-layer.py`, and on
  the dashboard about 20 component props and hook return members no caller passes or reads, two unused `export`s,
  51 dark-mode CSS overrides for classes nothing uses, and Tailwind animation settings that restated the defaults.
  Config entries that matched nothing (vulture exemptions, five ruff ignores) are gone, so those gates are stricter.
- **Legacy table env-var aliases (audit #12).** Every Lambda reads only the canonical `DYNAMODB_TABLE_*` name;
  `KEYWORDS_TABLE`, `SEARCH_RESULTS_TABLE`, `CITATIONS_TABLE`, `CRAWLED_CONTENT_TABLE`, `CITATIONS_TABLE_NAME`,
  `PROVIDER_CONFIG_TABLE`, `QUERY_PROMPTS_TABLE`, `KEYWORD_RESEARCH_TABLE` and `RECOMMENDATION_STATUS_TABLE` are no
  longer set, and `resolve_table_env` has no fallback. Code and configuration change in the same deployment.
- **The 2.14.0 Content Studio drain.** Generation has run only in ContentStudioWorker since 2.14.0, so the API Lambda
  drops its temporary 300 s timeout (now the 29 s API Gateway ceiling), its reserved concurrency, and its Bedrock,
  crawled-content, table-scan and Lambda-invoke permissions; the handler drops the pre-rollout `async_generation`
  forwarder. A stack still on a release before 2.14.0 should deploy 2.14.0–2.29.0 first.
- **The unused `CitationCountIndex` GSI** on `CitationAnalysis-Citations`. Deploying deletes the index (an online
  change that lowers write cost); no reader ever queried it.
- **Code no entry point reaches** (found by a call graph walked from every handler, route map, Step Functions task
  and `main.tsx`, by member read/write analysis, and by coverage runs): the never-rendered `ContentGenerator`
  component; dashboard hook actions no screen calls (brand-config reset, expand and refetch, provider key
  validation, execution monitoring start, generating-item refresh) and the response fields,
  error metadata and execution-progress values nothing displays; unused modal sizes, the never-emitted `critical`
  alert severity and the all-competitors report variant the dashboard never requests; 16 unused barrel re-exports.
  In the Lambdas: the search Lambda's `provider_types` filter and unread output keys, ParseKeywords' never-used
  `keywords_file` input (and its S3 read permission), fallbacks for table and bucket env vars CDK always sets,
  retry and model options no caller passes, and the `shared` package's unused re-exports.

## [2.29.0] - 2026-10-03

### Added

- **Custom reports ("Build your own report").** On **Reports**, *Create custom report* opens a builder: name the
  report, pick its period (30, 90 or 180 days), and add blocks from a list sorted into categories, with a search box.
  The blocks are the sections of the nine reports (45 in all) and four content blocks you write yourself: a heading,
  Markdown text, an https image (with a required description and an optional caption) and a YouTube or Vimeo video.
  Blocks are added with their Add button or dragged onto the report, and reordered by dragging or with their arrow
  buttons. A saved report can be edited, saved as a new report or deleted.
- Saved reports are shared: every signed-in user sees them and can create, edit and delete them (at most 50). A
  report opens on every keyword over its saved period; the reader can narrow it to a keyword group or one keyword,
  change the period and pick the competitor of its Competitor Gap blocks, all kept in the URL, and print it to PDF.
  Each data source is fetched once however many blocks read it. A block that needs a particular scope says which one
  instead of showing the wrong data, and a block type the dashboard no longer offers is skipped, so a removed block
  never breaks a saved report. Markdown is rendered without raw HTML; a printed video shows its link.
- **API:** `GET`/`POST /api/custom-reports` and `PUT`/`DELETE /api/custom-reports/{id}` on API-ConfigMgmt
  (`lambda/api/manage-custom-reports.py`), validating every block (type, fields, https links, embeddable video links)
  and answering 409 `limit_reached` past 50 reports. New table `CitationAnalysis-CustomReports` (on demand, PITR,
  `RETAIN`).

### Security

- The dashboard's content security policy gains `frame-src https://www.youtube-nocookie.com https://player.vimeo.com`
  for video blocks; no other origin may be framed. Raw HTML blocks are deliberately not offered: saved reports are
  shared and the policy allows inline scripts, so user HTML could take over another user's session.

## [2.28.1] - 2026-09-30

### Security

- **Dependencies patched for every open Dependabot alert:**
  - `dompurify` 3.4.13 → 3.4.16 in the dashboard. It sanitizes rendered answers; low severity, IN_PLACE hook XSS,
    GHSA-p98j-92pf-mc4p.
  - `axios` 1.19.0 → 1.20.0. Development-only, pulled in by Nx; ten advisories including GHSA-m8m8-qj5v-23w3 and
    GHSA-r4gj-5m52-g5wh.
  - `brace-expansion` 5.0.9 → 5.0.12, root and dashboard. Development-only; DoS advisories GHSA-6j4f-fj2g-mc7p,
    GHSA-qhr7-859c-m2p7 and GHSA-q2hr-2g5m-vwhr.
- The override floors for `axios` and `brace-expansion` in `package.json` are raised to the patched versions, so a
  later lockfile refresh can't resolve a vulnerable one again. This supersedes Dependabot's #158, which bumped only
  the root `brace-expansion` and left the override floor at `^5.0.5`.
- One copy is still flagged: `aws-cdk-lib` bundles `brace-expansion@5.0.9` inside its own package, up to and
  including 2.272.0. npm overrides cannot reach a bundled dependency, and no `aws-cdk-lib` release ships a fixed
  copy yet. It runs only at synth time on the glob patterns in this repository's own CDK code, never on outside
  input, so the DoS is not reachable. Revisit when `aws-cdk-lib` updates its bundled `minimatch`/`brace-expansion`.

## [2.28.0] - 2026-09-30

### Fixed

- **SerpAPI no longer times out.** On the free plan a Google search through SerpAPI usually takes a few seconds
  but sometimes over a minute (78 s measured). The client gave up after 30 s and sent the same search again, up to
  five times, so on the 2.27.0 proof run 5 of 44 keywords got no SerpAPI results and the run was reported
  degraded. Searches are now submitted with `async=true` and read back from SerpAPI's Search Archive (free) until
  they are done, so a slow search is waited for instead of re-sent. An account that has run out of searches is
  reported as out of credit straight away instead of being retried. The keyword-research Google signals use the
  same client. The API key is masked in every SerpAPI error and log line (`requests` put it in connection errors).
- **Rate limits are waited out, not failed.** Clients honour `x-ratelimit-reset` (Perplexity) as well as
  `Retry-After`, and the analysis search Lambdas allow 12 more throttled attempts than the default, so a
  per-minute limit cannot fail a call.

### Changed

- **Providers run at the same time, and 20 keywords at a time.** Each keyword used to call its nine providers one
  after another inside one Lambda (about 2.3 minutes per keyword on the last run) and three keywords ran at a time.
  `SearchAllProviders` is now a Parallel state with one `CitationAnalysis-Search-<provider>` Lambda per provider,
  merged before deduplication. Each provider's Lambda has reserved concurrency, which caps its calls in flight
  across the whole run: a keyword whose provider is at its cap waits for a slot (Step Functions retries the
  throttled invoke with jittered backoff), and a provider Lambda that still fails is recorded as that provider's
  failed call instead of failing the keyword. Defaults were measured locally against the real APIs with our keys
  (Perplexity allows about one request a second, Firecrawl about six searches a minute on our plan) and can be
  raised per deployment with `-c providerConcurrency` (see the README). Keywords run 20 at a time
  (`processKeywordsConcurrency`, was 3) and cited pages are crawled 10 at a time (`crawlConcurrency`, was 3).
- **Measured on the same 44 keywords** (all active keywords, no personas, eight enabled providers):

  | | 2.27.0 | 2.28.0 |
  |---|---|---|
  | Run time | 79 min | 5.6 min |
  | Successful provider calls | 347 of 352 (SerpAPI 39 of 44) | 352 of 352, every provider 44 of 44 |
  | Run status / KPI alerts | `completed_degraded`, alerts skipped | `completed`, 5 group snapshots recorded |
  | Per keyword, median | ~5 min | 99 s (search 60 s, crawl 37 s) |

  Firecrawl is now the slowest provider on our plan (about six searches a minute; p90 134 s including waiting for
  a slot); a paid plan and a higher `providerConcurrency.firecrawl` remove that wait. Rate limits still happen and
  are waited out (38 Firecrawl and 8 Perplexity 429s on that run, none of them failed a call).
- The single `CitationAnalysis-Search` Lambda and the `CitationAnalysis-SearchFunctionArn` export are removed (no
  stack imports the export); its log group is kept (Retain) so earlier runs stay readable until retention expires
  them. `scripts/quick-error-check.sh` reads the nine provider log groups and `scripts/deploy.sh` verifies the nine
  provider Lambdas.
- Deduplication sanitizes the keyword the way the search step does, so Citations and SearchResults keep one key.

## [2.27.0] - 2026-09-30

Reported and first fixed by [@bastiandelrioblanco](https://github.com/bastiandelrioblanco), who found that keyword
groups past 500 keywords lost members in the Run Analysis picker and traced it to the default limit in
`get-keywords.py`. His change (500 → 1,000) is the first commit of this release and is now the page size.

### Fixed

- **Every keyword appears, however many there are.** `GET /api/keywords` returned a single table-scan page (500
  keywords, and fewer when filtered, because DynamoDB applies the limit before the filter) with no way to ask for
  the rest, and every dashboard keyword list was built from that page. A group could show "(612)" while its picker
  listed a few hundred. The endpoint is now cursor-paginated (`next_token` in the response and the query; up to
  1,000 keywords per page) and the dashboard follows it to the last page, for the normal load and for the
  consistent read after promoting researched keywords. `complete` is gone from the response, and
  `authoritative=true` now means a strongly consistent read of one page.
- **Analysis runs no longer fail as they grow.** The ProcessKeywords step kept every keyword's result in the run's
  state and history. Measured on real runs: about 8.5 KB and 160 history events per keyword against a 256 KB state
  limit and a 25,000-event history, so runs over about 31 keywords failed with `States.DataLimitExceeded` after
  all their searching and crawling, and the 2-hour timeout ended a run at about 60 keywords. ProcessKeywords is
  now a Distributed Map: ParseKeywords writes the keyword list to S3 (`runs/<execution>/keywords.json`), each
  keyword runs as its own child execution that ends with a compact result, the results go to S3, and
  GenerateSummary reads them from there and returns a compact report (the full one, with every keyword, is stored
  under `execution-summaries/` as before; KpiAlerts reads it from there). The trigger endpoints start runs with the
  scope instead of the keyword list, and an explicit legacy keyword list too large to fit the execution input is
  refused with a 400 that names the fix. The run timeout is 7 days: at the default concurrency a keyword takes
  about 2 minutes, so 1,000 keywords take about a day. `runs/` objects expire after 30 days.
- **One failing keyword no longer throws away the run.** Up to 10% of a run's keywords may fail; they are
  reported as failed keywords (`completed_with_errors`, which KPI alerts skip as before). Above 10% the cause is
  systemic and the run stops.
- **Group membership changes over 500 keywords** are sent in requests of 500 instead of being refused, and a
  partial failure reports how many were applied. Deleting a group, and changing many memberships at once, update
  the keywords in parallel so large groups finish inside the API time limit.
- **Picking more than 1,000 keywords** one by one in Run Analysis or Schedule stops at 1,000 (the API's limit for
  keyword-id scopes) with a hint to run whole groups, which have no limit, instead of failing on submit.
- **Brand visibility's default keywords** (Content Studio ideas, recommendations) read the active keywords from the
  status index instead of a 100-row scan that could return none of them in a large table.

### Changed

- **Run progress counts keywords.** Run Analysis shows three steps (parse keywords, process keywords, summary) and
  "N of M keywords" (plus failures) while the keywords run, from the Distributed Map's item counts. Each step spells
  out its status in text.

## [2.26.1] - 2026-09-29

### Changed

- **KPI definitions collapse.** "How these KPIs are measured" at the end of every report and of the Visibility tab
  is now a heading with a chevron that expands the definitions, collapsed by default, so it no longer takes a
  screen of space; the "i" tooltips carry the same text. Printed reports and `?print=1` previews always show the
  definitions in full. The shared `ui/Disclosure` component does this and is documented in `docs/design-system.md`.

## [2.26.0] - 2026-09-29

### Added

- **Choose the Perplexity and Claude models** in Settings > AI Providers (**Change model**), like OpenAI and
  Gemini. Perplexity offers its Sonar models (`sonar`, `sonar-pro`, `sonar-reasoning-pro`; `sonar-deep-research`
  is left out because one answer takes minutes). Claude lists the Claude 4 and later models your key can use. Any
  id can be typed. As for OpenAI and Gemini, a model is saved only after it answers a real web-search request
  with the stored key: Sonar Chat Completions for Perplexity, the Messages API with the web search tool for
  Claude. Analysis runs and keyword research use the chosen model; every answer still records the model that
  actually answered.

### Changed

- Settings model checks and the analysis clients build their Perplexity and Claude requests from the same helpers
  (`shared/ai_clients.py`), so a model is checked against exactly what runs send.

## [2.25.0] - 2026-09-29

### Added

- **The answers behind every sentiment count.** The Sentiment report's AI-engine section gains a table of the
  positive, neutral, mixed and negative counts for all engines and for each engine. Each count opens a window that
  lists the answers behind it: the brand, the passage that carries the sentiment (verbatim), why it was labelled that
  way, the ranking context, the keyword, engine, persona and run date, and the full answer on demand. The counts and
  the list come from the same answers and sightings as the report's KPIs (each keyword's latest run).
- `GET /api/visibility/sentiment-examples` (scope, `sentiment`, optional `provider`, `limit` up to 50): those
  answers, with `total` (see "Net sentiment" in `docs/kpi-definitions.md`).

### Changed

- **Sentiment labelling is defined.** The extraction prompt now labels how each answer portrays each brand, not the
  tone of the whole answer: positive (recommended, praised or credited with a favourable attribute), negative
  (criticised, warned against, or its drawbacks dominate), mixed (clearly both), neutral (named or listed without
  praise or criticism; being listed is not by itself positive). Before, the labels were undefined and the only format
  example was positive. It also asks for the verbatim passage (`sentiment_quote`) and a one-sentence English reason,
  drops any label outside the four, and allows a longer reply so long brand lists are not cut off. The new definition
  applies to answers analysed from this release on.
- The Keyword Deep Dive's sentiment examples show the verbatim passage as the quotation and the reason as "Why: …";
  before, the model's paraphrase appeared in quotation marks as if the engine had said it. `/api/brand-mentions`
  appearances carry `sentiment_quote`.
- The brand-configuration prompt preview shows the same fields as the real prompt.

## [2.24.1] - 2026-09-29

### Fixed

- **KPI tooltips** wrap their text and stay on screen. The "i" tooltip inherited `whitespace-nowrap` from table
  cells, so a definition ran on one line out of its box, and a scrolling table clipped the box at its edge. The
  tooltip now opens above the page (rendered into `document.body` with fixed positioning), wraps and aligns its
  text left, keeps a margin from the window edges, opens above its button when there is no room below, and follows
  the button while the page or a table scrolls.

## [2.24.0] - 2026-09-29

### Removed

- **AWS WAF.** The stack no longer declares a web ACL: the CloudFront web ACL (its us-east-1 custom resource,
  handler and `CloudFrontWafWebAclArn` output) and the regional web ACL on the Cognito user pool are gone, so the
  sample stays pay-per-use. Both ACLs had already been deleted from the deployed account, and CloudFormation
  was still tracking them, so the next change to the distribution or the user pool would have failed. `SECURITY.md`
  describes what protects the app without them and how to add one.
- `openai`, `httpx` and `anyio` from the shared Lambda layer: every AI provider is called over REST with
  `requests`, so nothing imported them. The layer shrinks to about 8 MB.

### Changed

- The `version-check` workflow also requires a version bump when `web/vite.config.ts` changes, when either
  `package.json` changes its dependencies or `overrides`, and when either lock file resolves a different
  package. Dependabot pull requests now need a maintainer to add the bump and changelog entry.
- Estimated AWS cost for the example workload drops to $12–50 a month (README, Cost).

## [2.23.3] - 2026-09-29

### Changed

- `docs/kpi-definitions.md` is now a guide to our own KPIs only: the comparisons with third-party products and their
  source links are removed, and the code comments and this changelog no longer name other products.

## [2.23.2] - 2026-09-29

Documentation brought up to date with the code; out-of-date content removed.

### Changed

- **README.md** rewritten against the code: the dashboard tabs and Settings tabs, the nine reports, the KPIs (linked to
  `docs/kpi-definitions.md`), the full architecture (Lambdas, layers, tables, state machines, buckets), the build and
  deploy steps, configuration and secrets, security, cost and the validation gates.
- **SECURITY.md**, **CONTRIBUTING.md**, **THIRD_PARTY_LICENSES.md**, the PR and bug-report templates,
  `docs/design-system.md` and `docs/kpi-definitions.md` corrected to match the code, with their history tables and
  "replaces" notes dropped (the history stays in this changelog).
- `scripts/deploy.sh` and the stack's `DeploymentInstructions` output point to Settings > AI Providers for the API keys instead of a
  `setup-secrets.sh` script that does not exist.

### Removed

- Out-of-date docs: the May 2026 design-system audit and its audit prompt, the keyword-groups delivery plan, and the
  2.23.0 report benchmark.

## [2.23.1] - 2026-09-29

Mutation sweep over every line changed in 2.21.0–2.23.0 (Python with mutmut, the dashboard with Stryker): each
surviving mutant is now caught by a test, removed as dead code, or annotated as presentation-only.

### Removed

- The unused "Coming soon" state of the Reports landing cards: every report is built, so each card is a link.

### Changed

- The `/reports/overview` hook checks its response with the same guard as the `/visibility` and `/trends` hooks.
- The keyword table sorts rows with a value on their own and appends the rows without one in their original order
  (same order as before, without relying on the comparator's tie handling).
- Column lists of the report tables are built at render time, so a wrong KPI id fails a test instead of the module import.
- Tests pin the chart palette and KPI colours, the tooltip and title texts, the malformed responses each hook rejects,
  a padded `period` query value on `/trends`, and chart redraws when their props change.
- `web/stryker.config.mjs` ignores `.stryker-tmp`, so parallel runs with their own temp directory no longer copy each
  other's sandboxes.

## [2.23.0] - 2026-09-29

Four new reports, every KPI shown per engine, and charts across the reports.

### Added

- **Four reports**, each for one keyword, a keyword group or all keywords, over 30, 90 or 180 days, printable:
  - **Competitor Benchmark** (`/reports/benchmark`): your standing, the share-of-voice donut, the leading
    brands over time by share of voice, mention rate or visibility score, and the leaderboard with every KPI.
  - **AI Engines** (`/reports/engines`): which engines name you, the headline KPIs per engine as grouped bars,
    every KPI per engine, and the sentiment split per engine.
  - **Sources** (`/reports/sources`): your citation KPIs, the most cited domains with yours highlighted, and every
    cited domain with its citation rate, citation share, engines and keywords.
  - **Sentiment** (`/reports/sentiment`): net sentiment with its change and split, net sentiment over time, the
    split per engine and the net sentiment of every brand.
- **Data for them**, from the same answers and KPI definitions (`docs/kpi-definitions.md`, "Breakdowns"):
  - `/visibility`: `engines` (every KPI per AI engine), `sources` (the 25 most cited domains, of `sources_total`).
  - `/trends`: `brand_trends` (your brand and the 5 leading competitors per period) and `latest_brands`.
  - `/reports/overview`: `trend_data` and `latest_brands`.
- **Charts** (`web/src/components/Reports/charts/`, `docs/design-system.md` §7.5) in the existing reports and the
  Visibility tab: KPI trend lines, share-of-voice donuts next to the leaderboards, the engine chart, top domains,
  and a trend snapshot in the Executive Summary. Every chart has its figures in words for screen readers.
- **The Visibility tab's Excel export** gains Engines and Sources sheets.
- **Every KPI per engine** in the Keyword Deep Dive and on the Visibility tab, in the same table as the AI Engines report.

## [2.22.0] - 2026-09-29

### Changed

- **The Visibility tab, `/visibility`, `/trends` and `/reports/overview` now use the shared KPIs**
  (`docs/kpi-definitions.md`), computed by the KPI engine from successful AI answers only.
  - **`/visibility`** returns one response shape for every scope (one keyword, a group, selected keywords, all):
    - every KPI over each keyword's latest run, pooled;
    - its change since each keyword's previous run, over the keywords answered in both;
    - the brand leaderboard and a row per keyword.
    - It reads each keyword's last two runs through the sort key instead of the whole partition.
  - **`/trends`** returns every KPI per day, ISO week or month; the latest standing and its change against
    the previous period (like for like); and each keyword's own move. The window is a key condition, and it
    no longer falls back to the whole history when the window is empty.
  - **`/reports/overview`** reports the latest KPIs and their change, the keywords by trend, and the top movers
    by visibility-score change. The "change percent" of a score is gone; changes are in points.
- **The Visibility tab** shows one overview for every scope:
  - the headline cards and every KPI with change and trend;
  - the visibility-score history;
  - a sortable keyword table and a brand leaderboard;
  - a definitions block, with a tooltip on every KPI.

  The mislabelled "Citation rate" (it was keyword coverage), "Provider coverage" and "Prominence" cards are
  gone. The Excel export carries every KPI.
- **Reports.** The Brand Visibility report (keyword and all-keywords modes), the Executive Summary and the
  Keyword Deep Dive now use the shared KPI headline, the per-period KPI tables and the brand leaderboard.
  - Every report ends with a definitions block.
  - Movers follow the trend rule (2 points), not a 5-point threshold.
  - No KPI is computed in the browser any more.
- **Trend direction** everywhere follows the 2-point rule between two comparable periods. The linear-regression
  slope is gone.

### Removed

- `shared/visibility_metrics.py`, the equal-keyword group summary and the three-factor score of
  `shared/visibility_score.py`, and `shared/providers.py`. What remains of `visibility_score.py` serves
  `/persona-rankings` until it moves to the KPI engine.
- The provider-config read and grant of the stats Lambda, which no longer needs them.

## [2.21.0] - 2026-09-28

### Added

- **KPI reference** in `docs/kpi-definitions.md`. It gives one definition per KPI: the formula, the
  denominator and the edge cases.
- **KPI engine** (`lambda/shared/kpi_engine.py`). Every KPI is computed once from the same unit, the
  successful AI answer:
  - answers and mentions;
  - mention rate and share of voice;
  - average position, top-1 share and top-3 share;
  - visibility score;
  - citations, citation rate and citation share;
  - net sentiment;
  - engine coverage and keyword coverage.
- **Contract test.** `test_kpi_contract.py` fails when the reference, the engine and the dashboard's
  `kpiDefinitions` list different KPIs or labels.
- **Real citation KPIs.** Citation rate and citation share now count AI answers that cite the brand's own
  website. A URL is owned when its domain is an owned domain or a subdomain of one. Owned domains are
  set in Settings › Brand Tracking.
- **Every KPI in the per-group report.** The report now shows:
  - four headline cards;
  - a table of every KPI with its change and trend;
  - tooltips on every card, every KPI row and every KPI column header of the drivers and keyword tables.

  The chart draws mention rate, share of voice, visibility score, top-1 share and citation rate.

### Changed

- **Per-group report, KPI history API and Excel export** now use these definitions. Group values
  pool every answer, so each answer weighs the same instead of each keyword.
  - The former "citation rate" (keywords whose answers name the brand) is now **keyword coverage**.
  - The headline "how visible are we" KPI is now **mention rate**.
  - **Share of voice** counts each brand once per answer.
  - The **visibility score** weights each answer by the brand's position: 100 for 1st, 90 for 2nd,
    81 for 3rd and so on. Sentiment is not part of it and is reported as **net sentiment**.
  - The export's Summary, KPI history, Drivers and Keyword runs sheets carry every KPI.
  - The export file is now `group-visibility-report-<group>-<date>.xlsx`.
- **Trend rule.** Changes are judged the same way everywhere. A KPI is improving or declining from
  2 points, or half a place for average position. Anything smaller is stable.
- **KPI alerts** use the new KPIs.
  - The **citation-rate drop** setting and alert are now **mention-rate drop**. A threshold saved under
    the old name keeps working until the settings are saved again.
  - Position loss follows average position, the content-change rule follows the visibility score, and
    the competitor rule follows each competitor's best position.
  - Snapshots now carry a KPI version. The first run after this release sets a fresh baseline and raises
    no alert, because it is never compared with a run measured the old way.
  - Open alerts raised before this release are labelled "Keyword-coverage drop (before 2.21)".
  - The alert worker reads the owned domains, so it needs the brand-config table instead of the
    provider-config table.
- **Owned domains** copy in Settings › Brand Tracking now says the domains drive the citation KPIs as well
  as Citation Gaps.

### Fixed

- Web-search provider rows and failed engine calls no longer count as answers. They used to lower every
  rate of the per-group report and the alerts.
- **Engine coverage** now divides by the engines that answered, not by a configured provider count.
- A brand named several times in one answer counts once, at its best position.

## [2.20.0] - 2026-09-28

### Added

- **Export to Excel** on the per-hotel report. One workbook,
  `hotel-visibility-report-<group>-<date>.xlsx`, with:
  - **Summary**: the selected run's citation rate, share of voice and
    prominence with their changes, the period and the group-run threshold.
  - **Definitions**: how every KPI is measured, the same text as the report
    tooltips.
  - **KPI history**: one row per run (partial runs included and marked) with
    its KPIs, changes and the models that answered.
  - **Drivers**: every keyword that moved between group runs and its share of
    the group's move.
  - **Keyword runs**: every run of every keyword with its values and changes.
  - **Brand mentions (run)**: one row per brand appearance (keyword, brand,
    provider, model, rank, mentions, sentiment) of the selected run, read from
    `/brand-mentions` at that exact run. If they cannot be read, the workbook
    is still produced without this sheet and the report says so.
- Unknown values are written as empty cells, never dashes, so the columns stay
  numeric in a spreadsheet.

## [2.19.0] - 2026-09-28

### Added

- Per-hotel report. Reports › Brand Visibility for a keyword group
  (`/reports/visibility?group=<id>`) is now built from
  `/reports/group-kpis` and shows, over the last 30, 90, 180 or 365 days:
  - **Headline**: the group's citation rate, share of voice and prominence
    (rank #1 share, with top-3 share and mean rank) for the latest group run,
    or any run the reader picks, each with its change since the previous
    group run.
  - **KPI evolution**: a chart of the four percentages per run. Partial runs
    (less than half of the group's keywords) can be added and are drawn as
    hollow points. Model changes between runs are listed under the chart.
  - **What changed**: the group deltas since the previous group run and every
    keyword that moved, with its share of the group's move, plus keywords
    that joined or left the comparison.
  - **Keyword detail**: every run of any keyword with its change since that
    keyword's previous run.
- Every KPI card has an "i" tooltip saying exactly how the figure is measured,
  and the report ends with the same definitions written out so they survive
  printing. Citation rate is defined as it is computed: the share of the
  group's keywords whose AI answers mention the hotel. It counts mentions in
  the answer text and does not check whether the hotel's website is cited.

### Fixed

- Chart axes that set their own tick options (the Keyword detail bar chart)
  kept the theme's tick colour. `themedAxis` used to replace the themed ticks
  with the caller's, so those ticks were unreadable in dark mode.
- Stryker could not mutate any report component. Its `ignorePatterns` entry
  `reports` also matched `src/components/Reports` on case-insensitive file
  systems; the patterns are now anchored to the project root.

## [2.18.0] - 2026-09-28

### Added

- `GET /api/reports/group-kpis` — the backend of the per-hotel report. For a
  keyword group (or any report scope) and a window of `days` (1–365, default
  90) it returns every analysis run with the group's citation rate
  (`coverage_rate`), share of voice (`first_party_avg_sov`) and prominence
  (`rank_1_share`, `top_3_share`, `mean_rank`), computed with the same
  formulas as `/visibility` but on one exact run at a time; the models each
  provider answered with in that run; and, for each group run, the change since
  the previous group run with the keywords that drove it (which keyword gained
  or lost the hotel, its share-of-voice and rank changes, and its share of the
  group's move). A per-keyword drill-down lists every run of every keyword with
  its change since that keyword's previous run.
- Runs are labelled with their coverage. A run covering at least half of the
  group's keywords is a group run; a one-keyword rerun stays in the keyword
  drill-down but is never compared as if it were the hotel's visibility.
- The window is read through the SearchResults sort key, so only the requested
  days are loaded instead of each keyword's whole history.

## [2.17.0] - 2026-09-28

### Added

- Settings › AI Providers can change the model OpenAI and Gemini answer with,
  so the tool can move to new versions as they appear. An administrator opens
  **Change model**, picks one of the models the stored key can use (the list
  comes from the provider and is filtered to models that can answer a prompt)
  or types an id, and saves. Before storing it, the server sends one short
  prompt with the exact web-search configuration runs use; a model that cannot
  search is refused with the provider's own reason instead of failing — and,
  after three failures, switching the provider off — during the next run.
  **Use the default** removes the override, so a future default moves the
  provider with it. New endpoint `GET /api/providers/{id}/models` (admin-only);
  `PUT /api/providers/{id}` accepts `model`.
- Keyword research now uses the same configured models as analysis runs. The
  research worker reads the ProviderConfig table (read-only grant) and fails
  the step rather than researching with a different model when the
  configuration cannot be read.

### Changed

- The default model ids live in one place, `lambda/shared/provider_models.py`,
  instead of about six. Model ids are restricted to letters, digits, dots,
  dashes and underscores because Gemini's id is part of the request URL.
- Every answer keeps recording the model that produced it (`metadata.model`);
  Gemini now records the configured model instead of a hardcoded label.

### Fixed

- A model change reaches a warm search Lambda on its next invocation. The
  model cache used to live for the whole container, so a change only took
  effect after a cold start.
- The dashboard's offline fallback and provider descriptions no longer name a
  model (`gpt-5.2`) the backend never used.

## [2.16.2] - 2026-09-28

### Fixed

- Switching a provider on or off in Settings › AI Providers no longer erases
  the rest of that provider's record. The toggle used `put_item` with only
  `enabled` and `updated_at`, which replaced the whole row and silently threw
  away the health record the search Lambda keeps there (last error, failure
  streak, auto-disable reason) and would have thrown away a configured model.
  It is now an `update_item` of those two fields. Switching a provider back on
  also clears the auto-disable record and restarts the failure streak, so the
  next failure after a fix cannot push the retained count over the threshold
  and switch it straight off again. The last error stays visible until a
  successful call clears it.

## [2.16.1] - 2026-09-22

Two known gaps closed, both cases where a number or a tolerance did not match
what the system actually does.

### Fixed

- The use-case form no longer depends on guessing which error name an account
  refuses it with. 2.15.0 named `ValidationException|ConflictException` (the
  latter is not even modelled for this operation) and an AWS-internal account's
  refusal rolled the whole stack back; 2.15.2 added `AccessDeniedException` on
  the reasoning that a deterministic policy refusal must use it, which was still
  a guess. The pattern is now a negative lookahead: every refusal is tolerated,
  named or not, and only `ThrottlingException` and `InternalServerException`
  stay fatal. Those two must stay fatal because the submission runs `onCreate`
  only under a fixed physical ID, so a tolerated error is never retried on a
  later deploy — swallowing a transient one would leave a genuinely fresh
  account permanently unprovisioned and silent.
- A keyword carrying no `status` attribute is now reported as paused rather than
  active, on both sides. Runs resolve keywords through the `StatusIndex` GSI,
  which is sparse: an item with no `status` is absent from the index and no run
  can ever pick it up. 2.16.0 counted such a row in `keyword_count` and the
  keyword list showed it as active, which recreated the mismatch that release
  set out to remove — a number promising work the scope could not deliver. The
  row now shows a `Paused` badge, and activating it writes the attribute that
  puts it in the index. No keyword in a current install is affected: rows only
  lack `status` if they predate the field, and `create_keyword` has always set
  it.

## [2.16.0] - 2026-09-22

A paused keyword used to be invisible and unfixable: nothing in the UI said a
keyword was paused, nothing could activate it, and a group of paused keywords
still advertised its members and offered a Run Analysis button that failed.
Keyword status is now shown and editable, and group counts mean "keywords this
scope will run".

### Added

- The keyword list marks paused keywords with a `Paused` badge, so a keyword
  that no analysis run will pick up no longer looks identical to one that will.
  Keyword research adds expanded keywords it did not select as paused, which is
  where most of them come from.
- Each keyword row has a Pause/Activate button, and the bulk bar activates or
  pauses every selected keyword at once (`Activate 5` counts the paused ones in
  the selection). Activating a keyword puts it back into every run, so the bulk
  action reports which keywords it could not update instead of failing silently.

### Fixed

- `PUT /keywords/{id}` activated a paused keyword whenever the request left
  `status` out: the schema defaulted the field to `'active'` and the update
  always wrote it. Renaming a keyword or changing its groups therefore put it
  back into every analysis run. An omitted `status` now leaves the stored value
  alone; only an explicit `status` changes it.
- Running a keyword group whose members are all paused failed with
  `No active keywords match the selected scope (1 group(s))`. `resolve_scope`
  returns active keywords in every mode, but `keyword_count` on a group counted
  every membership regardless of status, so a group of paused keywords
  advertised "(5)" and kept its Run Analysis button enabled. The button already
  disables itself at a count of 0; counting only active members is what makes
  that guard fire. Content Studio, which labels the same number "active
  keywords", is now telling the truth as well. A keyword with no `status` still
  counts as active, matching the keyword list and the picker.
- The Run Citation Analysis summary said "All 53 active keywords" while
  counting the whole keyword library. A run with no selection resolves to
  active keywords only, so the line now reports that count.
- A group button disabled for having no active keywords explains itself on
  hover instead of being inert with no reason given.

### Changed

- `ACTIVE_KEYWORD_STATUS` in `shared/keyword_groups` replaces the `'active'`
  literal that `query_active_keywords` and the group counter each carried, so
  the status an analysis run accepts is defined once.
- `keywordEntry` exports `ACTIVE_KEYWORD_STATUS`, `PAUSED_KEYWORD_STATUS` and
  `isKeywordActive`, replacing the `'active'` literals the keyword list and
  Content Studio compared against separately.
- Both lockfiles carried `2.14.2` while their `package.json` had moved on; they
  now read the released version.
## [2.15.2] - 2026-09-22

### Changed

- The use-case form now tolerates `ValidationException` and
  `AccessDeniedException` rather than every error. 2.15.1 tolerated all of them
  to unblock AWS-internal accounts, which also swallowed the two transient
  errors the operation can return, `ThrottlingException` and
  `InternalServerException`. The submission runs `onCreate` only under a fixed
  physical ID, so a tolerated error is never retried on a later deploy: a
  transient failure would have left a genuinely fresh account permanently
  unprovisioned and silent, which is the failure this construct exists to
  prevent. The deterministic refusals — a previous submission, an
  organization-level grant, an AWS-internal account, an SCP denying
  `bedrock:PutUseCaseForModelAccess` — are the two that stay tolerated, so
  internal accounts still deploy. A transient failure now costs a `cdk deploy`
  retry instead of a silently unprovisioned account.

## [2.15.1] - 2026-09-22

Deploy-time Anthropic provisioning no longer takes the stack down with it when
an account declines to be provisioned.

### Fixed

- 2.15.0 could not be deployed into an account that already holds Anthropic
  access. The use-case form submission tolerated `ValidationException` and
  `ConflictException` only, and an AWS-internal account refuses it with a
  different error — `Internal Accounts should not submit use case details` —
  which failed the custom resource and rolled the whole stack back, taking every
  unrelated resource update with it. An allowlist of error codes was the wrong
  shape for the call: a previous submission, an organization-level grant, an
  internal account and an SCP denying `bedrock:PutUseCaseForModelAccess` all mean
  the same thing, which is that the form is not ours to submit. Every refusal is
  now tolerated. Nothing is hidden by that: the Marketplace agreements that
  follow report their own outcome per model, and genuinely missing model access
  still surfaces as a clear `AccessDeniedException` on the first Bedrock call —
  the trade the agreement handler already made.
- `web/package-lock.json` still carried `2.14.2` while its `package.json` had
  moved on twice.

### Added

- `cdk deploy -c skipModelProvisioning=true` skips account enablement entirely:
  no use-case submission, no per-model agreements, and no deploy-time role
  holding `aws-marketplace:Subscribe`. For accounts whose model access is
  granted by their organization, where the provisioning is at best a no-op. The
  `BedrockModelsEnabled` output reports `none (skipModelProvisioning)`.

## [2.15.0] - 2026-09-21

### Added

- Anthropic model access is now provisioned by the deployment. A new
  `BedrockModelAccess` construct submits the one-time Anthropic use-case form
  (us-east-1) and creates the AWS Marketplace agreement for each Claude model
  the stack invokes, so a brand-new AWS account no longer needs manual console
  steps before the first Bedrock call. Previously the first call in such an
  account failed with `AccessDeniedException ... not authorized to perform the
  required AWS Marketplace actions (aws-marketplace:ViewSubscriptions,
  aws-marketplace:Subscribe)`, because Bedrock creates the subscription
  just-in-time using the calling role's permissions. Only the deploy-time
  provisioning Lambda holds Marketplace permissions; the roles that serve
  traffic still hold `bedrock:InvokeModel` alone.
- Company details on the use-case form are overridable via CDK context
  (`anthropicCompanyName`, `anthropicCompanyWebsite`, `anthropicIndustry`,
  `anthropicUseCases`), and a `BedrockModelsEnabled` stack output records which
  models were subscribed.

### Changed

- A CDK test now reads `_TIER_MODELS` from `lambda/shared/models.py` and fails
  when the subscribed model list drifts from the models the runtime resolves, so
  a tier upgrade cannot ship a model the account has no agreement for.

## [2.14.3] - 2026-09-21

### Changed

- `CitationAnalysis-API-CitationsContent` Lambda memory doubled from 256 MB to
  512 MB. A 7-day CloudWatch REPORT sweep showed its peak at 153 MB (60% of
  256 MB), the highest ratio of any function; every other function sat at or
  below 45%.

## [2.14.2] - 2026-09-21

### Fixed

- Crawler cleanup no longer calls `unroute_all` at all. The 2.14.1 change to
  `behavior="ignoreErrors"` was not sufficient: the call needs a round-trip to
  the page, and a page that has stopped responding (every observed hang
  followed a 30-second screenshot timeout) never answers, so the crawl still
  stalled until the Lambda timeout. Closing the browser connection drops the
  routes; the late-handler diagnostics the call was meant to silence are
  only log noise. The crawler ran 140 invocations with zero errors the day
  before `unroute_all` was introduced in 2.13.2.

## [2.14.1] - 2026-09-21

### Fixed

- Crawler cleanup no longer waits for in-flight browser route handlers.
  `unroute_all(behavior="wait")`, introduced in 2.13.2 to silence teardown
  diagnostics, could block indefinitely; one crawl hung for 4.5 minutes after
  extracting the page and was killed at the Lambda timeout, discarding the
  content until the workflow retry re-crawled it. Routes are now removed with
  `behavior="ignoreErrors"`, which still suppresses late handler errors.

## [2.14.0] - 2026-09-21

Content Studio briefs can target keyword or group scopes, run as a batch of
independent briefs, start from saved templates, and are generated by a
dedicated worker that DynamoDB Streams trigger instead of the API Lambda
invoking itself.

### Added

- **Target scope.** The Content Brief form selects keywords directly or by
  keyword group (up to 50 keywords) with the shared scope picker used by
  analysis runs and schedules.
- **Batch briefs.** "Create a separate brief for each keyword" starts up to 10
  independent generations in one request; the batch manifest is stored in
  `CitationAnalysis-ContentBriefBatches` and progress is shown per keyword.
- **Saved templates.** Brief prompt templates can be saved, reused, updated and
  deleted (`CitationAnalysis-ContentBriefTemplates`).
- `GET /api/content-studio/batches/{batch_id}`, `POST /api/content-studio/generate-batch`
  and `/api/content-studio/templates` CRUD routes.

### Changed

- Content generation runs in `CitationAnalysis-ContentStudioWorker`, triggered
  by the Content Studio table stream. Each row is claimed with a lease, retried
  at most three times, and reconciled every five minutes so a row can no longer
  stay `generating` forever; failed deliveries land in
  `CitationAnalysis-ContentStudioStreamDLQ`. The API Lambda keeps its previous
  timeout and Bedrock permission only until in-flight pre-rollout generations
  drain.
- History reads use the new `StatusCreatedIndex` on the Content Studio table
  instead of a scan. Existing rows are served unchanged.
- The no-Docker Lambda layer build accepts `manylinux_2_28` wheels, which
  `greenlet` (a Playwright dependency) requires for Python 3.12.

### Fixed

- The dashboard keeps the partial-draft warning introduced in 2.13.2 when
  decoding history, so incomplete metadata is still flagged in the detail view.

## [2.13.2] - 2026-09-20

Production validation hardened the analysis, research, content-generation and
reporting paths while removing browser and crawler diagnostics discovered in a
full authenticated smoke test.

### Fixed

- Research Agent checkpoints now preserve DynamoDB numeric fields and never
  report a terminal result that was not persisted.
- Citation Gap aggregation enriches only the final deduplicated result set,
  avoiding nested DynamoDB fan-out and API Gateway timeouts; gateway-generated
  failures also retain CORS and the UI no longer presents errors as empty data.
- Content Studio uses one structured output contract with tolerant legacy
  parsing, preserves useful partial drafts with explicit warnings, and renders
  reliable title and content fallbacks.
- Crawler extraction handles body-less documents and drains Playwright route
  callbacks before shutdown, preventing cancelled-task cleanup diagnostics.
- Form controls across insights, search, execution, schedules, settings,
  keyword research and Content Studio have stable identities and associated
  labels for browser accessibility tooling.

## [2.13.1] - 2026-09-19

Mutation testing now pins the observable alert and generic-brand behavior added
in 2.13.0, and brand portfolio expansion no longer accepts an inert type.

### Added

- Patch-scoped Python mutation runs (`scripts/mutate-python.sh --patch`) with
  Python 3.12 enforcement, source snapshot restoration, deterministic cleanup
  and the exact Mutmut patch parser dependency.
- Focused mutation specifications for alert decoders, request and hook
  lifecycles, settings forms, generic defaults/copy and brand prompt behavior.

### Fixed

- First-party and competitor portfolio expansion now send distinct ownership
  and exclusion rules to the model instead of accepting `brand_type` without
  using it.
- Alert and brand hooks explicitly settle cancellation, cleanup and reset paths
  that mutation testing showed were under-specified.

## [2.13.0] - 2026-09-19

Alert delivery can be tested from Settings, fresh installations start with an
industry-neutral brand profile, and the crawler uses least-privilege AgentCore
browser permissions.

### Added

- **Send test notification.** Administrators can send a fixed, server-generated
  SNS test message after at least one persisted notification recipient has
  confirmed its subscription. The action revalidates settings and subscription
  state server-side, exposes pending/success/failure UI states, and never writes
  a synthetic KPI alert.
- A General brand preset for fresh, reset and omitted-industry configurations.
  Existing stored Hotels configurations and the built-in Hotels research
  template remain unchanged.

### Changed

- Generic screens use industry-neutral group, schedule, keyword-expansion and
  query-prompt examples instead of assuming every account represents a hotel.
- Runtime domain validation accepts arbitrary input explicitly and narrows it
  safely, removing the final two Pyright argument suppressions.

### Security

- The crawler role no longer grants `bedrock-agentcore:*`, `bedrock:InvokeAgent`
  or `bedrock:GetAgent` on all resources. It can only connect, start and stop
  sessions on the pre-created AgentCore browser ARN.
- The web mutation-testing toolchain overrides vulnerable `qs<=6.15.3` with
  patched `qs@6.16.0`; no application runtime dependency uses this package.

## [2.12.0] - 2026-09-19

Research-agent reliability fixes from the 2.5.0 follow-up, and every local
quality gate tightened into a hard stop: zero duplication at 40 tokens, dead
code that tests cannot mask, a cyclomatic ceiling of 12 in both languages,
Python type checking, security and error-handling lint, a cross-boundary
contract check and targeted mutation testing. The code merged between 2.6.0
and 2.11.0 was brought under the same gates as part of the rebase.

### Added

- `npm run validate` now fails on: jscpd clones of 40+ tokens in TypeScript
  and Python, code and tests (threshold `0`, no exemptions); vulture at the
  60 % floor, run once over production code with tests excluded and once over
  the whole tree, so a symbol only its own tests still call is reported; knip
  `--production --strict` in both packages; ruff `C901` (12), `PLR0911` /
  `PLR0912` / `PLR0915`, flake8-bandit, `BLE001`, tryceratops `TRY002` /
  `TRY300` / `TRY301` / `TRY400`, `T20`, flake8-pytest-style, `RET504` and
  `ERA001`; eslint `complexity` 12 for the dashboard and the CDK app;
  `noUnusedLocals` / `noUnusedParameters` for the CDK app.
- pyright in `standard` mode over `lambda/` and `scripts/`
  (`scripts/lint-python.sh --types`, `[tool.pyright]` in `pyproject.toml`,
  `boto3-stubs` for the nine AWS services the Lambdas call). Imports resolve
  from `lambda/` and the built shared layer; the crawler layer bundles an
  untyped `boto3` that would shadow the stubs, so `playwright` and
  `bedrock-agentcore` are pinned in `lambda/requirements-dev.txt` instead.
- `npm run contracts` (`scripts/check-contracts.py`): every environment
  variable the CDK stack sets must be read by a Lambda (f-string reads are
  expanded against the declared `StrEnum` values; validating wrappers such as
  `_integer_env` count as optional reads), every variable a Lambda requires
  must be set by CDK, and every member declared under `web/src/types` must be
  read by non-test dashboard code. The allowlists are empty.
- Targeted mutation testing, outside `validate`: `npm run mutation:python --
  <module> <tests>` (mutmut 2.5.1) and, in `web/`, `npm run mutation --
  --mutate <file>` (Stryker 10). First runs: `shared/scope_params.py` 123
  mutants / 0 survivors, `hooks/useAnalysisEndpoint.ts` 65 / 0; equivalent
  mutants carry `// Stryker disable` comments with reasons.
- Shared code the de-duplication produced: `shared/consolidated_router.py`
  (the four API routers reduce to their route maps), `shared/analysis_runs.py`,
  `shared/api_views.py`, `shared/search_results.py`,
  `testing.assertions.present()` and `web/src/test/endpointHookContract.ts`
  (one parametrised contract for the nine analysis hooks).
- Characterization tests written ahead of every refactor: the Lambda suite
  grows from 1,577 to 2,312 tests and the dashboard suite from 1,443 to 1,786;
  `get-searches.py`, `get-stats.py`, `search/brand_extractor.py` and
  `shared/step_function_response.py` gain their first test files.

### Changed

- Every function above the new ceilings is split into intention-revealing
  helpers with no behaviour change — routes, status codes, response shapes,
  messages and thresholds are pinned by the characterization tests. Python
  peaked at complexity 34 (`get-execution-status.py` `handler`); the largest
  TypeScript cases were `ResearchProgress`, `AgentBriefForm`,
  `useBrandConfigForm` and `agentExport.briefExcelRows`. Since the rebase the
  same applies to `find_fresh_crawl`, `ContentChangeForm`, `isAlertItem`,
  `validateGroupBriefDraft` and `useAlerts` (one `useLatestAlertLoad` hook for
  its three resources).
- Error handling in 41 Lambda files: 72 blind `except Exception` blocks either
  narrow to the exception they expect or log with `logger.exception`, so the
  traceback reaches CloudWatch (65 previously used `logger.error`, which drops
  it); 66 `print()` calls go through the module logger; `return` statements
  leave `try` bodies; vanilla `raise Exception` becomes a specific type.
- Duplication removed across 183 clones surfaced at 40 tokens: the icon
  components share one `Icon` base, the CDK Lambda definitions share a factory
  (the synthesized template is unchanged apart from the `BEDROCK_MODEL_ID`
  removal below), and repeated test arrange blocks move into the sibling
  `*-fixtures.ts` / `lambda/testing/` helpers the project already uses.
- Test assertions assert values, not existence: the 19 `toBeTruthy()` /
  `toBeDefined()` in `web/` and 12 `is not None` / bare `assert` /
  `len(...) > 0` checks in `lambda/` now assert the exact string, entry or
  value; three test names that described no outcome are renamed.
- The content-brief validators return a value or a validation issue instead of
  a `(value | None, issue | None)` pair; `ReportScope.scope` / `label` are
  required fields (mutation testing showed every caller passed them, and a
  caller relying on the defaults would have widened a report to all keywords).
- vulture's shared settings live in `pyproject.toml` `[tool.vulture]`; the
  floor drops from 80 % (which could only report unused imports and
  unreachable code) to 60 %.
- Two swallowed exceptions in `shared/browser_tools.py` (CAPTCHA-detection
  read failure, citation-metadata refresh) log at ERROR with the traceback
  instead of WARNING.

### Removed

- `BEDROCK_MODEL_ID`, an environment variable the stack set on the
  self-reflection function and no Lambda read, with its contract allowlist
  entry; the stack comment now explains how the analysis model tier is chosen
  (`BEDROCK_TIER_<ROLE>`).
- Response fields computed on every request that nothing read:
  `avg_sentiment`, `total_brands`, `gap_type`, `total_sources`, `data_points`,
  `other_brands` and `brand_count` are gone from the Lambda responses and the
  dashboard types; fourteen further members the backend still persists are
  trimmed from the dashboard types only, as is `KeywordExtended.region`.
- The 50-groups-per-keyword limit on promotion (account-level group creation
  was already unbounded), the `og_tags` dict the research worker emitted and
  nothing read, `ALL_DIMENSIONS`, five `MAX_*` row-budget constants that only a
  test read (the invariant now lives in that test), a no-op
  `browser_client.identifier` assignment, `SiblingLoaderError`, and the
  `--dead-code-loose` lint mode.

### Fixed

- Research attempts carry an atomic attempt number and the active Step
  Functions execution identity through Plan, provider steps, Evaluate,
  Finalize and both failure paths, so delayed work from an older attempt or
  round cannot mutate a newer run and task replays reuse persisted outcomes.
- A whole-workflow timeout publishes the keywords from completed checkpoints
  as a partial result instead of failing the job; reconciliation is
  conditional, so it cannot race a retry.
- Persisted agent steps, rounds and proposals have explicit count, string and
  serialized-size budgets below the DynamoDB item limit; truncation keeps the
  highest-ranked candidates and is reported in job metadata. Dimension entries
  are type-checked before lookup, and plans, evaluations and proposals are
  constrained to the requested dimensions plus `other`.
- Promoting research results to a keyword group idempotently adds membership
  for existing and concurrently created keywords, preserving legacy keyword
  IDs and prior memberships, and the UI reconciles grouped results.
- `GET /api/executions/{id}` without an `id` answers 400 `id path parameter
  required`; it used to hand `None` to `DescribeExecution` and surface as a
  sanitized 500. The execution timeline no longer raises on a `TaskSucceeded`
  output whose `results`, `keywords` or `deduplicated_citations` is not a list
  of objects.
- `GET /api/prompt-insights` answers 400 with the actual reason (`No
  first-party brands configured`, `No keywords configured`) when a
  prerequisite is missing instead of a 500 `Missing required field`; the
  dashboard message is unchanged.
- The competitor-analysis panel's H3 Tags, OG Title, OG Description and
  Canonical URL rows render: the dashboard read `h3_tags`, `og_title`,
  `og_description` and `canonical`, but `fetch_page_seo_elements` never
  produced them. Found by the contract check.
- The `requests` probe in `manage-providers.py` has a timeout (a hung provider
  would have pinned the Lambda until its own timeout) and no longer swallows
  its errors; browser-tool calls before `initialize_browser_session` report
  `Browser session not initialized` instead of a `NoneType` attribute error.
- The dashboard's deferred-fetch test fixture rejects with the signal's own
  reason: its hand-built `DOMException` was jsdom's cross-realm class, so the
  abort path of every analysis hook had never really been tested.

## [2.11.0] - 2026-09-19

AgentCore crawling now avoids repeat paid browser sessions through a
status-aware DynamoDB freshness index and closes the security and lifecycle
gaps found while porting the scraper architecture guide.

### Added

- A cache-first crawl path that checks compact, keyword-safe success and
  URL-wide blocked verdicts before constructing AgentCore. Fully analysed
  successes remain reusable for 30 days; blocked pages for 3 days; errors,
  incomplete analysis, malformed/future timestamps and stale rows retry.
- SSRF validation before paid browser startup and browser-context document
  interception that aborts unsafe redirect destinations before navigation.
- Focused crawler, cache, browser lifecycle and CDK coverage, plus a
  Lambda-runtime layer smoke test for package compatibility, size and absence
  of local browser binaries.

### Changed

- AgentCore sessions use a 330-second service backstop for the 300-second
  crawler Lambda, require the pre-created signed `BROWSER_ID`, handle empty
  browser contexts/pages defensively and attempt browser, Playwright and
  AgentCore cleanup independently.
- Cache reads and artifact writes use only the required DynamoDB actions;
  screenshots are scoped to `screenshots/*`; and the browser signing role has
  account/resource-conditioned service trust with no broad identity policy.
- AgentCore, Playwright and runtime-critical dependencies are pinned. A
  compatible boto3/botocore is bundled because AgentCore 1.23.1 requires a
  newer SDK than the current Lambda Python 3.12 image provides.

### Fixed

- Early CAPTCHA detection remains `blocked` instead of becoming `error`, and
  named block patterns take precedence over generic near-empty content.
- Successful cache hits refresh current citation evidence in place without
  changing artifact freshness; blocked cache hits return the original evidence
  timestamp and never create synthetic rows that look like new crawls.
- Browser capture is finalized and the AgentCore session stopped before block
  persistence or Bedrock analysis, closing delayed-redirect races and avoiding
  browser charges while the model processes already-extracted text.
- A failure closing one browser resource no longer skips remaining cleanup,
  and pages with no body text no longer fail extraction.

## [2.10.0] - 2026-09-19

Complete keyword-group runs now create durable KPI baselines and actionable
in-app alerts, with optional pay-per-delivery email notifications.

### Added

- **Five group alerts.** Configurable rules detect a citation-rate drop,
  worsening first-party mean rank, a new competitor entering the configured
  top N, an active tracked keyword losing its first-party mention, and a
  visibility improvement after an explicitly recorded content change.
- **Exact-run snapshots.** A failure-isolated post-summary workflow state reads
  only the completed execution timestamp and records comparable group KPI,
  prominence, keyword and competitor data. The first clean run is a baseline;
  degraded, ambiguous and partial-group runs never create misleading deltas.
- **Alerts dashboard and settings.** The Dashboard lists open alerts and lets
  admins acknowledge them. Settings controls thresholds, recipients and SNS
  confirmation status, and records group content-change markers so later gains
  can be attributed honestly rather than guessed.
- **Optional SNS email.** One plain-text message is published per execution
  only when new alerts and configured recipients exist. Subscription failures
  are reported safely without losing snapshots or in-app alerts.
- Added four retained, encrypted, on-demand DynamoDB tables for snapshots,
  alerts, settings and content-change markers, plus one AWS-managed-key SNS
  topic. All resources are request-priced; no provisioned or continuously
  running compute was introduced.

### Changed

- KPI alert failures are caught by Step Functions and only add an `alerts`
  failure block; the original analysis report and execution success remain
  intact.

### Fixed

- Cleanup now shares request lifecycle and export filename primitives, removes
  the ignored template-draft industry field, and corrects the dashboard
  `remark-parse@^11.0.0` manifest range to match the lockfile for clean installs.

## [2.9.0] - 2026-09-19

Content Studio can now create a group-level landing-page brief for any
industry from the keywords being actively tracked.

### Added

- **Group Brief workflow.** Select a keyword group and 1–50 active member
  keywords, then improve a current public URL, rewrite pasted copy, or create
  a new landing page. Every mode produces title/meta/headings/body plus a
  5–8-question FAQ section in the selected output language and reuses the
  existing async generation history and document export.
- **Configurable generation prompt.** Each mode starts with an industry-neutral
  template that can be edited with allowlisted placeholders and reset. The
  exact effective template is validated, bounded and snapshotted with the
  generation so history remains reproducible.
- **Bounded landing-page ingestion.** URL mode rejects unsafe addresses before
  queuing, revalidates every redirect asynchronously, accepts HTML only,
  streams with a hard decompressed-byte limit, removes non-content elements
  and caps extracted text before sending it as untrusted model context.

### Changed

- The backend replaces client-supplied group/keyword text with authoritative
  KeywordGroups and active Keywords records before persisting or generating;
  selected ids outside the group are rejected before any write.
- Content Studio gains read-only access to the existing KeywordGroups table.
  No new table or always-on resource is introduced.

## [2.8.0] - 2026-09-19

Research-agent proposals now include an explainable, configurable shortlist of
keywords to track in recurring visibility analyses.

### Added

- **Representative tracking subset.** Each run recommends 15 tracking keywords
  by default (configurable from 1–50 and capped by the proposal target). The
  deterministic selector starts with the exact seed, covers the configured
  dimensions, targets roughly 60% commercial/transactional and 25%
  informational intent, then fills by a demand-proxy score.
- **Explainable proxy scoring.** Relevance is the largest input; independent
  provider agreement and Google autocomplete/related/PAA signals add demand
  confidence, while intent prioritises conversion terms. Proposal order breaks
  ties. Competition is deliberately not penalised because competitive head
  terms are useful to monitor. The UI and Excel export state explicitly that
  this is not measured search volume.
- The proposal review preselects the recommendation, shows each term's score
  and evidence, and can reset edited selections to the agent's shortlist.

### Changed

- Research results can add only the selected terms as active tracking keywords,
  or add the full proposal in one request: selected terms are active and the
  remainder are inactive library terms in the same keyword group. Inactive
  terms stay out of scheduled analyses until activated.
- `POST /api/keywords/promote` accepts an optional status on each keyword while
  retaining the request-level status and active default for existing callers;
  the entire request is validated before any write.

## [2.7.0] - 2026-09-19

Brand reporting can now be exported and revisited by analysis run, while group
visibility exposes citation rate and first-party prominence explicitly.

### Added

- **Brand Mentions Excel export.** The current scope, persona, provider and
  classification result exports one row per keyword × brand × AI provider,
  including model, rank, mention count, first position and sentiment.
- **Brand Mentions run history.** A run selector lists the newest 50 analysis
  timestamps and can reopen an exact shared run for one keyword, a keyword
  group, selected keywords or all active keywords. Group results report how
  many keywords participated in the chosen run.
- **Prominence KPIs.** Visibility now reports first-party rank-#1 share,
  top-three share, mean rank and mean first position per keyword and as an
  equal-keyword group aggregate; invalid and unranked values stay out of the
  calculation. Rank metrics are also carried into history and Excel exports.

### Changed

- The group visibility card formerly labelled "Coverage" is now "Citation
  rate" (% of analysed keywords where a first-party brand is mentioned). The
  API field remains `coverage_rate`; unrelated citation-gap coverage is
  unchanged.
- Group keyword detail includes the first-party best rank, and visibility
  exports include citation-rate, prominence and historical-rank columns.

## [2.6.0] - 2026-09-19

The research agent works for any industry, and every run keeps its results.

### Added

- **Industry templates.** A template is now an industry profile — the noun for
  what is researched (`subject`), the noun for who searches for it
  (`audience`), the expansion dimensions the brief can pick from, and the
  system prompt. Five built-ins ship: Hotels (unchanged prompt and dimensions,
  keeps the id `builtin-default`), Restaurants, Cafés & coffee shops, Retail
  stores, and "Any business" as the starting point for your own. Saving a
  copy of any template and editing its name, subject, audience, dimensions
  and instructions creates a custom template (`POST /api/keyword-research/templates`
  with `base_template_id`, `subject`, `audience`, `dimensions`; `PUT` edits
  them). Dimension ids are `^[a-z][a-z0-9_]{1,39}$`, 2–12 per template,
  `other` reserved.
- **Runs list with results.** The Research Agent tab shows the brief, then
  every run with its status and progress. "View results" (or "View progress"
  / "View details") opens the run in a modal: brief summary, the proposal
  grouped by dimension with checkboxes, "Add keywords" to a keyword group,
  Excel export, live progress and Retry where applicable, and the reasoning
  trace collapsed. Several runs can run in parallel and each is reviewed from
  its own row; starting a run no longer takes over the screen.
- Template-driven brief: the industry picker sets the dimension checkboxes,
  the seed label ("Restaurant (or seed)") and placeholder; the instructions
  editor sits behind a disclosure so the runs stay visible.

### Changed

- The agent's prompts speak in the template's nouns ("what diners search for
  around this restaurant") and list the template's dimensions; the brief wraps
  the seed as `<subject>` instead of `<hotel>`. Hotel runs are unchanged in
  substance. A run snapshots `subject`, `audience` and `dimension_catalog` in
  its `config`, so later template edits never change how an old run reads;
  the API backfills the hotel profile on runs from before 2.6.0.
- `POST /api/keyword-research/agent` validates `dimensions` against the chosen
  template's catalogue and answers 404 for an unknown `template_id` (it used to
  fall back silently to the default prompt).
- The Research Agent tab moved to the end of the Keyword Research tab bar;
  Related Keywords is the default tab again. Dimension labels in the proposal,
  the trace and the Excel export come from the run's own catalogue; the Excel
  brief sheet says "Business" and adds "Subject" / "Audience" columns.

## [2.5.1] - 2026-09-19

### Fixed

- Research-agent searches no longer fail on a provider rate limit. A round
  spreads its queries across the configured providers and runs them in
  parallel, so three Perplexity calls could leave within 100 ms; the worker's
  two-attempt budget (sized for OpenAI's 90 s timeout) gave a 429 a single
  1-second, un-jittered retry, and two throttled steps re-collided. `429` now
  earns three extra attempts on top of the caller's budget, waits honour a
  numeric `Retry-After`, use exponential backoff with full jitter and are
  capped at 30 s. Timeouts and 5xx keep the caller's budget.
- The dashboard explains a rate-limited step ("Perplexity rate-limited one of
  the searches. The other searches completed; use Retry to re-run the
  throttled one.") instead of showing the provider's raw JSON error body; the
  raw message stays in the tooltip.

## [2.5.0] - 2026-09-18

Keyword Research Agent: describe a hotel and the dimensions to expand by, and
an agent plans its own searches, runs them in the background, judges each
round, and proposes the keywords the hotel should be visible for — with an
editable, saveable system prompt (the "agente configurable"), a full trace,
one-click promotion into the hotel's keyword group and Excel export.

### Added

- **Research agent job type** (`POST /api/keyword-research/agent`, `type:
  agent` in history). The brief: hotel/seed, market (`country`, `language`
  ISO codes), expansion dimensions (destination, location/neighbourhood,
  points of interest, hotel attributes, audience, trip type), a free-text
  instruction, `target_count` (10–100, default 60), `max_rounds` (1–3,
  default 2), optional destination `group_id` (validated) and the system
  prompt (inline edit, else the chosen template, else the built-in default).
  The prompt is snapshotted on the job, so editing a template never changes
  what a past run did.
- **Agentic loop on the 2.2.0 state machine.** `Plan` asks Bedrock
  (`ModelRole.RESEARCH_PLANNING`, balanced tier) for ≤8 queries tagged with a
  dimension and rationale; each query becomes one parallel, checkpointed step
  on a web-search provider (rotating Perplexity / OpenAI / Gemini); a new
  `Evaluate` state asks the model (`RESEARCH_EVALUATION`, fast tier) whether
  another round would add materially new keywords and which queries to run;
  a `Choice` loops back to `Plan` while it says `continue` and the round cap
  allows, else `Finalize` asks the planning model to select and rank the
  final list (≤ target, per dimension, with intent, competition, relevance
  and a one-line rationale). Model failures degrade — evaluation to `stop`,
  selection to the top candidates by relevance (`proposal_source:
  fallback`) — instead of losing the run. Retry re-runs only the unfinished
  steps of the current round and then continues the loop.
- **Google expansion signals.** When a SerpAPI key is configured, one extra
  step per round collects Google's related searches, People Also Ask
  questions and autocomplete suggestions for every planned query
  (`shared/keyword_signals.py`); they enter the candidate pool as provider
  `serpapi` and are scored by the evaluation and selection models. (Exa,
  Firecrawl, Tavily and Brave were reviewed: they are plain search APIs with
  no expansion features, so they were not wired in.)
- **System-prompt templates** (`CitationAnalysis-ResearchTemplates`;
  `GET/POST /api/keyword-research/templates`, `PUT/DELETE
  /api/keyword-research/templates/{id}`): a built-in template plus the
  team's saved ones (name ≤100, prompt 20–6000 chars, cap 50). Open to every
  authenticated user, like the other research routes.
- **Research Agent tab** (now the first tab under Keyword Research): brief
  form with dimension toggles, market and language, target and round budget,
  destination group, template picker with an inline prompt editor (save as
  new / update / delete) and a cost ceiling shown before starting ("up to N
  web searches, M model calls…"); a **runs list** that keeps polling every
  active run so several can be shipped and left in the background; a run
  view with live per-step progress (the query each step searched, its round
  and provider), the **agent trace** (instructions used, each round's
  strategy, queries and evaluation) and the **proposal** grouped by dimension
  with per-section selection, "Add N keywords to ‹group›" and **Export to
  Excel** (Proposal, Trace and Brief sheets).
- `POST /api/keywords/promote` callers can now pass `group_ids` from the UI
  (`promoteKeywords({ groupIds })`), so research results land directly in a
  hotel's group.
- `shared.models.invoke_bedrock(system=…)` sends a Converse system block.

### Changed

- The keyword-research "job I was waiting for" re-attach moved from
  sessionStorage to localStorage: a run started before the browser was
  closed re-attaches in any tab instead of only surviving a reload.
- Research history lists agent runs (badge "Agent") and omits their prompt
  snapshot; the detail route (`GET /api/keyword-research/{id}`) keeps it.
- Progress panel wording follows the job type ("3 of 4 steps finished ·
  round 2 of 3" for agent runs; providers for expansion/competitor).
- Lambda memory audit (14/90-day CloudWatch peaks): every function sat below
  60% of its memory except `CitationAnalysis-API-Health` (74% of 128 MB →
  256 MB) and the CDK dashboard bucket-deployment handler (100% of 128 MB,
  ~60 s per deploy → 512 MB). `ResearchWorker` peaks at 20% of 512 MB.
- The nine clones 2.4.2 deferred as this feature's files (`keyword-research.py`,
  `test_keyword_research_job_lifecycle.py`, `test_research_worker.py`,
  `test_models.py`) are gone, along with the eight TypeScript and three
  further Python clones the feature itself introduced; the four temporary
  entries in the Python jscpd `ignore` lists are removed. All four
  duplication gates run at threshold `0` with no exemptions.
- `keyword-research.py`: `_retry_research` and `_get_research` share
  `_load_research` (path id → GetItem → 404 → stale sweep); same routes,
  responses and status codes.
- The feature's specs and tests use the shared foundations
  (`web/src/test/infrastructureMock`, `fetchResponses`, `lambda/conftest.py`,
  `lambda/testing/` — which gains `load_handler_module_offline` and
  `KEYWORD_RESEARCH_ENV`), and the last 33 legacy Lambda tests drop their
  redundant per-file `sys.path` shims, two of which put the built layer
  ahead of the source tree.

### Fixed

- `POST /api/keyword-research/*` answered `{"error": "An unexpected error
  occurred"}` when no provider key was configured or the execution could not
  be started: `error_response` sanitizes exception *types* and swallowed the
  plain-string messages. The routes now return the real reason (400 "No API
  keys configured…", 503 "Could not start…").

## [2.4.2] - 2026-09-18

Zero-duplication refactor of the Lambda (Python) code and its tests, with
the Python gates (ruff, vulture, jscpd, pytest) wired into `npm run validate`.
No handler behaviour change: same routes, status codes, response shapes and
validation messages; 1,425 tests pass (1,384 before, plus 41 covering the new
shared modules).

### Added

- `npm run validate:python` (`scripts/validate-python.sh`): ruff → vulture →
  jscpd (`.jscpd.python.json` for `lambda/` and `scripts/`,
  `.jscpd.python-tests.json` for `test_*.py`, both at threshold `0`) → pytest.
  Part of `npm run validate`.
- `lambda/conftest.py` puts `lambda/` (source first) and the built shared
  layer on `sys.path` for every test; the 30 per-file `sys.path` shims are gone.
- `lambda/testing/` — test-only helpers that never ship in a Lambda asset:
  `module_loader.load_handler_module` (the one copy of the `importlib` dance
  for hyphenated handler files), `dynamodb_stubs`, `events`
  (`api_gateway_event`, `parse_response`), `env`, `handler_fixtures`,
  `keyword_strategies` (the Hypothesis strategies both promote-keywords
  property suites used to duplicate).
- `shared/scope_params.py`: `SCOPE_QUERY_PARAMS` (the `@validate` rules the
  report handlers spread into their schemas), `scope_from_request`,
  `keywords_table_name`, `query_keyword_rows`, `load_sibling_function`.
- `shared/router.py`: `dispatch_route` — the consolidated routers
  (`citations-content`, `config-mgmt`, `execution-mgmt`, `stats-insights`)
  are one-liners on top of it.
- `shared/brand_visibility.py`: `tracked_brand_names`, `classify_brand`,
  `load_recent_search_results`, shared by `get-recommendations` and
  `content-studio` (same limits per handler: 20 and 30 keywords).

### Changed

- Report handlers (`get-visibility-metrics`, `get-brand-mentions`,
  `get-historical-trends`, `get-citation-gaps`, `get-citations`,
  `get-reports-overview`, `get-reports-competitor`) take the scope
  parameters through the shared schema and resolver; schema key order per
  handler is preserved so the first-reported validation error is unchanged.
- `manage-providers` key probes share `_probe_result`/`_bearer_json_headers`;
  `manage-users`, `manage-brand-config`, `browse-raw-responses` and
  `search/search_clients.py` (`BaseSearchClient._collect_results`) share one
  helper each for their repeated blocks. `source` on search hits is now the
  client's `provider_id` (same values as the former literals).
- The consolidated routers log `Routing request: …` and `Matched route X -> Y`
  (the wording `citations-content` and `stats-insights` already used);
  `config-mgmt` and `execution-mgmt` previously logged `Routing: …` only.
- Lambda tests use `@pytest.mark.parametrize`, module fixtures and the
  `lambda/testing/` helpers instead of repeated setup; no test was removed or
  weakened.
- Nine clones inside files owned by the then-open research-agent PR (#113) —
  `api/keyword-research.py`, `api/test_keyword_research_job_lifecycle.py`,
  `research-worker/test_research_worker.py`, `shared/test_models.py` — were
  temporarily listed in the two Python jscpd configs' `ignore` so the gate
  stayed at threshold `0` without editing that PR's files; cleared in 2.5.0.

### Removed

- `WEB_SEARCH_PROVIDER_IDS` (`shared/ai_clients.py`) and the write-only
  `_browser_created_dynamically` attribute (`shared/browser_tools.py`): no
  readers anywhere.

## [2.4.1] - 2026-09-18

Zero-duplication refactor of the TypeScript codebase (CDK app, dashboard and
their tests), with duplication and dead-code gates wired into `npm run validate`.
No behaviour change: the synthesized CloudFormation template is byte-identical,
the report sections render byte-identical markup, and the 1,378-test suite passes.

### Added

- `npm run validate` at the repo root: ESLint → CDK build → CDK tests →
  jscpd duplication (production and test configs) → knip dead code → web
  type-check, tests and knip. Documented in README.md and CONTRIBUTING.md.
- jscpd 5.2.1 with two configs at threshold `0`: `.jscpd.json` for `bin/`,
  `lib/`, `web/src/` and `.jscpd.tests.json` for spec and fixture files.
  knip 6.37.0 at the root (`knip.json`) for the CDK app.
- Shared test foundation in `web/src/test/`: `infrastructureMock.ts`
  (`vi.mock('../infrastructure', () => import('../test/infrastructureMock'))`
  with a typed `mockAuthenticatedFetch`) and `fetchResponses.ts`
  (`createMockJsonResponse`, `createDeferredResponse`,
  `createEndpointMockFetch`, `createMockMalformedResponse`) — real `Response`
  objects instead of `{ ok, json }` look-alikes. Vitest now runs with
  `clearMocks` and `restoreMocks`, so specs carry no mock-hygiene hooks.
- Report layout primitives under `web/src/components/Reports/layout/`:
  `ReportStatCard`, `ReportStatGrid`, `ReportTable`, `PriorityBadge`,
  `MoverColumn`, `ReportSectionPlaceholder`, `gateSection` /
  `pendingSectionPlaceholder`, `reportAccent`, `sampleEvenly`.
- Dashboard `useThemedChart` hook and `DashboardChartCard`; `BlockedPageBanner`
  for citations; shared `paginate`; `DownloadButton` and `fileSizeFormatter`
  for raw responses; `EyeIcon`, `CogIcon`, `RefreshIcon`, `ClockIcon`,
  `CollectionIcon` in `ui/Icons`.

### Changed

- `lib/citation-analysis-stack.ts`: the twelve DynamoDB tables are built by
  one typed `citationAnalysisTable` factory (same construct ids, same
  properties, same GSI order).
- `web/src/api/client.ts`: `apiGet` / `apiPost` / `apiPut` / `apiDelete` share
  one `requestJson` pipeline. `useQueryPrompts` and `useRawResponses` share
  one request function per hook. `dateFormatter` formatters share one
  parse-and-guard step (its unreachable `catch` now logs
  `Date formatting failed:`).
- Decorative SVGs replaced by `ui/Icons` components now carry
  `aria-hidden="true"`; class names, paths and accessible names are unchanged.
- Hook specs are table-driven (`it.each`) and assert the whole hook state and
  the full request URL; report and component specs build their data through
  `*-fixtures.ts` builders. 1,378 tests (was 1,391 on 2.4.0): weaker tests
  were folded into stronger table rows, and every previously asserted
  behaviour is still asserted. New coverage: malformed JSON bodies, the
  `query_prompt_id` visibility parameter, group and all-keyword scopes on the
  citation-gaps, trends, visibility and reports-overview requests.

### Removed

- Unused root dev dependencies `eslint-plugin-jsdoc` and `source-map-support`,
  and the dangling `"main": "index.js"` in `package.json`.
- `reportScopesEqual` in `web/src/components/ui/reportScope.ts`, which had no
  production caller.

## [2.4.0] - 2026-09-18

Group KPIs: every visibility view and report can be scoped to a keyword group
(a hotel), to all keywords, or to one keyword — with one score, share of voice
and coverage for the group, its history, the per-keyword table and Excel export.

### Added

- **Report scopes.** `/api/visibility`, `/api/trends`, `/api/brand-mentions`,
  `/api/citations`, `/api/citation-gaps` and `/api/reports/overview` accept
  exactly one of `keyword=`, `group_id=`, `keyword_ids=` (comma-separated, max
  100) or `scope=all`. Scopes resolve server-side to the active keywords
  (`shared/scope_params.py` + `shared/keyword_groups.resolve_scope`) and the
  answer echoes a `scope` block (`kind`, `label`, `keyword_count`).
- **Group visibility summary** (`/api/visibility?group_id=`): per-keyword
  metrics computed in parallel with projected queries (no LLM text), then
  averaged over the keywords that have data — mean first-party and competitor
  visibility, *averaged* share of voice, coverage rate (% of keywords where a
  first-party brand is mentioned), provider coverage — plus a per-keyword
  breakdown and a brand ranking across the group's keywords (mean score,
  `keyword_count`). Formulas live in `shared/visibility_score.py`
  (`calculate_share_of_voice`, `summarize_group_visibility`,
  `aggregate_brands_across_keywords`).
- **Group history** (`/api/trends?group_id=`): `trend_data` becomes the
  per-bucket mean first-party score across the group's keywords (with
  `keywords_with_data` per bucket) alongside the existing `keyword_trends` /
  `overall`; the same `trend_direction` / `summary` block as a single keyword.
- `/api/brand-mentions?group_id=` aggregates the latest run of every keyword
  (distinct providers, summed mentions, best rank, `keyword_count`, `keywords`
  per brand); `/api/citations?group_id=` queries one partition per keyword
  instead of scanning the table; `/api/citation-gaps?group_id=` and
  `/api/reports/overview?group_id=` fan out over the group's keywords.
- Dashboard: a scope selector (All keywords / Keyword groups / Keywords) on
  Visibility, Brand Mentions and Citation Gaps. Visibility gets a **Group
  overview**: KPI cards, group history with a 7 / 30 / 90-day range, sortable
  per-keyword table, brand ranking across the scope and **Export to Excel**
  (Summary, Keywords, Brands, History sheets). Reports: Brand Visibility
  (`/reports/visibility?group=<id>`) and Executive Summary
  (`/reports/executive-summary?group=<id>`) take a group scope.
- Keyword Research results table: **Export to Excel** (current filter and
  sort order).

### Changed

- The unscoped "all keywords" paths of `/trends`, `/citation-gaps` and
  `/reports/overview` cover the *active* keywords (StatusIndex) instead of a
  raw table scan, and `/visibility` no longer requires `keyword`
  (400 without any scope). The single-keyword payloads are unchanged.
- `/visibility` and `/trends` read projected rows (`timestamp, provider,
  brands`) and follow pagination; the group fan-out uses up to 10 parallel
  queries and covers at most 100 keywords (`keywords_truncated: true` beyond).
- `CitationAnalysis-API-CitationsContent` and `CitationAnalysis-API-GetBrandMentions`
  gain read access to the Keywords table to resolve scopes.

### Fixed

- Every `ModelRole.ANALYSIS` Bedrock call (recommendations, brand expansion,
  competitor discovery, the search self-reflection pass) failed on the
  balanced and quality tiers: Anthropic's extended thinking is only accepted
  with `temperature` 1 and a `maxTokens` above the thinking budget, but the
  callers passed `temperature=0`, so Bedrock answered a `ValidationException`
  and each feature quietly fell back to its no-LLM path.
  `shared.models.invoke_bedrock` now forces `temperature: 1` and
  `maxTokens = max_tokens + budget` whenever a thinking budget is set.

## [2.3.1] - 2026-09-18

### Fixed

- Deploying 2.3.0 failed: renaming the API Gateway path part
  `/api/schedules/{name}` to `{id}` made CloudFormation create the new
  resource next to the old one, and API Gateway allows a single variable
  sibling. The path part stays `{name}` (the handler reads either key), so the
  routes `GET/PUT/DELETE /api/schedules/{id}` and `POST /api/schedules/{id}/run`
  deploy in place.

## [2.3.0] - 2026-09-18

Schedules v2: name your schedules, point them at keyword groups, edit them in
place and run them on demand.

### Added

- **Group-scoped schedules.** A schedule now carries a `scope` —
  `{"mode":"all"}`, `{"mode":"groups","group_ids":[…]}` or
  `{"mode":"keywords","keyword_ids":[…]}` — that ParseKeywords resolves when
  the schedule fires, so a schedule targeting "Hotel Coruña" runs whatever
  keywords are in that group at the time. Group ids are checked against the
  KeywordGroups table when the schedule is saved.
- **Display names and stable ids.** EventBridge `Name` is now a generated,
  immutable `sch-<8 hex>` id; the user's name (any text, up to 100 characters)
  lives in `Description` and in the v2 descriptor baked into `Target.Input`
  (`schedule_id`, `display_name`, `form`, `scope`), so every field is
  editable without delete-and-recreate.
- `GET /api/schedules/{id}`, `PUT /api/schedules/{id}` (partial merge over the
  current definition, full-replace write, Admin) and
  `POST /api/schedules/{id}/run` (start an analysis now with the schedule's
  scope, Admin). The list response gains `id`, `display_name`, `enabled`,
  `form`, `scope`, `scope_summary`, `legacy`, `created_at`, `updated_at`, and
  follows pagination tokens.
- Schedule UI: click a schedule (or Edit) to open the same form pre-filled;
  scope picker with All / Keyword groups / Specific keywords (the grouped
  keyword picker from Run Analysis); enable/disable toggle; "Run now"; timing
  described in words ("Weekly on Monday at 09:00 (Europe/Madrid)") instead of
  the raw cron; searchable IANA timezone input (Europe/Madrid included).
- Schedules created before 2.3.0 are listed as **Legacy** with their form
  recovered from the cron expression; `{"source":"dynamodb"}` maps to scope
  `all`, keyword-text schedules keep their texts and ask for a scope when
  edited. Saving upgrades them in place under the same id.

### Changed

- Validation: hour 0-23 and minute 0-59 are enforced (the old check only
  required digits), timezones are validated against the IANA database
  (`tzdata` added to the shared layer), day of month is 1-28 server- and
  client-side, EventBridge validation errors answer 400 instead of 500.
- `POST /api/schedules` no longer accepts `keywords` (keyword texts); it
  answers 400 pointing at `scope`. The old keyword-text snapshot ignored later
  renames and deactivations; scopes are resolved at run time.
- `manage-schedule.py` routes by method and path (`shared.decorators.route_handler`).
  `CitationAnalysis-API-ConfigMgmt` gains `states:StartExecution` on the
  analysis workflow and read access to the KeywordGroups table.

## [2.2.0] - 2026-09-18

Keyword research that cannot lose results: every research job now runs in its
own Step Functions execution, queries the web-search providers in parallel,
checkpoints each provider's answer as it arrives, and can be retried for only
the providers that failed. Refreshing the browser or switching tabs no longer
loses a run.

### Added

- **Research state machine.** `CitationAnalysis-KeywordResearch` (Standard,
  30-minute timeout) with the new worker `CitationAnalysis-ResearchWorker`
  (`lambda/research-worker`, 300 s, shared layer): `Plan` → `Map` (one step per
  configured provider, up to 10 in parallel) → `Finalize`. A provider error
  fails its own step and the job ends `partial` with the other providers'
  keywords; a worker crash is recorded by a `FailResearchStep` catch; a crash in
  planning or finalizing marks the job `failed`. Logged to
  `/aws/vendedlogs/states/CitationAnalysis-KeywordResearch` (30 days).
- `GET /api/keyword-research/{id}` — the job, its per-provider steps and the
  merged result, including the *partial* result while other providers are
  still running. `POST /api/keyword-research/{id}/retry` — re-runs only the
  steps that did not complete, keeping the completed providers' results.
- Job statuses `running` and `partial` (alongside `pending`, `completed`,
  `failed`); job rows carry `steps`, `steps_total/done/failed`, `retry_count`,
  `execution_arn` and a 90-day TTL. Merged expansion keywords are deduplicated
  on keyword identity, ranked by relevance and provider agreement, and record
  the `providers` that proposed them.
- `CitationAnalysis-KeywordResearch` table: GSI `TypeCreatedIndex`
  (`type`, `created_at`) so `/history` is a newest-first query instead of a
  scan, and TTL on `ttl`.
- Research UI: a progress panel with the job status and each provider's step
  (Waiting / Querying / Done / Failed, keyword counts, error), a
  "Retry failed providers" action on partial and failed jobs (also in
  History), and re-attachment to the running job after a refresh or tab
  switch (session storage). Polling backs off from 3 s to 10 s after the first
  minute and outlasts the state machine timeout.

### Changed

- `CitationAnalysis-API-KeywordMgmt` no longer invokes itself: its timeout
  drops from 120 s to the 29 s API Gateway ceiling, its reserved concurrency
  (10) is removed, and it gains `states:StartExecution` on the research state
  machine. The `async_expand` / `async_competitor` self-invoke events are gone.
- `count` on `POST /api/keyword-research/expand` is now the number of keywords
  asked of *each* provider; the merged, deduplicated result can be larger.
- The reader-side stale sweep fires 35 minutes after the current attempt
  started (above the 30-minute execution timeout) instead of 180 s, and
  measures from `retried_at` on retries so a retry of an old job is not swept
  immediately.
- `shared.ai_clients`: `search_with_fallback` (sequential fallback across
  providers) is replaced by `run_web_search` (one provider, caller-owned retry
  budget) plus `get_web_search_provider`; the per-provider runners accept
  `max_retries`.

### Fixed

- A research job could only be found through the history scan; a job that
  fell off the first page vanished from the UI while still running. Jobs are
  now read by id.
- Truncated or unparseable provider output is a failed step (retryable), no
  longer a "completed" job with 0 keywords.

## [2.1.0] - 2026-09-18

Keyword groups: organise keywords into folders (typically one per hotel or
property), run analyses per group, and stop truncating large runs.

### Added

- **Keyword groups.** New table `CitationAnalysis-KeywordGroups` and routes
  `GET/POST /api/keyword-groups`, `PUT/DELETE /api/keyword-groups/{id}`,
  `PUT /api/keyword-groups/{id}/keywords` (bulk add/remove). Membership is the
  `group_ids` string set on each keyword, so a keyword can belong to any
  number of groups. Group names are unique (case-insensitive); deleting a
  group detaches its keywords but keeps them. Like keyword management, these
  routes are open to every authenticated user.
- `POST /api/keywords`, `PUT /api/keywords/{id}` and `POST /api/keywords/promote`
  accept `group_ids`; `GET /api/keywords` accepts `?group_id=` and returns
  `group_ids` on each keyword.
- `POST /api/trigger-keyword-analysis` accepts a `scope`
  (`{"mode":"groups","group_ids":[…]}`, `{"mode":"keywords","keyword_ids":[…]}`
  or `{"mode":"all"}`) resolved server-side against the active keywords; the
  legacy `keywords` array still works. Executions record the requested scope.
- ParseKeywords accepts `{"scope": …}` execution input and resolves it at run
  time (groundwork for group-targeted schedules).
- Settings → Keywords: a Keyword Groups panel (create, rename, delete, filter
  by group / ungrouped), group chips on every keyword, a per-keyword Groups
  menu, and bulk "Add to group / Remove from group" for ticked keywords.
  Keywords added while a group is selected land in that group.
- Run Analysis: one-click "run a whole keyword group" buttons and a grouped,
  searchable keyword picker (tri-state group checkboxes) replacing the flat
  checkbox grid.
- CDK context `processKeywordsConcurrency` to tune the ProcessKeywords Map
  concurrency (default 3).

### Changed

- **No more 100-keyword cap.** ParseKeywords no longer truncates executions,
  `trigger-analysis` reads every StatusIndex page instead of the first 500,
  and `trigger-keyword-analysis` drops its 100-keyword limit. Throughput is
  governed by the Map concurrency and the 2 h state-machine timeout.

### Fixed

- The health check function (`GET /api/health`) shipped without the shared
  Lambda layer it imports from and answered 502 to every monitor; it now has
  the layer and the CORS parameter like the other API functions.

## [2.0.1] - 2026-09-18

Dead-code removal and KPI-denominator fix, prompted by customer feedback that
the codebase carried a lot of unused code. No API contract changes.

### Fixed

- Visibility scores no longer count the optional Brave/Tavily/Exa/SerpAPI/
  Firecrawl search providers in the provider-coverage denominator. Brand
  mentions are only extracted from LLM responses, so those five providers
  could never contribute coverage; on installations that never configured
  them the term was capped at 4/9 of its weight and every visibility score
  (dashboard, persona rankings, trends, reports) was deflated. Scores will
  rise after deploying; historical values were computed with the old
  denominator.
- Historical trends resolve the enabled-provider count once per request
  instead of scanning the ProviderConfig table once per period bucket.

### Changed

- The visibility formula lives in one place, `shared/visibility_score.py`,
  replacing three per-handler copies (one of which hard-coded the weights);
  the module is pinned by tests to the values the handlers produced before.
- Web: removed 32 dead files — six typed API-client modules that no hook or
  component imported (`brands`, `content`, `providers`, `rawResponses`,
  `research`, `visibility`) and their specs, the `ErrorDisplay` and `Tables`
  components, stale duplicates of `TriggerSection`/`ExecutionStatus`,
  `exporters/analysisExecutor`, `hooks/useBrandExpansion`, and seven barrel
  files nobody imported — plus unused functions in the remaining clients,
  unused exports, seven redundant `default` exports and the unused
  `@types/unist` dev dependency. The duplicated brand-expansion result types
  now have a single definition in `types/api/brandConfig.ts`.
- Lambda: removed `browser_tools.crawl_url`,
  `manage-brand-config.get_preset_with_prompt` and three test-only alias
  constants in `promote-keywords.py`.

### Added

- `npm run deadcode` / `npm run deadcode:prod` in `web/` (knip, pinned) with
  `web/knip.json`; `scripts/lint-python.sh` now prefers the repo `.venv` and
  documents the tests-hide-dead-code caveat of vulture.
- `docs/plans/2026-09-keyword-groups-and-agentic-research-plan.md`: design
  plan for keyword groups, editable schedules, group KPIs, parallel keyword
  research and the Content Studio workflow.

## [2.0.0] - 2026-08-20

Audit-driven refactor and hardening release (#103). Major version because it
changes the API contract for existing clients and requires manual preparation
before deploying — see the "Before deploying" section of the PR.

### Changed

- **Breaking:** every mutating API route now requires membership in the
  Cognito `Admin` group; unauthorized callers receive 403. Ensure at least one
  user is in the group before deploying — with an empty group there is no
  in-app recovery.
- **Breaking:** `PUT /users/{username}` requires `groups` to be an array of
  strings; self-edits of `groups`/`enabled` and self-deletion are refused even
  for admins.
- **Breaking:** `GET /users/{username}` returns the single user instead of the
  full roster (routing bug fix, but a response-shape change).
- **Breaking:** a plain `cdk deploy` of this release fails without
  preparation: 12 API Lambda log groups come under CDK management (30-day
  retention) and most already exist in deployed accounts. Delete or
  `cdk import` them first; failed attempts compound because `Retain` is
  honored during rollback.
- Every provider now receives the identical query: OpenAI loses its
  "Search for information about:" prefix and Claude's citation instruction
  moves to a system prompt. Citation metrics before and after this release are
  not directly comparable.
- Cognito token lifetimes: access/ID 8h → 1h, refresh 8h → 7 days (a disabled
  user is now locked out within an hour).
- Step Functions logging OFF → ALL with execution data, 30-day retention
  (keyword and citation payloads now land in CloudWatch).
- Screenshots transition to S3 Infrequent Access at 90 days instead of being
  deleted; async dispatch failures return 503 with a terminal job row instead
  of silently running the job inline.

### Added

- Provider health tracking: failures classified (no credit, invalid key, rate
  limited, timeout), recorded per provider row, surfaced on `GET /providers`,
  and rendered in the dashboard (app-wide banner and Settings badges).
  Providers auto-disable after three consecutive terminal failures;
  re-enabling is deliberately manual.
- Shared Lambda modules consolidating duplicated logic: AI clients, secrets
  access, SSRF-safe fetching, keyword persistence, async self-invocation,
  stale-job sweeps, provider-health classification, Decimal handling, and
  group-based authorization.
- Admin-aware UI: non-admin users no longer see mutating controls; 403
  responses map to a dedicated permission error category instead of looking
  like session expiry.
- Synth-time regression gates: layer staleness, log-group retention/policy,
  and the search role's DynamoDB permissions on the provider config table.

### Fixed

- `GET /users/{username}` returned the entire roster via dead-code dispatch.
- Presigned URLs and raw-response reads are confined to their bucket's
  expected prefixes.
- "Latest run" reads no longer stop at DynamoDB's 1 MB page boundary.
- Cache-key collisions for keywords containing `#`.
- Provider-health writes were denied by IAM and `GET /providers` omitted the
  health fields, leaving the health feature dark end to end (review blockers).
- Search prompt tests failed under explicit-path pytest invocations
  (collection-order module pollution on the shared `handler` name).

### Removed

- The never-associated regional API WAF (API Gateway stage throttling
  remains in place).

## [1.1.0] - 2026-08-14

History before this changelog existed, summarized from the git log. Covers
everything merged between the initial release and the version bump in #96.

### Added

- App version display on the Settings page and About modal with content
  freshness (#96, #102).
- Keyword-linked schedules and scheduled-run prompt input fixes (#92).
- Onboarding setup checklist for new installations (#89).
- Add keywords directly from keyword/competitor research (#83).

### Fixed

- Personas header text overflow (#100); repo-wide eslint/ruff debt cleared
  (#94); lockfiles refreshed clearing npm audit findings (#98).

## [1.0.0] - 2026-02-17

### Added

- Initial release of the Citation Analysis System.
