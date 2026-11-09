# KPI definitions

This is the reference for every visibility KPI the system reports: what each one means and how it is calculated. The Visibility tab, the reports and their exports, and the KPI alerts all use these definitions. Prompt Insights and Citation Gaps show figures of their own (see [engine coverage](#engine_coverage--engine-coverage)); those are not these KPIs.

- Code source of truth: `lambda/shared/kpi_engine.py` (the calculations) and `web/src/constants/kpiDefinitions.ts` (the customer-facing wording in tooltips and exports).
- Contract: `lambda/shared/test_kpi_contract.py` fails unless the KPI sections below, `KPI_IDS` in the engine and the web definitions list the same KPIs in the same order, with the same labels. Change all three together.

## Conventions

**Answer.** The unit of measurement is one successful answer from one AI engine (OpenAI, Perplexity, Gemini, Claude, Google AI Overviews) to one query in one analysis run. A query is a keyword, optionally rewritten by a persona, except for the plain-keyword engines below, which are always asked the keyword itself. For example, one run over 10 keywords, 4 engines and no personas produces up to 40 answers. Each answer row records the query that engine was actually sent (`query`), and that stored value is the record of what was asked, whatever the engine's definition says later. Rows written before 2.50 carry no `query`.

**Plain-keyword engines.** An engine whose provider definition sets `asks_plain_keyword` is asked the plain keyword once per keyword and run, never a persona's wording, and its answer is filed under the default (unpersonalised) prompt. Today that is Google AI Overviews. The field is set in code (`PROVIDER_DEFINITIONS` in `lambda/shared/config.py`), and no API route, MCP tool or ProviderConfig row can change it, because changing it would change what past and future answers measure. `GET /api/providers` shows it as a read-only field. A figure narrowed to one persona (`query_prompt_id` other than `default`) therefore holds no answer from a plain-keyword engine. Such an engine is left out of that figure's engine count (`engines`, and the denominator of [engine coverage](#engine_coverage--engine-coverage)) and out of its per-engine rows, and `/api/visibility` names it in `engines_not_covered` so that its absence is not read as zero coverage. The list holds only the plain-keyword engines with at least one answer in the same scope and `branded` filter over every persona. An engine that is switched off, was never run or found no overview is missing from every figure alike and is not named. Figures over every answer, or narrowed to the default prompt, cover every engine (`engines_not_covered` is empty).

**Google AI Overviews.** Google AI Overviews is an AI engine: the overview Google writes at the top of a results page (read through DataForSEO) is an answer, its references are its citations. It is a [plain-keyword engine](#conventions): asked the plain keyword once per keyword and run, never a persona's wording, so its answer is filed under the default (unpersonalised) prompt. A results page without an overview is *no answer* (`status` `no_answer`) and is excluded from every KPI; it is counted separately as [overview presence](#google-ai-overviews-presence).

These are not answers and are excluded from every KPI:

- rows from the optional web-search providers (Brave, Tavily, Exa, SerpAPI, Firecrawl, Amazon Bedrock Web Search), because they return links and never write an answer that could name a brand;
- failed engine calls and Google results pages without an AI Overview (`status` other than `success`);
- engine replies without answer text (blank after trimming). The call worked, so it is not a failure and the provider stays healthy, but it is stored as *no answer* (`status` `no_answer`, counted as `no_answers` in the run summary) because there is nothing to read a brand from.

A row is an answer when its `provider` is an AI engine; the provider decides the type. A row without `status` counts as successful.

**Cited, not retrieved.** An answer's citations are the URLs the answer itself cites: OpenAI's `url_citation` annotations, Perplexity's message annotations and the `search_results` its numbered markers (`[1]`, `[web:1]`) name, the citations on Claude's text blocks, Gemini's grounding chunks, Google AI Overviews' references, plus any URL written in the answer text. A Perplexity answer with no marker and no annotation cites all its `search_results`, which Perplexity reports as the sources of the answer. Engines also report pages they only read while searching (OpenAI's `web_search_call` sources, the Perplexity `search_results` a marked or annotated answer does not name, Claude's `web_search_tool_result` blocks). Those are stored on the row as `retrieved_urls` and never count: not in the citation KPIs, not in the Citations table, not in deduplication or crawling. A page the engine read and did not cite is not a source of the answer.

**Citation versions.** Every answer row written since 2.43.0 records `citations_version` `2`: the citation rule above (cited, not retrieved), with Perplexity and Claude asked to cite their sources. Rows written before carry no version (*unversioned (pre-2.43.0)*): they counted every source the engine returned. A citation KPI over a period that spans the upgrade therefore adds up two definitions. Every KPI object says which rules its answers were stored under (`citation_versions`: each rule with its answers, `[{"version": "2", "answers": 120}, {"version": "unversioned (pre-2.43.0)", "answers": 40}]`) and flags a mix (`citation_versions_mixed`); the dashboard shows a note above a view whose figures mix them. Stored rows are never rewritten to one rule (D1). Compare citation figures within one rule.

**Branded queries.** Every answer row records `branded` when it is written: `true` when the query the engine was asked (the keyword, or the persona's wording of it) names a first-party brand name or alias (as a whole word, case-, accent- and whitespace-insensitive, in any script) or an owned domain or a subdomain of it. Domains are label-guarded: `hotel.com` is named by `www.hotel.com` and `blog.hotel.com/x`, not by `hotel.com.evil.test` or `nothotel.com`. Competitor names do not make a query branded. An answer to a branded query mentions the brand almost by construction, so it says little about unprompted visibility. KPIs are computed over every answer by default; the Visibility tab can narrow them to `neutral` (non-branded) or `branded` answers (`branded` query parameter of `/api/visibility`, default `all`), and [alerts](#changes-and-trends) compare neutral answers. Rows written before 2.43 carry no flag. With `neutral` or `branded`, a run stored before the flag is left out (its rows cannot be told apart), so the filtered figures and the change against the previous run only count runs that were classified; the unfiltered view (`all`) counts every run.

**Cell.** One (keyword, persona, AI engine, market) combination. Comparisons between runs match answers cell by cell (see [Changes and trends](#changes-and-trends)).

**Tracked brand.** All brands classified as first-party in the brand configuration, taken together. For a hotel chain that means every name the hotel is known by. "Mentions the brand" means the answer names at least one of them. Brand names are compared case-, accent- and whitespace-insensitively.

**Sighting.** One brand named in one answer. A brand named several times in the same answer is still one sighting, at its best position (and with the sentiment of that sighting). Otherwise a long answer that repeats a name would outweigh a short one.

**Position (rank).** The order in which brands first appear in an answer: 1 is the first brand named. For the tracked brand, it is the best position of any first-party brand in that answer. The extractor stores 999 when it could not place a brand; that counts as "position unknown".

**Owned domains.** The website domains of the tracked brand, set in Settings › Brand Tracking under Owned Domains (`first_party_domains`). Hosts are compared lower-case, without `www.` or a port. A cited URL is owned when its host is an owned domain or a subdomain of one: `blog.hotel.com` is owned for `hotel.com`, but `nothotel.com` is not. Owned domains, first-party brands and competitors are global. They apply to every keyword group.

**Pooling.** A value for several answers is computed from counts added up over all of them, then divided once. This applies to a keyword group, a period, a run, or all keywords. Every answer weighs the same. Percentages are never averaged. The per-keyword view stays available in the keyword drill-down.

**Points vs. percent.** Rates are percentages from 0 to 100. The change between two periods is given in points: going from 40 % to 46 % is +6 points, not +15 %.

**Sample size.** Every KPI is shown next to the number of answers it was computed from. AI answers vary between runs, so small samples are noisy. With 20 answers, one extra mention moves the mention rate by 5 points.

**Empty values.** When there is nothing to divide by (no answers, no ranked mention, no owned domain configured), the KPI is empty ("—"), not 0. A KPI that is 0 means it was measured and was zero.

**Rounding.** Rates, the visibility score and net sentiment are rounded to one decimal; average position, changes and driver impacts to two.

## Summary

| KPI | Formula | Range | Better |
|---|---|---|---|
| Answers | successful AI-engine answers in scope | count | — |
| Mentions | answers naming the brand | count | higher |
| Mention rate | mentions ÷ answers | 0–100 % | higher |
| Share of voice | brand sightings ÷ all brand sightings | 0–100 % | higher |
| Average position | mean best position, over answers that rank the brand | 1+ | lower |
| Top-1 share | answers naming the brand first ÷ answers | 0–100 % | higher |
| Top-3 share | answers naming the brand in the top 3 ÷ answers | 0–100 % | higher |
| Visibility score | mean of the position weight 0.9^(position − 1) over answers × 100 | 0–100 | higher |
| Citations | answers citing an owned domain | count | higher |
| Citation rate | citations ÷ answers | 0–100 % | higher |
| Citation share | owned (answer, domain) pairs ÷ all (answer, domain) pairs | 0–100 % | higher |
| Net sentiment | (positive − negative) ÷ labelled sightings × 100 | −100 to +100 | higher |
| Engine coverage | engines naming the brand ÷ engines that answered | 0–100 % | higher |
| Keyword coverage | keywords with a mention ÷ keywords that were answered | 0–100 % | higher |

## KPIs

### `answers` — Answers

The number of successful AI-engine answers in scope (see [Conventions](#conventions)). It is the denominator of the rates below and the sample size shown next to them.

### `mentions` — Mentions

The number of answers that name the tracked brand at least once. An answer counts once, however many times or under however many first-party names it mentions the brand.

### `mention_rate` — Mention rate

**Formula:** mentions ÷ answers × 100.

This is the share of AI answers that mention the brand. It is the headline "how visible are we" KPI. It measures the answer text only. Whether the brand's website is cited as a source is the [citation rate](#citation_rate--citation-rate).

**Edge cases:** empty when there are no answers.

It counts once per answer, not once per keyword, so a brand named by more engines for the same keyword scores higher.

### `share_of_voice` — Share of voice

**Formula:** sightings of first-party brands ÷ sightings of all brands (first-party, competitors, others) × 100.

A sighting is one brand in one answer, so a brand named five times in one answer counts once. Counts are pooled over all answers in scope.

**Edge cases:** empty when the answers name no brand at all. The result is 0 when brands are named but the tracked brand is not.

### `average_position` — Average position

**Formula:** the mean of the brand's best position, over the answers that name the brand and place it. Lower is better, and 1 is the best possible value.

**Edge cases:** answers that do not mention the brand are not in this average. A brand named once, first, has an average position of 1 however rarely it is mentioned, so always read it with the mention rate. Mentions with an unknown position (999) are left out. The KPI is empty when no mention has a known position.

### `top_1_share` — Top-1 share

**Formula:** answers naming the tracked brand first ÷ answers × 100.

Unlike the average position, the denominator is every answer, including answers that do not mention the brand. This makes it a rate of being the first recommendation.

**Edge cases:** empty when there are no answers.

### `top_3_share` — Top-3 share

**Formula:** answers naming the tracked brand in positions 1–3 ÷ answers × 100. It is the same as [top-1 share](#top_1_share--top-1-share), for the top three.

### `visibility_score` — Visibility score

**Formula:** the mean over answers of w(position) × 100, where w(p) = 0.9^(p − 1):

| Position | 1 | 2 | 3 | 4 | 5 | 10 or lower, or unknown | not mentioned |
|---|---|---|---|---|---|---|---|
| Weight | 1.00 | 0.90 | 0.81 | 0.73 | 0.66 | 0.39 | 0 |

The decay (0.9, `POSITION_DECAY`) and the cap at the 10th position (`POSITION_WEIGHT_CAP`) are constants in the engine.

The score combines how often and how early the brand is named in a single 0–100 number. Mentioned first in every answer is 100; never mentioned is 0. Sentiment is not part of the score. It is reported separately as [net sentiment](#net_sentiment--net-sentiment).

**Edge cases:** empty when there are no answers. A mention whose position is unknown gets the 10th-position weight: it still counts as a mention, but not as a prominent one.

### `citations` — Citations

The number of answers that cite at least one owned domain as a source.

**Edge cases:** empty until owned domains are configured. With owned domains configured and no answer citing them, it is 0.

### `citation_rate` — Citation rate

**Formula:** citations ÷ answers × 100.

This is the share of AI answers that link to the brand's own website. It is independent of whether the brand is named in the text.

**Edge cases:** empty until owned domains are configured, or when there are no answers.

### `citation_share` — Citation share

**Formula:** owned (answer, domain) pairs ÷ all (answer, domain) pairs × 100.

Each cited domain counts once per answer, however many of its URLs the answer lists. This is the brand's share of all the sources the AI engines cite.

**Edge cases:** empty until owned domains are configured. It is also empty when the answers cite nothing.

### `net_sentiment` — Net sentiment

**Formula:** (positive − negative) ÷ labelled first-party sightings × 100. The range is −100 (all negative) to +100 (all positive).

The labels are positive, neutral, negative and mixed. Neutral and mixed sightings count in the denominator but pull toward 0. Sightings without a label are left out. The split (positive, neutral, negative, mixed) is reported next to the net value as `sentiment_split`.

**Labels.** The brand extractor (`lambda/search/brand_extractor.py`) labels each sighting by how that answer portrays that brand, not by the tone of the whole answer or the brand's general reputation:

| Label | When |
|---|---|
| positive | the answer recommends or praises the brand, or credits it with a favourable attribute |
| negative | the answer criticises the brand, warns against it, or its drawbacks dominate what is said about it |
| mixed | the answer clearly praises and clearly criticises the brand |
| neutral | the brand is named or listed without praise or criticism; being ranked or listed is not by itself positive |

With each label the extractor stores `sentiment_quote`, the passage of the answer that carries it (verbatim, empty for a plain neutral mention), and `sentiment_reason`, one sentence explaining it. Any other label is dropped, so that sighting counts as unlabelled. Answers analysed before 2.25.0 have no quote and were labelled without these definitions.

**Examples** (`/api/visibility/sentiment-examples`). The sightings behind one count of the split: the same answers (each keyword's latest run in the scope) and the same first-party sightings, filtered by `sentiment` and optionally by one AI engine (`provider`). The response gives `total` and the first `limit` (at most 50, default 20), newest run first, each with its quote, reason, ranking context, keyword, engine, persona and the answer (up to 20,000 characters).

**Edge cases:** empty when no mention of the brand has a sentiment label.

### `engine_coverage` — Engine coverage

**Formula:** AI engines with at least one answer naming the brand ÷ AI engines with at least one answer in scope × 100.

**Edge cases:** empty when there are no answers. Engines that were disabled, or failed for the whole scope, are not in the denominator. For a persona's figures, plain-keyword engines (Google AI Overviews) are not in the denominator either; `/api/visibility` lists the ones that answered in the scope in `engines_not_covered`.

Not the same as the "provider coverage" on Prompt Insights, which divides the engines naming the brand by every result row of the latest run (web-search, failed and persona rows included).

### `keyword_coverage` — Keyword coverage

**Formula:** keywords with at least one answer naming the brand ÷ keywords with at least one answer in scope × 100.

It shows how much of the keyword set the brand appears for at all, however many engines name it for each keyword.

**Edge cases:** empty when there are no answers.

## Per-brand leaderboards

Tables that list every brand named in the answers apply the same formulas to each brand on its own. Each row has the brand's `name` and `classification`, and its mentions, mention rate, share of voice, average position, best position, visibility score, net sentiment and `sentiment_split`, plus `engines` (the engines naming it) and `keywords` (how many keywords it is named for).

A table is sorted by visibility score, then mentions, then name. A brand's name and classification are taken from the first answer read that names it.

## Google AI Overviews presence

Not a KPI: it describes Google, not your brand. Reported next to `answers` (`kpi_engine.overview_presence`) as "Overview shown for n of m queries":

- `aio_queries`: Google AI Overviews rows whose results page was read (`success` + `no_answer`; failed calls measured nothing);
- `aio_overviews`: those that showed an overview (`success`);
- `aio_presence_rate`: `aio_overviews` ÷ `aio_queries` × 100, empty without a query.

## Breakdowns

These apply the same formulas to a slice of the scope's answers:

- **Per AI engine** (`engines` in `/api/visibility`). Every KPI of your brand, computed from one engine's answers, engines in name order. Within one engine, engine coverage can only be 0% or 100%.
- **Per cited domain** (`sources` in `/api/visibility`: the `SOURCES_LIMIT` = 25 most cited, of `sources_total`). For each domain: citations (answers citing it), citation rate (those answers ÷ all answers), citation share (its citations ÷ every answer-and-domain citation), whether it is one of your domains (`owned`), the engines citing it, and the number of keywords whose answers cite it. Sorted by citations, then domain. Other domains are not classified as competitor-owned.
- **Brand trends** (`brand_trends` in `/api/trends`). Share of voice, mention rate, visibility score and average position per period for your brand (your first-party brands pooled) and the `BRAND_TREND_COMPETITORS` = 5 competitors with the best visibility score over the whole window. A competitor not named in a period scores 0, with no position; its share of voice is empty if the period's answers name no brand at all.
- **Latest leaderboard** (`latest_brands` in `/api/trends` and `/api/reports/overview`). The per-brand leaderboard of each keyword's latest period, top `LATEST_BRANDS_LIMIT` = 10.

## Scopes and aggregation

- **Keyword group.** All answers of the group's keywords, pooled.
- **Group run** (`/api/reports/group-kpis`). A run whose `coverage` (the group's keywords with at least one successful answer at that run timestamp ÷ all of the group's keywords) is at least `GROUP_RUN_MIN_COVERAGE` = 50 %; the response flags it with `is_group_run` and returns the threshold as `group_run_min_coverage`. Only group runs are compared with each other. A run of a single keyword stays in the keyword drill-down.
- **Latest (Visibility tab, keyword and deep-dive reports, and the Competitor Benchmark, AI Engines, Sources and Sentiment reports).** Each keyword's latest run, pooled (`/api/visibility`). Its change compares each keyword's latest run with its previous run, over the keywords answered in both (like for like, `keywords_compared`), so a keyword analysed once does not distort the change.
- **Period (trend charts and tables, `/api/trends`).** All answers whose run timestamp falls within the day, ISO week or month, pooled. The latest standing of a scope pools each keyword's latest period with data. Its change pools, over the keywords with at least two periods, each keyword's latest period against that keyword's previous period with data.
- **Keyword drill-down.** The same KPIs, computed from one keyword's answers.

**History windows from per-run counts.** The windowed reads (`/api/trends`, `/api/reports/overview`, `/api/reports/group-kpis`, the stability facts of `/api/reports/insights` and the report-insights narratives) do not re-read every answer. They add up one row of counts per keyword and run (`CitationAnalysis-KeywordRunKpis`, `lambda/shared/kpi_tally.py`), written when the keyword's run completes. Every KPI is a ratio of such counts, so the pooled values are exactly the ones computed from the answers; the visibility score adds the position weights as exact integers (`position_points`), so no rounding depends on the order answers are added in. A run counted against other owned domains than the current ones is recounted from its answers. In those history views, the brand leaderboards (`brand_trends`, `latest_brands`) see at most `BRANDS_PER_RUN` = 25 brands per keyword and run: every first-party brand, every tracked competitor, then the most visible; share of voice still divides by every sighting of every brand. Runs read from their answers (before their row exists, or recounted) keep the same 25, so a window counts every run alike, and `brands_truncated` says when any run of the window kept fewer brands than it named: a competitor outside a run's 25 then reads as not named in that run.

## Changes and trends

- **Change.** The current value minus the value of the previous comparable scope: the previous group run, the keyword's previous run, or its previous period with data. It is in points for percentages and scores, in positions for average position, and in units for counts. It is empty when either side is empty.
- **Trend.** Called for the rates, the visibility score, average position and net sentiment; counts have no trend.
  - Improving: the change is ≥ +2 points (`TREND_BAND_POINTS`). For average position, the position falls by ≥ 0.5 (`TREND_BAND_POSITIONS`).
  - Declining: the same thresholds in the other direction.
  - Stable: anything in between, or when there is no change to judge.

  The band keeps run-to-run noise from reading as a trend.
- **Drivers.** Between two group runs, each keyword answered in both runs that moved is listed with its changes and its `impact` on the group's mention rate and visibility score: the keyword's change × its share of the later run's answers.
- **Alerts.** After each analysis run, the alert worker snapshots every keyword group the run covered completely: every keyword of the group processed in the run and answered at least once. It compares that snapshot with the group's previous one using the same KPIs, but with its own thresholds (Settings › Alerts), not the trend band:

  | Rule | Fires when | Default |
  |---|---|---|
  | Mention-rate drop | mention rate fell by at least the threshold | 10 points |
  | Position loss | average position worsened by at least the threshold | 1 position |
  | New competitor in the top N | a competitor's best position is N or better and was not before | N = 3 |
  | Lost keyword mention | a keyword was mentioned in the previous snapshot and is not now | — |
  | Improvement after a content change | the visibility score rose by at least the threshold after a content change recorded between the two snapshots | 5 points |

  Point and position thresholds accept 0.1–100 and N accepts 1–10. Each snapshot records the KPI definition version (`KPI_VERSION`, 4 since 2.43); snapshots of different versions are never compared, so the first run after a definition change sets a new baseline and raises no alert.

  **Like for like.** The rules do not compare the two snapshots' pooled values. They compare the neutral answers (queries that do not name the brand) of the [cells](#conventions) answered in both runs: the previous run's rows are read back for the group's current keywords, and a keyword, persona, engine or market present in only one run is left out, so enabling an engine or adding a persona never reads as a gain or a loss. Each snapshot stores its `comparison` with the previous one:

  | `state` | When | Alerts |
  |---|---|---|
  | `no_previous` | no earlier snapshot of the same KPI version | none |
  | `scope_changed` | the two runs share no answered cell | none |
  | `incomplete` | either run answered fewer than 90 % (`MIN_ANSWERED_SHARE`) of its planned answers (its answer-engine rows; a `no_answer` reply counts as answered, a failed call does not) | none |
  | `comparable` | otherwise | the rules above, on the matched cells |

  with `matched_cells`, `answered_share` (`previous`, `current`, in %) and `previous_snapshot_at`. A change is shown, and an alert raised, only when the state is `comparable`.
