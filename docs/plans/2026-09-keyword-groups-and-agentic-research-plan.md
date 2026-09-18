# Plan: Keyword Groups, Editable Schedules, Group KPIs, Reliable Keyword Research, Research Agent, Content Workflow

Status: IN DELIVERY — 2026-09-18. Phase 0a (2.0.1), Phase 1 (2.1.0, keyword groups + cap removal) and Phase 2 (2.2.0, parallel checkpointed research) merged + deployed; Phases 3–6 pending. Decisions D1, D3, D6, D9 locked (see §4).
Baseline: `main` at v2.0.0 (after Dependabot merges #104/#105/#106)
Scope: six related customer requests (hotel chain customer, contact: Bastián) plus a
dead-code cleanup the customer asked for. Original feedback was in Spanish; requirements
below are translated and normalised.

---

## 1. Summary

The customer manages ~60 keywords per hotel across several hotels and today has to
cherry-pick keywords one by one (Cmd+F) when launching analyses, creating schedules
and reading reports. Keyword research is slow and unreliable (timeouts lose results),
and the content team works outside the tool (Excel exports, chat messages, GPT).

The plan introduces one new core entity — a **Keyword Group** (the customer's
"folder / hotel"; see decision D1 on naming) — and then makes every workflow
group-aware:

| Epic | One-liner | Customer priority |
|---|---|---|
| A. Keyword Groups | Create groups, assign keywords (many-to-many), pick a whole group when launching an analysis | High |
| B. Schedules v2 | Click-to-edit, custom name, target = all / group(s) / specific keywords, resolved at run time | High |
| C. Group KPIs & reports | Aggregate + historical KPIs per group, group/keyword scope selector in every report, Excel export | High |
| D. Reliable keyword research | Async, checkpointed, resumable research/expansion — no lost results on timeout | High (prerequisite for E) |
| E. Keyword Research Agent | "Research this hotel, expand by A, B, C" → the agent plans, expands, evaluates, proposes 50–60 keywords into a group | Medium |
| F. Content Studio ↔ Analysis workflow | Keywords flow to Content Studio automatically, content changes are recorded, re-measure with one click, before/after comparison | Medium (added 2026-09-18) |
| G. Dead-code and duplication cleanup | Remove unused modules/functions/exports found by knip + vulture, consolidate duplicated logic (customer feedback: "a lot of dead code") | High (small, ships first) |

Every epic ships as its own PR with a minor version bump and CHANGELOG entry
(repo rule enforced by `.github/workflows/version-check.yml`).

---

## 2. Customer requirements (translated, normalised)

### 2.1 Folders / grouping by hotel ("the central request")
- R1. Create folders/groups of keywords, mainly one per hotel (e.g. "Hotel Gran Marino", "Hotel Coruña").
- R2. A keyword can belong to more than one group (some keywords are shared between hotels).
- R3. Select a whole group when launching an analysis.
- R4. Select a whole group when creating a schedule.
- R5. Stop hunting for individual keywords with Cmd+F — but keep full flexibility: a group and all its keywords, a group and some of its keywords, or several keywords from several groups.
- R6. Keep existing keywords; the feature only organises them.
- R7. Aggregated KPIs per hotel/group.
- R8. Historical evolution of KPIs per hotel/group.
- R9. Export results (the original text was cut off after "Exportación de resultados desde Citation…"; interpreted as exporting group/keyword results from the reports — to confirm, see Q8).

### 2.2 Schedules (product owner additions)
- R10. Click a schedule to edit it.
- R11. Give a schedule a custom name.
- R12. Schedule target = all keywords, one or more groups, or specific keywords.
- R13. Reports must accept "group" as a dimension (same as R7/R8).
- R14. Settings → Keywords: tag keywords with groups; a keyword may be in two groups; unlimited groups.

### 2.3 Keyword research: timeout and result loss
- R15. Research/expansion must run asynchronously and not depend on the UI staying open.
- R16. Partial results are saved progressively; a failure/timeout never discards processed work.
- R17. A failed/timed-out expansion can be resumed from where it stopped.
- R18. Visible status: Running → Processing → Completed, or Running → Partial → Retry.

### 2.4 Keyword Research Agent
- R19. Input: hotel + expansion configuration (destination, location, points of interest, hotel attributes, audience type, trip type).
- R20. The agent runs the initial search, analyses results, decides which keywords have potential, expands them, evaluates, repeats within the configured rules, and proposes a final list (~50–60 keywords).
- R21. Configurable rather than hard-coded: "Do keyword research for this hotel. Expand by A, B and C." — the agent produces its own execution plan.
- R22. Must survive long multi-step runs without the user keeping the screen open (depends on R15–R18).

### 2.5 Content Studio integrated with Citation Analysis
- R23. Remove the manual hand-off (analysis → export keywords → send file → content team → GPT → "done" message → re-run measurement).
- R24. After an analysis, keywords and baseline measurements are recorded and Content Studio receives them automatically.
- R25. The content person works from Content Studio; it is recorded that (and when) the content was updated.
- R26. Bastián can see the change is ready and re-launch the analysis for those keywords.
- R27. Before/after results are compared.
- R28. Explicitly NOT a complex autonomous agent — centralise the workflow and stop losing information between people and tools.

### 2.6 Code health (customer feedback, 2026-09-18)
- R29. The customer perceives "a lot of dead code": find functions/modules that are never called, remove them, and consolidate duplicated functions.
- R30. Keyword research must run several jobs concurrently and parallelise the work inside a job (today a job is one sequential Lambda and the self-invoking function is capped at 10 concurrent executions — the customer's bottleneck).

---

## 3. Current state (what the code does today) and gaps

Findings below are grounded in the codebase; file references are for the reviewer.

### 3.1 Keywords
- Table `CitationAnalysis-Keywords`: PK `id` (uuid5 of the normalised text), GSI `StatusIndex` (status, keyword). Item: `keyword, status, priority, region, language, category, notes, created_at, updated_at` (`lambda/shared/keyword_store.py`). `category` is free text, single-valued, never shown in the UI — it cannot express many-to-many (R2), so it is not reused.
- Keyword TEXT is the partition key of `SearchResults`, `Citations` and the `CrawledContent.KeywordIndex`. Renaming is (correctly) rejected with 409. New entities must reference the keyword `id` and carry the text.
- Settings → Keywords (`web/src/components/Keywords/KeywordsManager.tsx`) supports add / bulk add / rename / delete only. Bulk add is a client-side loop of single POSTs.
- Analysis trigger (`Execution/TriggerSection.tsx`) is a checkbox grid keyed by keyword text with no search; `POST /trigger-keyword-analysis` accepts up to 100 arbitrary strings.
- **ParseKeywords silently truncates every run to 100 keywords** (`lambda/parse-keywords/handler.py:245-248`), and the trigger endpoints add their own caps (100 in `trigger-keyword-analysis.py`, 500 in `trigger-analysis.py`). A customer with 3 hotels × 60 keywords already loses 80 keywords on every "all keywords" run. DECIDED: remove the cap (Epic A, see D9).
- Web has **no Zod**; runtime validation is hand-written type guards (`web/src/types/domain/keywordDecoders.ts`, documented as a deliberate decision). DECIDED: stay with type guards (D3).

### 3.2 Schedules
- EventBridge Scheduler is the only store (`lambda/api/manage-schedule.py`); no DynamoDB table. The EventBridge `Name` is the identity (AWS limit 64 chars, `[0-9a-zA-Z-_.]`, immutable) and is also what the user types as "Schedule Name".
- Target = the `CitationAnalysis-Workflow` state machine; `Target.Input` is `{"source":"dynamodb"}` (all active keywords, dynamic) or `{"keywords":[...text...]}` (a static snapshot — later renames/deactivations are ignored).
- Routes: `GET`, `POST`, `DELETE /api/schedules/{name}`. No `PUT`, no enable/disable, no get-by-id; list capped at 50 with an N+1 `get_schedule`. IAM already grants `scheduler:UpdateSchedule`.
- UI (`web/src/components/Schedule/`): create form + list with a delete icon; rows are not clickable. Timezone list is hard-coded (no Europe/Madrid); hour/minute ranges are not validated server-side; UI allows day-of-month 29–31 that the API rejects.

### 3.3 Reports and KPIs
- `/visibility`, `/brand-mentions`, `/persona-rankings` are single-keyword only (`require_keyword`). `/trends`, `/citation-gaps`, `/citations`, `/prompt-insights`, `/recommendations`, `/reports/overview` have an "all keywords" path that scans the Keywords table and fans out one `Query` per keyword in a thread pool, **capped at 20 keywords** (trends) / 50 / 20.
- The visibility-score formula is duplicated three times (`get-visibility-metrics.py`, `get-historical-trends.py`, `get-persona-rankings.py`). A group KPI must not add a fourth copy.
- `/visibility` reads full `SearchResults` items (including LLM response text, ~1 MB per keyword partition); fanning out over a 60-keyword group inside the 29 s API budget needs projection expressions.
- No date-range selector anywhere (trends hard-coded to 30 days in the UI). No shared multi-select component — keyword pickers are re-implemented six times (native `<select>`, card grid, checkbox grid).
- Exports are all client-side: Excel (`web/src/exporters/excelGenerator.ts`, used by Citations and Searches), DOCX (Content Studio), print-to-PDF for `/reports/*`.

### 3.4 Keyword research / expansion (root causes of R15–R18)
- `POST /keyword-research/expand` writes a `pending` row and **self-invokes** the same Lambda (`shared/self_invoke.py`) with a 120 s timeout. The worker makes ONE web-search LLM call (Perplexity → OpenAI → Gemini fallback, each with up to 5 retries × 60–90 s HTTP timeout) and performs ONE final `update_item`. When the 120 s Lambda timeout fires, the process is killed, nothing is written, and the row stays `processing`.
- Lambda async retries (default 2) re-run the whole job — up to 3× provider spend with no persisted output.
- Concurrency bottleneck (R30): one job = one Lambda that calls providers **sequentially** (first success wins), and the self-invoking `KeywordMgmt` function has `reservedConcurrentExecutions: 10`, so at most 10 research jobs run at once and none of them is parallel inside.
- Malformed/truncated LLM JSON becomes `[]` and the row is marked `completed` with 0 keywords.
- There is no `GET /keyword-research/{id}`; the UI polls `/history`, which is a `scan(Limit=50)` — once history has >50 rows a fresh job may never appear in the page and the poll "times out" although the job finished. Rows have no TTL and no `updated_at`.
- UI polls 3 s × 40 = 120 s, then errors; the server-side stale sweep runs at 180 s and only when someone lists history. Results live in React state only (lost on refresh).
- Reusable assets: the Step Functions analysis workflow (Map, retry/catch, logging, X-Ray, `stepFunctionsRole`), `GET /executions/{arn}` + `useExecutionPolling` (can re-attach to an ARN), Bedrock Converse wrapper `shared/models.py::invoke_bedrock` (single-turn, no tool use), prompt-safety helpers, `parse_llm_json`, the web-search provider registry `shared/ai_clients.py`.

### 3.5 Content Studio
- Table `CitationAnalysis-ContentStudio` (PK `id`, no GSI). Row status: `pending → generating → generated | failed`, plus a `viewed` flag. Ideas are computed live from active keywords + SearchResults (so keywords already "arrive automatically") but nothing records that content was published/updated, who did it, or which analysis run is the baseline. Executions are not persisted anywhere (Step Functions only); the only link between a run and its measurements is the shared `timestamp` in the SearchResults sort key.
- `RecommendationStatus` (new → in_progress → done/wontfix, TTL) is an existing "human action lifecycle" precedent to mirror.

### 3.6 The word "brand" is taken
"Brand" is the domain noun for "the company/product the AI mentions": table `CitationAnalysis-BrandConfig`, 8 routes (`/api/brand-config*`, `/api/brand-mentions`), the `/brands` tab ("Brand Mentions"), Settings tab "Brand Tracking", ~15 `Brand*` TypeScript types, `api/brands.ts`, 4 hooks, 22 components, and the KPI vocabulary (first-party vs competitor, share of voice). In the default `hotels` preset, a hotel is literally one of the tracked first-party brand strings — so "Brand Mentions for brand Hotel Coruña" would mean two different things on the same screen.

### 3.7 Dead code and duplication (R29) — measured 2026-09-18
Tools: `knip --production` on `web/` (unused files/exports ignoring test-only usage), `vulture` plus an AST/name-reference scan on `lambda/` (tests excluded), and grep confirmation of every candidate.

Web (`web/src`) — dead in production, kept alive only by their own spec files:
- Six typed API-client modules never imported by any hook or component: `api/brands.ts`, `api/content.ts` (also stale — reads `response.items`, which the Lambda never returns), `api/providers.ts`, `api/rawResponses.ts`, `api/research.ts`, `api/visibility.ts` (+ six spec files, ~1,400 lines). The hooks call `authenticatedFetch` directly; the client layer was only adopted by newer features (`users`, `reports`, `keywords`, `fetchSchedules`, `fetchCrawlHistory`).
- Unused functions inside partially-adopted clients: `api/dashboard.ts` (`fetchStats/fetchCitations/fetchSearches/fetchKeywords`), `api/executions.ts` (`fetchExecution/triggerAnalysis/createSchedule`), `api/reports.ts` (`fetchReportsOverview/fetchCompetitorRollup`), `api/users.ts` (`getUser`), `api/client.ts` (`apiPatch`).
- Dead components: `components/ErrorDisplay/*`, `components/Tables/*` (`RecentSearchesTable`, `TopCitationsTable`), `components/Execution/TriggerSection.tsx` and `ExecutionStatus.tsx` (byte-for-byte older copies of the components that live in `ExecutionMonitorComponents.tsx`), `exporters/analysisExecutor.ts`, `hooks/useBrandExpansion.ts`.
- Seven never-imported barrel files (`components/{Brands,Dashboard,Execution,Keywords,Layout,Reports,Schedule}/index.ts`), unused re-exports in `components/ui/index.ts`, `infrastructure/*/index.ts`, `Onboarding/index.ts`, `ProviderHealth/index.ts`, `Reports/layout/index.ts`.
- Seven components exporting both a named and an unused `default` export; assorted internal helpers exported for no reader; unused dev dependency `@types/unist`.

Lambda (`lambda/`) — the Python side is nearly clean: `shared/browser_tools.py::crawl_url` (37 lines, no caller), `api/manage-brand-config.py::get_preset_with_prompt` (no caller), three test-only alias constants in `api/promote-keywords.py`. Duplicated logic rather than dead code: `calculate_visibility_score` ×3 and `sentiment_to_score` ×2 (`get-visibility-metrics.py`, `get-historical-trends.py`, `get-persona-rankings.py`) — consolidated in Phase 0a (see Epic G). Not dead: the Brave/Tavily/Exa/SerpAPI/Firecrawl search clients are wired into the Search Lambda as optional providers.

Found and fixed on the way (not dead code, a KPI bug): `shared/providers.py::get_enabled_provider_count` counted all 9 known provider ids (4 LLM + 5 optional search providers) as the visibility "provider coverage" denominator, although brand mentions are only ever extracted from LLM responses — see Epic G for the fix.

---

## 4. Key design decisions

Locked in review round 1 (2026-09-18): D1, D3, D6, D9. Still open: D4, D7 details, D8 order.

**D1. DECIDED — the new entity is "Keyword Group".** UI label "Keyword Groups" (copy: "e.g. one group per hotel"); technical names `KeywordGroup`, `CitationAnalysis-KeywordGroups`, `/api/keyword-groups`, `useKeywordGroups`. Rationale in §3.6.

**D2. Group membership lives on the keyword item as a string set (`group_ids`), plus a small `KeywordGroups` table for group metadata.** Keyword counts are in the hundreds; every reader already loads the active keyword list via `StatusIndex`, so resolving a group is an in-memory filter with zero extra queries and no GSI. Deleting a group detaches it from its keywords in the delete handler. A membership table (PK group_id / SK keyword_id) is only worth it at thousands of keywords — not now.

**D3. DECIDED — no Zod at this stage.** New response shapes get hand-written type guards next to the existing ones (`web/src/types/domain/*Decoders.ts`), tested against fixture payloads.

**D4. Schedules stay in EventBridge Scheduler (single source of truth); no new table.** The `Name` becomes a generated immutable id (`sch-<8 hex>`), the `Description` holds the user's display name, and `Target.Input` carries a v2 descriptor with the full editable definition:
`{"schedule_id":"sch-…","display_name":"…","form":{frequency,time,timezone,day_of_week,day_of_month},"scope":{"mode":"all"}|{"mode":"groups","group_ids":[…]}|{"mode":"keywords","keyword_ids":[…]}}`.
ParseKeywords resolves the scope at run time (active keywords only), so adding a keyword to a group automatically includes it in the next run. Legacy inputs (`source: dynamodb`, `keywords: [...]`) keep working. Edit = `UpdateSchedule` (full replace; IAM already granted). Alternative (D4b): a `CitationAnalysis-Schedules` table as source of truth with EventBridge holding only the id — gives run history/ownership later but introduces two stores to keep in sync and a migration. Recommend D4 now; D4b only if we need per-schedule run history.

**D5. Report scope is resolved server-side.** Every read endpoint accepts exactly one of `keyword=` (unchanged), `group_id=`, or `keyword_ids=` (comma-separated ids, cap 100). A shared resolver turns the scope into a keyword list and the existing fan-out helpers aggregate. Frontend expansion (N single-keyword calls) would multiply Lambda invocations and force re-implementing the KPI formulas in TypeScript. The visibility formula already lives in `lambda/shared/visibility_score.py` (Phase 0a); share-of-voice moves there when the group aggregate needs it.

**D6. DECIDED — keyword research moves to a dedicated Step Functions Standard state machine that fans out one Lambda per planned query/provider in parallel; the Research Agent is the same state machine with LLM Plan and Evaluate steps and a bounded loop.** Every research job is its own execution, so N jobs run concurrently and each job runs its M searches in parallel (Map `maxConcurrency` ~10, bounded only by provider rate limits) — this removes the customer's bottleneck (R30): today one job is one sequential Lambda and the self-invoking function is capped at 10 concurrent executions. Not a longer self-invoke chain (its defects are structural: SIGKILL loses everything, async retries triple-run, polling by scan). Not Bedrock AgentCore Runtime / Strands for v1: nothing in the repo runs agents there, and the loop is "plan → N parallel web searches → merge → evaluate → maybe again", which Step Functions executes durably with retries, history and a status API we already have. The LLM still produces the plan and the decisions (R21), so the behaviour is agentic while every intermediate result is persisted (R16). Revisit AgentCore if we later need open-ended tool use.

**D7. Content workflow = a per-keyword "content task" state record, not a new automation agent (R28).** States `open → in_progress → content_updated → remeasured → closed`, with who/when/URL. Content Studio's work queue is derived automatically (all active keywords grouped by group, joined with task state and current KPIs) — no export step. Re-measurement reuses `POST /trigger-keyword-analysis`; the GenerateSummary step closes the loop server-side (works for scheduled runs too).

**D8. Delivery order.** G (cleanup) and the Phase 0 foundations first; A (groups) next because B, C and F build on it; D in parallel (independent); then C and B; E after D; F last unless you want to pull it forward (see Q1).

**D9. DECIDED — remove the 100-keyword cap.** `parse-keywords/handler.py` stops truncating, and `trigger-analysis.py` / `trigger-keyword-analysis.py` drop their 500/100 request caps in favour of validating that the keywords exist and are active (via the shared resolver). Throughput is then governed by the `ProcessKeywords` Map `maxConcurrency` (3 today; made a CDK context parameter) and the 2 h state-machine timeout; the trigger response returns the resolved keyword count and an estimated duration so a 200-keyword run is a visible choice, not a silent truncation. Provider rate limits, not an arbitrary cap, are the real constraint — the Search Lambda already retries with backoff.

**D10. Dead-code policy going forward.** `npm run deadcode` in `web/` (knip with `ignoreExportsUsedInFile`) must stay clean; `npm run deadcode:prod` and `scripts/lint-python.sh --dead-code` (vulture) are the stricter, advisory views. A symbol exported only for tests is acceptable; a module or function with no production caller is not.

---

## 5. Target design per epic

### Epic A — Keyword Groups

Data
- New table `CitationAnalysis-KeywordGroups`: PK `id` (uuid4). Attributes `name` (unique, case-insensitive), `description`, `created_at`, `updated_at`. PAY_PER_REQUEST, PITR, RETAIN (same template as other tables).
- Keyword item gains `group_ids` (DynamoDB string set, optional). `build_keyword_item` and the `Keyword` type/decoder expose `group_ids: string[]`.
- Shared resolver `lambda/shared/keyword_groups.py`: `resolve_scope(scope) -> list[KeywordRef]` for `all | group_ids | keyword_ids`, active keywords only, deterministic order, dedupe across groups. Used by ParseKeywords, trigger endpoints and all report endpoints.

API (added to the existing `CitationAnalysis-API-KeywordMgmt` consolidated Lambda and its router `lambda/api/keyword-mgmt.py`; new file `lambda/api/manage-keyword-groups.py`)
- `GET /api/keyword-groups` → `{groups:[{id,name,description,keyword_count,created_at,updated_at}]}`
- `POST /api/keyword-groups` (admin) `{name, description?}` → 201; 409 on duplicate name.
- `PUT /api/keyword-groups/{id}` (admin) rename/description.
- `DELETE /api/keyword-groups/{id}` (admin) → removes the id from every member keyword.
- `PUT /api/keyword-groups/{id}/keywords` (admin) `{add:[keyword_id…], remove:[keyword_id…]}` — bulk membership (the "drag 40 keywords into a folder" case).
- `POST /api/keywords` and `PUT /api/keywords/{id}` accept optional `group_ids`; `POST /api/keywords/promote` accepts optional `group_ids` so research results land directly in a group (used by Epic E).
- `POST /api/trigger-keyword-analysis` accepts `{scope:{mode,group_ids|keyword_ids}}` in addition to today's `{keywords:[…]}`; it resolves via the shared resolver so only real, active keywords are run.
- Cap removal (D9): `parse-keywords/handler.py` no longer truncates to 100; `trigger-analysis.py` (500) and `trigger-keyword-analysis.py` (100) drop their caps; `ProcessKeywords` Map `maxConcurrency` becomes a CDK context value (default raised to 5 after measuring provider error rates); the trigger response includes `keywords_count` and an estimated duration.
- `lambda/api/test_admin_route_authorization.py` gets the new mutating routes.

UI
- New shared component `web/src/components/ui/KeywordScopePicker/`: groups as collapsible sections with a tri-state "whole group" checkbox, per-keyword checkboxes, a search box, "Ungrouped" section and a selection counter. Two modes: `multi` (execution trigger, schedule form, content re-measure) and `scope` (reports: All / Group / Keyword). This replaces the six ad-hoc pickers over time (only the trigger and schedule pickers in this epic).
- Settings → Keywords: a "Groups" panel (create / rename / delete, keyword counts); group chips on each keyword row; per-keyword "Groups…" multi-select; bulk "Add selected to group…"; filter the list by group / ungrouped.
- Execution page: `KeywordScopePicker` (multi) replaces the checkbox grid; "Run group" one-click per group.
- Data hook `useKeywordGroups` (list/create/update/delete/assign) fed by `useDashboardData` alongside `/keywords`.

Acceptance (from R1–R6, R14)
- A keyword can be in 0..n groups; groups are unlimited; existing keywords are untouched by the migration (no data migration needed — `group_ids` is optional).
- Launching an analysis for "Hotel Coruña" runs exactly that group's active keywords; the user can untick some, or tick keywords from another group, before running.

### Epic B — Schedules v2

- Backend `manage-schedule.py`: `POST` generates `Name = sch-<hex>`, stores display name in `Description` and the v2 descriptor in `Target.Input`; new `GET /api/schedules/{id}`, `PUT /api/schedules/{id}` (admin; rebuilds cron from `form`, `UpdateSchedule` full replace incl. `State`), `DELETE` unchanged; optional `POST /api/schedules/{id}/run` (start an execution now with the same scope — also useful for Epic F). List response gains `id, display_name, form, scope, keyword_count, legacy: bool`. Legacy schedules (old Input shape) are listed read-only-ish: editing one rewrites it to v2 (same Name, keeps working).
- Validation fixes bundled: hour/minute ranges; timezone validated with `zoneinfo.available_timezones()` (frontend list gains Europe/Madrid and a searchable input); day-of-month 1–28 in the UI; pagination with `NextToken`.
- ParseKeywords: understands `scope` (via the shared resolver), still accepts the legacy inputs; unit tests for both.
- UI: clicking a row opens the same form in edit mode (pre-filled from `form`/`scope`); "Schedule name" is the display name (free text); scope = All / Groups / Specific keywords with `KeywordScopePicker`; enable/disable toggle; Save → `PUT`. `api/executions.ts` gains `createSchedule/updateSchedule/deleteSchedule` (the previous unused `createSchedule` is removed in Phase 0a) and `ScheduleManager` uses them instead of raw `authenticatedFetch`.

Acceptance (R4, R10–R12): a schedule named "Hotel Coruña — weekly" targeting group X runs whatever keywords are in X at trigger time; editing time/timezone/scope/name never requires delete + recreate.

### Epic C — Group KPIs, reports, export

- Build on `lambda/shared/visibility_score.py` (Phase 0a); add share-of-voice and the first-party/competitor group summaries there, pinned by tests on fixture responses.
- Scope parsing helper `lambda/shared/scope_params.py` (`keyword | group_id | keyword_ids`), then extend, in priority order: `/visibility` (group summary: mean first-party visibility, mean competitor visibility, summed share of voice, provider coverage, keyword count + per-keyword breakdown), `/trends` (group series = per-bucket mean of first-party score across keywords, plus optional per-keyword series; `days` up to 365 already supported), `/brand-mentions` (aggregate mentions/rank/provider counts across keywords), `/citation-gaps` and `/citations` (Query per keyword instead of Scan), `/reports/overview` (group-scoped executive summary). Later: `/persona-rankings`, `/recommendations`, `/stats`.
- Performance: projection expressions on the fan-out queries (drop the LLM response text), thread-pool cap raised to the group size (≤100), 5-minute in-memory cache like `get-stats.py`. Budget check: 60 keywords × projected Query must fit comfortably in the 29 s API limit — measured in the PR; fallback is a two-step (async compute + poll) only if measurements say so.
- UI: `KeywordScopeSelector` (All / Group / Keyword) in Visibility, Brands, Citation Gaps and the Reports layout; new "Group overview" on the Visibility dashboard: KPI cards, sortable per-keyword table, Chart.js line chart of the group's history with a 7 / 30 / 90-day range selector; print report `/reports/group/:groupId`.
- Export (R9): "Export to Excel" on the group overview (KPI table + history sheet) and on the Keyword Research results table, via the existing `exportToExcel`.

Acceptance (R7, R8, R13): "Hotel Gran Marino" shows one visibility score, share of voice and citation coverage for the group, its 90-day evolution, and the per-keyword table beneath; every report page can switch between All / a group / a keyword.

### Epic D — Reliable, parallel keyword research (async, checkpointed, resumable) — shipped in 2.2.0

- Step Functions Standard state machine `CitationAnalysis-KeywordResearch` (timeout 30 min) and the non-API worker Lambda `CitationAnalysis-ResearchWorker` (`lambda/research-worker`, 300 s, shared layer). The API Lambda `KeywordMgmt` dropped back to the 29 s cap, lost `reservedConcurrentExecutions` (it no longer self-invokes) and its documented exception was removed from `lib/citation-analysis-stack.spec.ts`.
- Parallelism (R30): one execution per research job (no shared cap between jobs); inside a job the `ExecuteResearchSteps` Map runs one worker invocation per configured provider with `maxConcurrency` 10, so an expansion over three providers finishes in the time of the slowest single call. Provider rate limits are respected by the clients' retry/backoff, bounded to 2 in-process attempts per step.
- Job model in the existing `CitationAnalysis-KeywordResearch` table (as built — steps live *inside* the job row rather than as sibling rows, so a single `GetItem` serves the poll and each step write is one atomic `SET steps.<step_id>`): `{id, type, status: pending|running|completed|partial|failed, steps: {<step_id>: {provider, status, keywords|analysis, keyword_count, raw_response ≤5 KB, error_message, started_at, finished_at}}, steps_total, steps_done, steps_failed, keywords|analysis (merged at Finalize), execution_arn, retry_count, retried_at, page_data (competitor scrape, fetched once), created_at, updated_at, finished_at, ttl (90 days)}`. GSI `TypeCreatedIndex` (type, created_at) makes history a newest-first Query. Shape and merge rules in `shared/research_jobs.py`, shared by API and worker.
- States: `PlanResearch` (steps to run; on retry only the non-completed ones) → `ExecuteResearchSteps` Map (`ExecuteResearchStep`; provider errors and unparseable JSON are recorded on the step and never raised; a worker crash is caught → `FailResearchStep`) → `FinalizeResearch` (merge: dedupe by `normalize_keyword`, rank by relevance then provider agreement, keep `providers` provenance; `completed` if all steps ok, `partial` if some failed, `failed` if none produced output). Any crash in Plan/Map/Finalize → `FailResearchJob` → `Fail`.
- API: `POST /keyword-research/expand|competitor` create the row and `StartExecution` (202 with the pending job); `GET /keyword-research/{id}` (job + steps + merged results, merged progressively while running); `POST /keyword-research/{id}/retry` (new execution, same job id, only failed steps — R17); `/history` via the GSI. The reader-side stale sweep is a safety net for executions that died: 35 min after the current attempt started.
- Frontend `useKeywordResearch`: polls `GET /keyword-research/{id}` every 3 s, backing off to 10 s after a minute, for longer than the state-machine timeout; renders `ResearchProgress` (status chip Queued → Running (x/y providers) → Completed | Partial (Retry) | Failed, per-step outcome — R18); the active job id is kept in `sessionStorage` so refresh/tab switch re-attaches (R15). Typed client `api/keywordResearch.ts`, polling in `hooks/researchPolling.ts`.
- Not done (deliberately): URL `?job=` parameter (session storage covers the refresh/tab case), per-provider concurrency ceilings (no provider throttles at 3 parallel calls).

### Epic E — Keyword Research Agent

- Input form ("Research Agent" tab): seed (hotel name), market + language, expansion dimensions as toggles — destination, location/neighbourhood, points of interest, hotel attributes, audience type, trip type — plus a free-text instruction ("also expand by events and seasons"), target count (default 60), max rounds (default 2, hard cap 3), destination group (existing or "create new").
- Same state machine as Epic D with two Bedrock steps (new roles `RESEARCH_PLANNING` → Sonnet tier, `RESEARCH_EVALUATION` → Haiku tier, overridable via the existing `BEDROCK_TIER_<ROLE>` env pattern):
  1. `Plan`: from seed + dimensions + instruction, produce a structured plan (≤8 queries per round, each tagged with a dimension and rationale) — persisted on the job (R21).
  2. `Map ExecuteSteps`: one web-search LLM call per planned query (Epic D machinery), each checkpointed.
  3. `Evaluate`: dedupe/cluster, score relevance/intent/competition, choose which candidates deserve a deeper round, and decide `continue | stop` with a written reason — persisted as the round's evaluation.
  4. `Choice`: continue while `round < max_rounds` and the evaluator says so; else `Finalize`: ranked proposal of ≤ target count, grouped by dimension, with intent/competition/rationale.
- Guardrails: bounded rounds and queries, every user string wrapped with `shared/prompt_safety.wrap_user_input`, `parse_llm_json` with schema checks, cost estimate shown before running (queries × rounds web-search calls + 2 Bedrock calls per round), full "agent trace" (plan, rounds, evaluations) visible in the UI and kept with the job.
- Output: review table with per-dimension sections and checkboxes → "Add N keywords to group ‹Hotel X›" (promote with `group_ids`, Epic A). Excel export of the proposal (R9).

Acceptance (R19–R22): starting a run for "Hotel Gran Marino" with 4 dimensions produces a plan, executes it over ≤3 rounds without the browser open, survives a single provider failure with a `partial` result, and ends with a reviewable list of ~60 keywords that can be added to the hotel's group in one click.

### Epic F — Content Studio ↔ Citation Analysis workflow

- New table `CitationAnalysis-ContentTasks`: PK `keyword_id`; attributes `keyword, group_ids, status (open|in_progress|content_updated|remeasured|closed), assigned_to, content_ids[] (ContentStudio rows), published_url, notes, baseline_run_ts, content_updated_at, content_updated_by, remeasure_execution_name, after_run_ts, created_at, updated_at`; GSI `StatusIndex` (status, updated_at). Users are identified from the Cognito claims already parsed by `shared/auth.py`.
- Work queue (R24): Content Studio gains a "Work queue" tab listing active keywords grouped by Keyword Group, each with task state (default `open` when no row exists — no fan-out writes per run), current visibility score and gap count, and the existing ideas/generated content for that keyword. Optional explicit hand-off: "Send to Content" from Citation Gaps / Group overview sets `baseline_run_ts`, notes and priority.
- Content person (R25): opens a keyword, works with the existing generator, clicks "Mark content updated" (+ URL, notes) → `PUT /api/content-tasks/{keyword_id}` records status, timestamp and user. Open to authenticated users (not admin-only).
- Bastián (R26): the Execution page shows "Ready to re-measure: N keywords"; one click calls `POST /trigger-keyword-analysis` with those keywords (admin) and stores `remeasure_execution_name`. When the run finishes, the `GenerateSummary` Lambda moves matching tasks to `remeasured` with `after_run_ts` — server-side, so scheduled runs also close the loop.
- Comparison (R27): `GET /api/content-tasks/{keyword_id}/comparison` returns visibility score, share of voice, brand mentions and citation count at `baseline_run_ts` vs `after_run_ts` with deltas (SearchResults sort key `begins_with(timestamp)`, same trick `/brand-mentions?timestamp=` uses today); group-level comparison aggregates across tasks. UI: "Before / After" panel in Content Studio and in the Group overview.
- Out of scope for v1: notifications (SNS/e-mail), roles beyond Admin/Users, editing content on the customer's CMS.

Acceptance (R23–R28): no file leaves the tool; the timeline "analysis → content updated (by whom, when) → re-measured → delta" is visible per keyword and per group.

### Epic G — Dead-code and duplication cleanup (Phase 0a — executed 2026-09-18, pending PR)

Done in the working tree (87 files, −4,116 / +1,171 lines incl. lockfile; web 1,247 tests, lambda 1,092 tests, CDK 52 tests green; `eslint`, `tsc`, `ruff` clean):
- Deleted 32 files: the six unused `api/*` clients and their specs, `components/ErrorDisplay/*`, `components/Tables/*`, the duplicate `Execution/TriggerSection.tsx` + `ExecutionStatus.tsx`, `exporters/analysisExecutor.ts`, `hooks/useBrandExpansion.ts` (+spec), and seven never-imported barrels.
- Removed dead functions from partially used clients (`dashboard.ts`, `executions.ts`, `reports.ts`, `users.ts`, `client.ts::apiPatch`) and rewrote their specs to cover only what remains; dropped seven unused `default` exports; un-exported ~20 file-private helpers; trimmed the `ui`, `infrastructure`, `Reports/layout`, `Onboarding`, `ProviderHealth` barrels to what is actually imported; removed the unused `ChevronRightIcon`, `PROVIDERS` array, `downloadSearchesToExcel`, five dead `*ReportData` type aliases and `@types/unist`.
- Consolidated a duplicate found on the way: `BrandExpansionResult` / `BrandExpansionAllResult` / `CompetitorDiscoveryResult` were defined in both `hooks/useBrandConfig.ts` and `types/api/brandConfig.ts` (with consumers split between the two); the `types/` copy is now the single definition and the five dead `*Response` types next to it are gone.
- Lambda: removed `browser_tools.crawl_url`, `manage-brand-config.get_preset_with_prompt` and the three test-only alias constants in `promote-keywords.py`.
- Repeatable check: `web/knip.json` (`ignoreExportsUsedInFile`) + `npm run deadcode` (knip, clean) and `npm run deadcode:prod` (`--production`, stricter: also lists fixtures and test seams). Lambda already has `scripts/lint-python.sh --dead-code` (vulture); note that vulture treats test references as usage, so pair it with a tests-excluded run when hunting production-dead code.
- Consolidated `calculate_visibility_score` (×3) and `sentiment_to_score` (×2) into `lambda/shared/visibility_score.py`; `lambda/shared/test_visibility_score.py` pins the module to the exact values the three handlers produced before the swap (captured from the old code). `get-historical-trends` now resolves the enabled-provider count once per aggregation instead of once per period bucket (each call was a ProviderConfig scan).
- Fixed the provider-coverage denominator (was Q9): `shared/providers.py::get_enabled_provider_count` counts LLM providers only. Brand extraction never runs on the five optional search providers (`search/handler.py`), so including them capped the coverage term at 4/9 of its weight on every installation that had not configured them. Visibility scores rise after deploy; historical values were computed with the old denominator (called out in the CHANGELOG).
- Follow-up candidates surfaced by the scan but deliberately left alone: the six single-keyword pickers (replaced by `KeywordScopePicker` in Epic A) and the private `*Response` interfaces in `useBrandConfig.ts` that mirror the Lambda payloads.

---

## 6. Delivery plan

Each phase = one PR = one minor version + CHANGELOG entry; every PR runs `ruff check`, `pytest`, root `vitest` (CDK invariants: ≤29 s API Lambdas unless documented, log groups, Cognito on every route), web `eslint` + `tsc` + `vitest`, and updates README / `.kiro/steering/structure.md` where tables or components change. Sizes are relative (S < M < L).

| Phase | Version | Content | Size | Depends on |
|---|---|---|---|---|
| 0a. Dead-code cleanup (DONE, deployed) | 2.0.1 | Epic G: remove the unused modules/functions/exports listed in §3.7 (web + lambda), delete their spec files, trim barrels, drop `@types/unist`; add `knip`/dead-code scripts | S | — |
| 0b. Quick wins + foundations (folded into Phase 2) | — | `GET /keyword-research/{id}`; TTL on research rows; frontend polls by id with aligned window — all shipped in 2.2.0, so no separate release | S | 0a |
| 1. Keyword Groups + cap removal (DONE) | 2.1.0 | Epic A: table, `group_ids`, resolver, `/api/keyword-groups`, promote/trigger `group_ids`/`scope`, Settings Groups panel, `KeywordScopePicker`, trigger page; D9 cap removal + Map concurrency parameter | M | 0b |
| 2. Reliable, parallel research (DONE) | 2.2.0 | Epic D: research state machine + worker, parallel Map, job/step model, GSI + TTL, `GET /{id}`, retry endpoint, progressive UI, session re-attach (absorbed Phase 0b) | L | 0b (parallel with 1) |
| 3. Schedules v2 | 2.3.0 | Epic B: v2 descriptor, generated ids + display name, `GET/PUT /{id}`, run-now, ParseKeywords scope resolution, edit UI, validation fixes | M | 1 |
| 4. Group KPIs & export | 2.4.0 | Epic C: scope params on visibility/trends/brand-mentions/gaps/citations/overview, projections + cache, Group overview + history chart + range selector, scope selector in reports, Excel export | L | 1 |
| 5. Research Agent | 2.5.0 | Epic E: Plan/Evaluate steps, dimensions form, bounded loop, trace view, promote-to-group, export | L | 1, 2 |
| 6. Content workflow | 2.6.0 | Epic F: ContentTasks table + API, work queue, mark-updated, ready-to-re-measure, GenerateSummary hook, comparison endpoint + panels | L | 1, 4 |

Suggested sequencing with two streams: Stream 1 → Phases 0a, 0b, 1, 3, 4, 6; Stream 2 → Phase 2 then 5 (starts after 0b). Phases 3 and 4 can be developed in parallel once 1 is merged.

Per-phase test plan (following `.kiro/steering/testing.md`)
- Python: handler tests next to each module (`test_manage_keyword_groups.py`, `test_manage_schedule.py` additions, `test_keyword_groups.py` resolver, `test_visibility_score.py` pinning, research state handlers), `test_admin_route_authorization.py` updated for every new mutating route, ParseKeywords tests for legacy + v2 inputs.
- CDK: `lib/citation-analysis-stack.spec.ts` — new tables/functions/routes asserted, new state machine logging, timeout exceptions list updated (KeywordMgmt exception removed in Phase 2).
- Web: component specs with `*-fixtures.ts` for `KeywordScopePicker`, Groups panel, schedule edit mode, research progress/retry, work queue; hook specs (`useKeywordGroups`, `useKeywordResearch` re-attach, `useContentTasks`); type-guard decoders tested against fixture payloads.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing the 100-keyword cap makes a 200-keyword run take hours or hit provider throttling | Map concurrency as a CDK parameter, estimated duration in the trigger response, Search Lambda retry/backoff already in place; measure a 150-keyword run before raising the default |
| Group fan-out on `/visibility` exceeds the 29 s API budget for large groups | Projection expressions, parallelism, 5-min cache; measure in Phase 4; async compute + poll as fallback |
| Parallel research steps hit provider rate limits | Map `maxConcurrency` 10 per job, worker backoff, optional per-provider ceiling; cost estimate shown before an agent run |
| Research agent cost creep | Hard caps on rounds/queries, cost estimate before run, trace shows every call |
| Legacy schedules after Phase 3 | ParseKeywords keeps accepting legacy inputs; editing converts a legacy schedule in place |
| Dead-code removal deletes something reached only at runtime (lazy import, string route) | Every candidate grep-verified; lazy imports use named exports; full web + lambda + CDK suites run after the cleanup |
| Provider retry budgets (5 × 60–90 s) still exceed a single step | Per-step HTTP timeouts and retry counts tuned for the worker Lambda; Step Functions Retry replaces in-process retries |

---

## 8. Open questions for review

1. Priority order: is the order in §6 right? Should the Content workflow (Epic F) move ahead of the Research Agent (Epic E)? The customer marked folders/KPIs high; the content request was separate.
2. D4: EventBridge-only schedules (recommended) vs a new Schedules table with run history?
3. Who may trigger a re-measurement in Epic F — Admins only (current rule), or any authenticated user? Same question for "run now" on schedules.
4. Group KPI aggregation: simple mean of per-keyword visibility scores (recommended, transparent) or weighted (e.g. by keyword priority)?
5. R9 "export results" — confirm what should be exportable: group KPI table + history, research proposals, anything else (e.g. brand mentions per group)?
6. Research retention: 90-day TTL for research jobs OK? (Today: never expires.)
7. Agent scope for v1: the six listed dimensions + free-text instruction, max 3 rounds, target 50–60 — sufficient, or do you also want competitor-URL analysis inside the agent loop?
8. Should groups also scope Brand Tracking later (different first-party brand strings per hotel)? Not planned for this epic; flagging because the customer has one brand config for all hotels today.

(Former Q9, the provider-coverage denominator, is resolved: it now counts LLM providers only — see Epic G.)

---

## 9. Out of scope (for now)
- Multi-tenant workspaces / per-group Brand Tracking config (see Q8).
- Notifications to the content team (SNS/e-mail/Slack).
- Server-side PDF/CSV exports (client-side Excel/DOCX/print remain the pattern).
- Migrating Content Studio generation to the new state machine (same self-invoke defects; can follow Epic D's pattern later).
- Un-exporting building-block TypeScript types that knip flags in `web/src/types/**` (harmless, low value; revisit when those modules are touched).
