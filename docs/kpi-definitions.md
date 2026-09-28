# KPI definitions

This is the reference for every visibility KPI the system reports: what each one means, how it is calculated, and which market definition it follows. Every page, export and alert uses these definitions. Nothing else may define them.

- Code source of truth: `lambda/shared/kpi_engine.py` (the calculations) and `web/src/constants/kpiDefinitions.ts` (the customer-facing wording in tooltips and exports).
- Contract: `lambda/shared/test_kpi_contract.py` fails when the KPI sections below, `KPI_IDS` in the engine and the web definitions list different KPIs. Change all three together.

## Conventions

**Answer.** The unit of measurement is one successful answer from one AI engine (OpenAI, Perplexity, Gemini, Claude) to one query in one analysis run. A query is a keyword, optionally rewritten by a persona. For example, one run over 10 keywords, 4 engines and no personas produces up to 40 answers.

These are not answers and are excluded from every KPI:

- rows from the optional web-search providers (Brave, Tavily, Exa, SerpAPI, Firecrawl), because they return links and never write an answer that could name a brand;
- failed engine calls (`status` other than `success`).

A row is an answer when its `provider` is an AI engine; the provider decides the type. A row without `status` counts as successful; such rows were written before failures were stored.

**Tracked brand.** All brands classified as first-party in the brand configuration, taken together. For a hotel chain that means every name the hotel is known by. "Mentions the brand" means the answer names at least one of them.

**Sighting.** One brand named in one answer. A brand named several times in the same answer is still one sighting, at its best position. Otherwise a long answer that repeats a name would outweigh a short one.

**Position (rank).** The order in which brands first appear in an answer: 1 is the first brand named. For the tracked brand, it is the best position of any first-party brand in that answer. The extractor stores 999 when it could not place a brand; that counts as "position unknown".

**Owned domains.** The website domains of the tracked brand, set in Settings → Brand Tracking → Owned Domains (`first_party_domains`). A cited URL is owned when its host is an owned domain or a subdomain of one: `blog.hotel.com` is owned for `hotel.com`, but `nothotel.com` is not. Owned domains, first-party brands and competitors are global. They apply to every keyword group.

**Pooling.** A value for several answers is computed from counts added up over all of them, then divided once. This applies to a keyword group, a period, a run, or all keywords. Every answer weighs the same. Percentages are never averaged. The per-keyword view stays available in the keyword drill-down.

**Points vs. percent.** Rates are percentages from 0 to 100. The change between two periods is given in points: going from 40 % to 46 % is +6 points, not +15 %.

**Sample size.** Every KPI is shown next to the number of answers it was computed from. AI answers vary between runs, so small samples are noisy. With 20 answers, one extra mention moves the mention rate by 5 points.

**Empty values.** When there is nothing to divide by (no answers, no ranked mention, no owned domain configured), the KPI is empty ("—"), not 0. A KPI that is 0 means it was measured and was zero.

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
| Citation share | owned cited domains ÷ all cited domains | 0–100 % | higher |
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

**Market:**

- Otterly: "Brand coverage" is the share of prompts where the brand appears.
- Peec: "Visibility" is the share of chats that mention the brand.
- Profound, Scrunch and Semrush: "visibility" or "mention rate" is the share of responses mentioning the brand.

Otterly counts once per prompt, whereas we count once per answer. That matches Peec, Profound and Scrunch, and it also rewards being named by more engines.

