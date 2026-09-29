# Reports: benchmark against AI-visibility vendors

September 2026. This compares the reports of eleven AI-search visibility products with ours, lists the gaps and says how 2.23.0 closes them. The KPIs themselves are defined in [kpi-definitions.md](kpi-definitions.md).

The vendor findings come from public docs, help centres and product pages (sources below), paraphrased. "Not found" means nothing public was found, not that the feature is missing.

## What the market offers

The reports most vendors have ("table stakes", offered by at least half of the eleven):

| Report | Typical structure | Typical charts | Who |
|---|---|---|---|
| Brand overview | Filters (date range with previous-period comparison, engine, topic) → KPI cards → visibility trend vs competitors → leaderboard → top sources → recent answers | Multi-line trend, SOV donut, ranked table with deltas | All 11 |
| Competitor benchmark | SOV snapshot → SOV over time → per-competitor KPI table → head-to-head | Donut/pie, lines per brand, bar/line toggle, SOV × sentiment bubble | All 11 |
| Engine (platform) breakdown | KPIs per AI engine, trend per engine | Grouped or stacked bars by engine, brand × engine heatmap | 10 of 11 |
| Prompt / keyword report | Table per prompt with its KPIs, drill-down to the full answers and sources | Table, per-prompt trend | All 11 |
| Sources (cited domains and URLs) | Top domains over time → movers → owner/type split → table (citations, citation share, rate) → URL drill-down | Top-5 domain lines, horizontal bars, owner pie | All 11 |
| Sentiment | Net score over time → by engine → traits / statements behind it | Line, stacked split bars, radar of traits | 10 of 11 |
| Topic breakdown | KPIs per topic (tag, keyword group) with period deltas | Topic × competitor heatmap | 10 of 11 |
| Gap analysis / recommendations | Topic gaps and source gaps, prioritised actions | Scored tables | 10 of 11 |
| Distribution | PDF + CSV/XLSX; many add Looker Studio or scheduled email | — | PDF 5, CSV 9 |

Differentiators a few vendors have: AI crawler and referral traffic (Peec, Profound, Scrunch, Promptwatch), fact-checking of AI claims (Profound), a dollar value of visibility (Athena), source-type taxonomies (Peec, Profound), persona × intent heatmaps (Conductor), public pitch reports (Athena, Promptwatch), shopping and ads tracking (Otterly, Profound).

## Where we stand (2.22.0)

| Report | Us | Gap |
|---|---|---|
| Brand overview | Visibility tab and Brand Visibility report: every KPI with change and trend, keyword table, brand leaderboard, Excel export | No charts beyond the per-group KPI line; no SOV donut |
| Competitor benchmark | Brand leaderboard (latest runs); Competitor Gap report (outranked keywords, outreach targets) | No SOV over time per brand, no SOV snapshot chart |
| Engine breakdown | Provider differences in the Keyword Deep Dive (ranks only); citations per provider on the Dashboard | **No KPIs per engine** |
| Prompt / keyword report | Keyword Deep Dive, keyword detail of the per-group report | — |
| Sources | Citations tab (per URL), Citation Gaps (sources citing competitors, not us) | **No domain rollup** with citation share and owned vs other, no chart |
| Sentiment | Net sentiment KPI and split; sentiment quotes in the Deep Dive | **No sentiment report**, no trend or per-engine view |
| Topic breakdown | Keyword groups: per-group report with runs, drivers and keyword drill-down | — |
| Gap analysis / recommendations | Citation Gaps, Action Center, Content Action Plan | — |
| Distribution | Print to PDF (every report), Excel (Visibility tab, per-group report, Brand Mentions, Citations) | No scheduled email (out of scope) |

Out of scope for now, because the system does not collect the data: countries and languages, AI crawler and referral traffic, prompt volumes, shopping.

## How 2.23.0 closes the gaps

Data (`lambda/shared/kpi_engine.py`, `lambda/shared/visibility_views.py`), all from the same answers and KPI definitions:

- **Per-engine KPIs** (`engines`): every KPI for each AI engine, in `/visibility`.
- **Sources** (`sources`): per cited domain, the answers citing it, its citation rate and citation share, whether it is owned, and the engines and keywords citing it, in `/visibility`.
- **Brand trends** (`brand_trends`): share of voice, mention rate, visibility score and average position per period for the tracked brand and its leading competitors, in `/trends`.
- **Latest leaderboard** (`latest_brands`): the brand leaderboard of the latest periods, in `/trends` and `/reports/overview`.

Reports (all with the scope selector: one keyword, a keyword group or all keywords; print to PDF; KPI tooltips and definitions):

- **Competitor Benchmark** (new): share-of-voice donut, share of voice over time per brand, leaderboard with every KPI.
- **AI Engines** (new): KPIs per engine as grouped bars and a table, sentiment split per engine.
- **Sources** (new): citation KPIs, top domains chart (owned highlighted), domains table.
- **Sentiment** (new): net sentiment over time, split donut, sentiment per engine and per brand.
- **Charts in the existing reports and the Visibility tab**: a KPI trend line wherever a per-period table was the only history, the SOV donut next to every leaderboard, the engine chart in the Keyword Deep Dive.

## Sources

Vendor docs read for this benchmark (September 2026):
[Otterly brand report](https://otterly.ai/blog/better-brand-reporting-otterlyai/),
[Otterly exports](https://help.otterly.ai/can-i-export-my-data-and-reports),
[Peec performance](https://docs.peec.ai/understanding-your-performance),
[Peec domains](https://docs.peec.ai/domains),
[Profound Answer Engine Insights](https://www.tryprofound.com/features/answer-engine-insights),
[Profound reports API](https://docs.tryprofound.com/rest-api/reports/reports-v2-overview),
[Scrunch metrics](https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide),
[Semrush Visibility Overview](https://www.semrush.com/kb/1596-visibility-overview-report),
[Semrush Brand Performance](https://www.semrush.com/kb/1595-brand-performance-reports),
[Ahrefs Brand Radar](https://ahrefs.com/academy/how-to-use-brand-radar/overview),
[Evertune AI Brand Index](https://www.evertune.ai/platform/ai-brand-index),
[Conductor AI Search Performance](https://support.conductor.com/docs/intelligence/ai-search-performance/),
[Promptwatch dashboard](https://promptwatch.com/docs/academy/reading-your-dashboard),
[Promptwatch sharing](https://promptwatch.com/docs/academy/sharing-reports),
[Athena Olympus](https://athenahq.mintlify.app/guides/olympus),
[Rankscale dashboard](https://ai-visibility.keyword.com/resources/modules/diagnose/how-to-read-your-rankscale-dashboard).
