# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version is kept identical in `package.json` and `web/package.json` and is
shown in the dashboard under Settings and the About modal. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-changelog) for the release
process.

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

### Infrastructure

- Added four retained, encrypted, on-demand DynamoDB tables for snapshots,
  alerts, settings and content-change markers, plus one AWS-managed-key SNS
  topic. All resources are request-priced; no provisioned or continuously
  running compute was introduced.
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

### Fixed

- `POST /api/keyword-research/*` answered `{"error": "An unexpected error
  occurred"}` when no provider key was configured or the execution could not
  be started: `error_response` sanitizes exception *types* and swallowed the
  plain-string messages. The routes now return the real reason (400 "No API
  keys configured…", 503 "Could not start…").

### Changed (zero-duplication follow-through)

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

### Removed

- `WEB_SEARCH_PROVIDER_IDS` (`shared/ai_clients.py`) and the write-only
  `_browser_created_dynamically` attribute (`shared/browser_tools.py`): no
  readers anywhere.

### Deferred (resolved in 2.5.0)

- Nine clones inside files owned by the then-open research-agent PR (#113) —
  `api/keyword-research.py`, `api/test_keyword_research_job_lifecycle.py`,
  `research-worker/test_research_worker.py`, `shared/test_models.py` — were
  temporarily listed in the two Python jscpd configs' `ignore` so the gate
  stayed at threshold `0` without editing that PR's files. Cleared in 2.5.0.

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