**Replaces:** the old "citation rate" of the group report (`coverage_rate`), which counted keywords, not answers. That value survives as [keyword coverage](#keyword_coverage--keyword-coverage).

### `share_of_voice` — Share of voice

**Formula:** sightings of first-party brands ÷ sightings of all brands (first-party, competitors, others) × 100.

A sighting is one brand in one answer, so a brand named five times in one answer counts once. Counts are pooled over all answers in scope.

**Edge cases:** empty when the answers name no brand at all. The result is 0 when brands are named but the tracked brand is not.

**Market:**

- Peec: share of voice is the brand's mentions divided by the mentions of all tracked brands.
- Otterly and Semrush: share of voice is the brand's share of all brand mentions.
- Scrunch and Evertune: similar definitions based on mention counts.

We count each brand once per answer, which is how Peec and Scrunch count mentions.

**Replaces:**

- the group report's share of voice, which summed raw `mention_count` values (repetitions included) and then averaged the keywords;
- the Visibility tab's share of voice, which divided by the number of brands.

### `average_position` — Average position

**Formula:** the mean of the brand's best position, over the answers that name the brand and place it. Lower is better, and 1 is the best possible value.

**Edge cases:** answers that do not mention the brand are not in this average. A brand named once, first, has an average position of 1 however rarely it is mentioned, so always read it with the mention rate. Mentions with an unknown position (999) are left out. The KPI is empty when no mention has a known position.

**Market:**

- Peec: position is the brand's average rank in the chats that mention it.
- Profound and Semrush: average position counts only responses where the brand appears.
- Otterly: "average position" in the ranking list.

**Replaces:** "mean rank" in the prominence block; the formula is the same, but it is now pooled.

### `top_1_share` — Top-1 share

**Formula:** answers naming the tracked brand first ÷ answers × 100.

Unlike the average position, the denominator is every answer, including answers that do not mention the brand. This makes it a rate of being the first recommendation.

**Edge cases:** empty when there are no answers.

**Market:** there is no vendor standard. Evertune and Profound report the distribution of positions; this is our summary of it.

**Replaces:** "rank #1 share".

### `top_3_share` — Top-3 share

**Formula:** answers naming the tracked brand in positions 1–3 ÷ answers × 100. It is the same as [top-1 share](#top_1_share--top-1-share), for the top three.

### `visibility_score` — Visibility score

**Formula:** the mean over answers of w(position) × 100, where w(p) = 0.9^(p − 1):

| Position | 1 | 2 | 3 | 4 | 5 | 10 or lower, or unknown | not mentioned |
|---|---|---|---|---|---|---|---|
| Weight | 1.00 | 0.90 | 0.81 | 0.73 | 0.66 | 0.39 | 0 |

The score combines how often and how early the brand is named in a single 0–100 number. Mentioned first in every answer is 100; never mentioned is 0. Sentiment is not part of the score. It is reported separately as [net sentiment](#net_sentiment--net-sentiment).

**Edge cases:** empty when there are no answers. A mention whose position is unknown gets the 10th-position weight: it still counts as a mention, but not as a prominent one.

**Market:**

- Evertune: the visibility score weights each mention by position, and each position is worth 90 % of the one above it.
- Profound and Semrush: visibility scores combine mention frequency with position.
- Otterly: "brand visibility index".

**Replaces:**

- the 4-factor score (mentions, rank, sentiment, provider breadth) used on the Visibility tab;
- the 3-factor, sentiment-agnostic score used on the group report.

Old and new scores are not comparable. The first period after the change has no trend.

### `citations` — Citations

The number of answers that cite at least one owned domain as a source.

**Edge cases:** empty until owned domains are configured. With owned domains configured and no answer citing them, it is 0.

### `citation_rate` — Citation rate

**Formula:** citations ÷ answers × 100.

This is the share of AI answers that link to the brand's own website. It is independent of whether the brand is named in the text.

**Edge cases:** empty until owned domains are configured, or when there are no answers.

**Market:**

- Otterly: "domain coverage" is the share of prompts citing the domain.
- Peec: the share of chats that cite the domain.
- Semrush and Ahrefs: cited pages and citation counts.
- Profound: "citation rate".

**Replaces:** nothing. Before this change, the report called its mention coverage "citation rate".

### `citation_share` — Citation share

**Formula:** owned (answer, domain) pairs ÷ all (answer, domain) pairs × 100.

Each cited domain counts once per answer, however many of its URLs the answer lists. This is the brand's share of all the sources the AI engines cite.

**Edge cases:** empty until owned domains are configured. It is also empty when the answers cite nothing.

**Market:**

- Promptwatch: citation share is the brand's share of all citations.
- Otterly and Peec: domain share of citations.
- Scrunch: source share.

### `net_sentiment` — Net sentiment

**Formula:** (positive − negative) ÷ labelled first-party sightings × 100. The range is −100 (all negative) to +100 (all positive).

The labels are positive, neutral, negative and mixed. Neutral and mixed sightings count in the denominator but pull toward 0. Sightings without a label are left out. The split (positive, neutral, negative, mixed) is reported next to the net value.

**Edge cases:** empty when no mention of the brand has a sentiment label.

**Market:**

- Otterly: the "net sentiment score" is on a −100 to +100 scale.
- Peec and Profound: sentiment is the share of positive, neutral and negative mentions.
- Scrunch: sentiment split.

### `engine_coverage` — Engine coverage

**Formula:** AI engines with at least one answer naming the brand ÷ AI engines with at least one answer in scope × 100.

**Edge cases:** empty when there are no answers. Engines that were disabled, or failed for the whole scope, are not in the denominator.

**Market:**

- Otterly and Peec: platform and model breakdown of visibility.
- Scrunch: "platform coverage".

**Replaces:** `provider_coverage`. On Prompt Insights it wrongly divided by answer rows instead of engines.

### `keyword_coverage` — Keyword coverage

**Formula:** keywords with at least one answer naming the brand ÷ keywords with at least one answer in scope × 100.

It shows how much of the keyword set the brand appears for at all, however many engines name it for each keyword.

**Edge cases:** empty when there are no answers.

**Market:** Otterly's "brand coverage" counts prompts; this is the same idea one level up, where a keyword is a topic.

**Replaces:** the group report's old "citation rate" (`coverage_rate`).

## Per-brand leaderboards

Tables that list every brand named in the answers apply the same formulas to each brand on its own: mentions, mention rate, share of voice, average position, best position, visibility score, engines, keywords and net sentiment.

A table is sorted by visibility score, then mentions, then name. Engine lists are per brand. A brand's classification is taken from the first answer that names it.

## Scopes and aggregation

- **Keyword group.** All answers of the group's keywords, pooled.
- **Group run.** A run that answered at least half of the group's keywords (`GROUP_RUN_MIN_COVERAGE`). Only group runs are compared with each other. A run of a single keyword stays in the keyword drill-down.
- **Period.** All answers whose run timestamp falls within the period, pooled.
- **Keyword drill-down.** The same KPIs, computed from one keyword's answers.

## Changes and trends

- **Change.** The current value minus the value of the previous comparable scope: the previous group run, or the previous period of the same length. It is in points for percentages and scores, in positions for average position, and in units for counts. It is empty when either side is empty.
- **Trend.**
  - Improving: the change is ≥ +2 points. For average position, the position falls by ≥ 0.5.
  - Declining: the same thresholds in the other direction.
  - Stable: anything in between, or when there is no change to judge.

  The band keeps run-to-run noise from reading as a trend.
- **Alerts.** Alert rules compare two consecutive complete group runs and use the same KPIs and changes: a mention-rate drop (called "citation-rate drop" before 2.21.0), a loss of average position, a competitor newly reaching the top positions, a keyword whose answers stop naming the brand, and a visibility-score gain after a content change. When a KPI definition changes, the stored baseline is reset. The first run after the change sets a new baseline and does not raise an alert.

## Sources

The market definitions above are paraphrased from these public pages, read in September 2026:

- [Otterly — brand report KPI definitions](https://help.otterly.ai/brand-report-kpi-definition)
- [Peec AI — metrics overview](https://docs.peec.ai/metrics-overview)
- [Profound — how to track your visibility in AI search](https://www.tryprofound.com/blog/how-to-track-your-visibility-in-ai-search)
- [Scrunch — metrics guide](https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide)
- [Semrush — AI SEO metrics](https://www.semrush.com/kb/1594-ai-seo-metrics)
- [Ahrefs — AI visibility metrics](https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics)
- [Evertune — essential AI search optimization metrics](https://www.evertune.ai/resources/insights-on-ai/15-essential-metrics-every-ai-search-optimization-platform-should-track)
- [Conductor — AI search academy](https://www.conductor.com/academy/ai-search/)
- [Promptwatch — citation share](https://promptwatch.com/glossary/citation-share)
