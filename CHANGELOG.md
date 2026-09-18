# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version is kept identical in `package.json` and `web/package.json` and is
shown in the dashboard under Settings and the About modal. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-changelog) for the release
process.

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
