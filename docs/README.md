# Citation Analysis documentation

Reference documentation for the Citation Analysis sample, which measures AI search visibility (GEO) across OpenAI,
Perplexity, Google Gemini, Claude and Google AI Overviews on AWS with Amazon Bedrock. Start with the
[project README](../README.md) for deployment and an overview.

## Documents

| Document | What it covers |
|---|---|
| [kpi-definitions.md](kpi-definitions.md) | The visibility KPIs (mention rate, share of voice, average position, visibility score, citation rate, net sentiment, coverage), their formulas, edge cases, trends and alerts. |
| [geo-corrections.md](geo-corrections.md) | Why citation and other AI-visibility numbers changed in 2.43: cited versus retrieved sources, empty replies, branded queries, like-for-like alerts. |
| [mcp.md](mcp.md) | Connecting AI assistants (Kiro, Claude Code, Claude.ai, ChatGPT, Amazon Quick) through the MCP server: OAuth setup, tools, spend confirmation and limits. |
| [seo.md](seo.md) | The SEO section: setup with DataForSEO, its pages, who can do what, prices and markets. |
| [seo-domain.md](seo-domain.md) | Domain Overview, estimated traffic snapshots and the SEO recommendations in the Action Center. |
| [seo-backlinks.md](seo-backlinks.md) | Backlinks: referring domains, anchors, new and lost links, spam filtering and authority snapshots. |
| [seo-rank-tracking.md](seo-rank-tracking.md) | Rank Tracking: trackers, how a Google position is found, re-checks, schedules and prices. |
| [seo-site-audit.md](seo-site-audit.md) | Site Audit: the crawler, technical SEO issues, AI readiness checks and the score. |
| [seo-performance.md](seo-performance.md) | Performance: Lighthouse scores, Core Web Vitals and IndexNow submissions. |
| [seo-local.md](seo-local.md) | Local SEO: Google Maps results, Business Profiles, reviews and the local rank grid. |
| [seo-metrics.md](seo-metrics.md) | SEO vs GEO metrics and quadrants: organic position against AI mention rate per keyword. |
| [design-system.md](design-system.md) | The dashboard's design system: theming, colours, typography, components, icons, charts and print. |
| [pending.md](pending.md) | Open work and decisions recorded for later. |

## Screenshots

Dashboard screenshots in light theme (3720×1672):

- [Dashboard](dashboard.png): the overview page with headline figures and charts.
- [Visibility](visibility.png): one keyword group's written insights, headline KPIs and KPI table.
- [Brand Mentions](brandmentions.png): the brands the AI answers name for one keyword, ranked, with first-party, competitor or other type, engines, mentions and score.
- [Citations](citations.png): the URLs AI engines cited, with domain, keyword count and citation count.
- [SEO analysis of a cited page](seoanalysis.png): a cited page's relevance score for its keyword, strengths and weaknesses.
- [Prompt Insights](promptinsights.png): the win rate and the queries where the brand is winning, losing or missing while competitors appear.
- [Citation Gaps](citationgapanalysis.png): sources that cite competitors but not the tracked brand.
- [Action Center](actioncenter.png): recommendations and their status.
- [Keyword Research](keywordresearch.png): research history with one run's keyword results expanded.
- [SEO](seo.png): the SEO overview with Domain Overview, Backlinks, Rank Tracking, Site Audit, Performance and Local SEO.
- [Content Studio](contentstudio.png): content ideas built from visibility gaps, with the engines that miss the brand for each keyword.
- [Generated content](generatedcontent.png): a generated article with its meta description, preview and DOCX export.
- [Reports](reports.png): the Executive Summary report.
- [Run Analysis](analysis.png): choosing markets, a keyword group or single keywords before starting an analysis run.
- [Settings](settings.png): keyword groups and their keywords.
- [Brand leaderboard](brandleaderboard.png): every brand the AI answers name, ranked by visibility score, with mention rate, share of voice, positions, engines and first-party or competitor type.
- [KPIs per AI engine](aiengines.png): mention rate, visibility score and citation rate per engine, and every KPI per engine.
- [Brand detail](branddetails.png): one brand's rank, mentions and score, with each engine's rank, sentiment and context.
- [Cited page screenshot](citationscreenshot.png): the page a citation points to, as captured by the AgentCore Browser crawl.
- [Competitor Benchmark report](report-benchmark.png): share of voice, rank among all brands named and the share-of-voice donut.
- [AI Engines report](report-engines.png): engine coverage, engines naming the brand and KPIs per engine.
- [Sentiment report](report-sentiment.png): net sentiment, positive, negative and neutral or mixed mentions, and the trend.
- [Content Action Plan report](report-contentactionplan.png): citation gaps paired with ready briefs and the top citation targets.
- [Custom report](report-custom.png): a report built from sections of the others.
- [Research agent](researchagent.png): the Keyword Research agent form with an industry template, market, language and expansion dimensions.
- [Brand tracking](brandtracking.png): industry, first-party brands, owned domains and competitor brands.
- [Markets](markets.png): countries and languages keywords are asked from, with local competitors and brand names.
- [AI assistants](aiassistants.png): Settings › AI assistants, with the MCP server URL and per-client setup steps.
- [SEO Performance](seoperformance.png): Lighthouse scores and Core Web Vitals for one of the brand's pages.

[social-preview.png](social-preview.png) (1280×640) is the GitHub social preview card: the project name and tagline over the Dashboard page.
