# Documentation: Citation Analysis System (GEO / AI search visibility on AWS)

Reference docs for the Citation Analysis System, an AWS sample that measures how AI engines (ChatGPT/OpenAI,
Perplexity, Google Gemini, Claude and Google AI Overviews) mention and cite a brand, built on Amazon Bedrock and
AWS CDK. Start with the [project README](../README.md) for what it does, deployment and cost.

## Docs

| Doc | What it covers |
|---|---|
| [kpi-definitions.md](kpi-definitions.md) | Every visibility KPI (mention rate, share of voice, average position, visibility score, citation rate, net sentiment, coverage), with formulas, edge cases, citation versions and alerts |
| [geo-corrections.md](geo-corrections.md) | Why citation numbers changed in 2.43: only cited sources count, empty replies are no answers, branded queries, like-for-like alerts |
| [mcp.md](mcp.md) | The MCP server: connecting Claude, Claude Code, ChatGPT, Kiro and Amazon Quick, OAuth scopes, tools, paid-call confirmation and per-user limits |
| [design-system.md](design-system.md) | The dashboard's visual rules: palette, dark and light theme, typography, buttons, icons, tables, charts, print and the `components/ui/` primitives |
| [seo.md](seo.md) | The optional SEO features (DataForSEO, `CitationAnalysisSeoStack`): setup, costs, who can do what |
| [seo-metrics.md](seo-metrics.md) | SEO vs GEO definitions: organic position, AI Overview presence and the SEO vs GEO quadrant |
| [seo-domain.md](seo-domain.md) | SEO › Domain Overview: what a domain ranks for on Google, estimated traffic snapshots and SEO recommendations |
| [seo-backlinks.md](seo-backlinks.md) | SEO › Backlinks: who links to a site, recent changes, most-linked pages and your domains against competitors |
| [seo-rank-tracking.md](seo-rank-tracking.md) | SEO › Rank Tracking: where a domain ranks in Google's organic results for a list of keywords, desktop and mobile |
| [seo-site-audit.md](seo-site-audit.md) | SEO › Site Audit: crawls your own site for technical SEO issues and AI readiness |
| [seo-performance.md](seo-performance.md) | SEO › Performance: Lighthouse, Core Web Vitals and IndexNow for your own pages |
| [seo-local.md](seo-local.md) | SEO › Local SEO: how a business appears on Google Maps and in its Google Business Profile |

`architecture.drawio` is the source of the architecture diagram.

## Screenshots (light theme, 3720×1672)

| File | Shows |
|---|---|
| [dashboard.png](dashboard.png) | Dashboard: headline counts, citations by provider and by brand, and the SEO vs GEO and Rankings cards |
| [visibility.png](visibility.png) | Visibility: insights, the tracked brand's headline KPIs and the KPI table for a keyword group |
| [brandleaderboard.png](brandleaderboard.png) | Visibility: the brand leaderboard of first-party and competitor brands |
| [aiengines.png](aiengines.png) | Visibility: the KPIs per AI engine |
| [brandmentions.png](brandmentions.png) | Brand Mentions: the Brands mentioned table for one keyword |
| [branddetails.png](branddetails.png) | Brand Mentions: the detail dialog of one brand |
| [citations.png](citations.png) | Citations: the URLs AI engines cite, ranked by citations, with their domain and keyword count |
| [seoanalysis.png](seoanalysis.png) | Citations: the SEO Analysis tab of a cited page's detail dialog |
| [citationscreenshot.png](citationscreenshot.png) | Citations: the Screenshot tab of a cited page, captured by the AgentCore Browser crawler |
| [promptinsights.png](promptinsights.png) | Prompt Insights: win rate and the winning, losing and opportunity queries for the tracked brand |
| [citationgapanalysis.png](citationgapanalysis.png) | Citation Gaps: sources that cite competitors but not the tracked brand |
| [actioncenter.png](actioncenter.png) | Action Center: prioritised recommendations from the KPIs and citation gaps |
| [keywordresearch.png](keywordresearch.png) | Keyword Research: a finished research job opened from the History tab |
| [researchagent.png](researchagent.png) | Keyword Research: the Research Agent tab |
| [seo.png](seo.png) | SEO: the overview page |
| [seoperformance.png](seoperformance.png) | SEO › Performance: a Lighthouse result |
| [contentstudio.png](contentstudio.png) | Content Studio: the Content Ideas tab with prioritised ideas from visibility gaps |
| [generatedcontent.png](generatedcontent.png) | Content Studio: a generated article in the Generated Content tab |
| [reports.png](reports.png) | Reports: the Executive Summary report |
| [report-benchmark.png](report-benchmark.png) | Reports: the Competitor Benchmark report |
| [report-engines.png](report-engines.png) | Reports: the AI Engines report |
| [report-sentiment.png](report-sentiment.png) | Reports: the Sentiment report |
| [report-contentactionplan.png](report-contentactionplan.png) | Reports: the Content Action Plan report |
| [report-custom.png](report-custom.png) | Reports: a saved custom report |
| [analysis.png](analysis.png) | Run Analysis: the "Start a run" card |
| [settings.png](settings.png) | Settings › Keywords: keyword groups and the keyword table |
| [brandtracking.png](brandtracking.png) | Settings › Brand tracking: your brand's names and websites, and the competitors |
| [markets.png](markets.png) | Settings › Markets: country and language pairs with optional city and local competitors |
| [aiassistants.png](aiassistants.png) | Settings › AI assistants: the MCP server URL and per-client setup steps |
| [social-preview.png](social-preview.png) | GitHub social preview card (1280×640): the project name and tagline above the Dashboard page. Upload it under Settings › General › Social preview. |
