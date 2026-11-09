# Citation Analysis System: AI search visibility and generative engine optimization (GEO) on Amazon Bedrock

An open source sample for generative engine optimization (GEO), also called answer engine optimization (AEO): it measures your brand's AI search visibility by asking OpenAI (the GPT models behind ChatGPT), Perplexity, Google Gemini, Anthropic Claude and, optionally, Google AI Overviews your keywords and recording which brands each answer mentions and which sources it cites. It runs on AWS with Amazon Bedrock and turns repeated, scheduled runs into citation analysis, brand mention and share-of-voice KPIs, competitor benchmarks and content gaps in a React dashboard.

> **Important:** This is sample code for demonstration and educational purposes. It is not intended for production use without additional security review and testing. You should work with your security and compliance teams to meet your organizational requirements before deploying to production environments.

The system sends your keywords to each engine with web search enabled, stores every answer and its citations, extracts the brands named with Amazon Bedrock and crawls the cited pages with Amazon Bedrock AgentCore. An optional SEO stack adds Google organic data from DataForSEO, so you can compare search rankings with AI answers. It is deployed with AWS CDK (TypeScript); the backend is Python 3.12 Lambda functions orchestrated by AWS Step Functions.

**Contents:** [Features](#features) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Project structure](#project-structure) · [Prerequisites](#prerequisites) · [Deployment](#deployment) · [Getting started](#getting-started) · [Configuration](#configuration) · [Security](#security) · [Cost](#cost) · [Development](#development) · [FAQ](#faq) · [License](#license)

## Features

The dashboard sidebar has these sections:

| Section | Pages |
|---|---|
| Insights | **Dashboard** (totals, citations by provider, brand mentions, KPI alerts; with the SEO stack, *SEO vs GEO* and *Rankings* cards), **Visibility** (the KPIs for one keyword, a keyword group or all keywords, with 7/30/90-day KPI history, brand leaderboard, per-engine KPIs, cited domains and the scope's three most pressing insights; persona filter), **Brand Mentions** (every brand named, with sentiment, rank and a per-brand ranking analysis), **Citations** (cited URLs by frequency, with a per-keyword and per-provider breakdown; YouTube videos are counted once per video whatever link was cited, tagged *Video* and filterable, and their title, channel and thumbnail come from YouTube oEmbed instead of a browser crawl), **Prompt Insights** (which queries and personas rank you in the top 3), **Citation Gaps** (sources that cite competitors but not you), **Action Center** (prioritised recommendations with a status you can track); the last three take the same keyword, group or all-keywords scope as Visibility |
| Research | **Keyword Research**: Related Keywords, Keyword Explorer (with the SEO stack: search volume, difficulty, CPC and intent from DataForSEO), Competitor Analysis (analyse a competitor website), History and Research Agent (a Bedrock research agent that plans web-search queries over up to three rounds, with saved prompt templates); **SEO** (optional `CitationAnalysisSeoStack`, Google data from DataForSEO): an overview, Domain Overview, Backlinks, Rank Tracking, Site Audit, Performance (Lighthouse, IndexNow) and Local SEO; see [docs/seo.md](docs/seo.md) |
| Content | **Content Studio**: content ideas and briefs from citation gaps and ranking analyses, single or per keyword group, in any output language, exportable as DOCX |
| Reporting | **Reports**: ten print-ready reports (below), plus custom reports you build from their sections |
| Data | **Recent Searches** (analysis history with full answers), **Raw Responses** (raw JSON answers and crawl screenshots from S3) |
| Operations | **Run Analysis**, **Schedule** (EventBridge Scheduler runs) |
| Configuration | **Settings**: Keywords (with keyword groups), Markets, Brand tracking, Personas, AI providers, Bedrock models (admins only), Alerts, Users (admins only), AI assistants (MCP server setup) |

Most views export to Excel, the header's PDF button prints the current view (print mode, `?print=1`), and the UI has light, dark and system themes. Print mode and printed pages always use the light theme, whatever theme is selected. A first-run guide walks through setup, and a banner flags a provider that is failing.

Screenshots of each page are in [Screenshots](#screenshots).

### Reports

Listed on **Reporting > Reports** (`web/src/components/Reports/ReportsLandingView.tsx`), routed by `ReportsRouter.tsx`:

| Report | Route | For |
|---|---|---|
| Executive Summary | `/reports/executive-summary` | CMO, VP Marketing |
| Brand Visibility Report | `/reports/visibility` (`/reports/visibility/:keyword`) | Marketing lead |
| Competitor Benchmark | `/reports/benchmark` | Brand manager, competitive intelligence |
| AI Engines | `/reports/engines` | AI search specialist |
| Sources | `/reports/sources` | SEO and digital PR |
| Sentiment | `/reports/sentiment` | Brand / communications lead |
| SEO vs GEO | `/reports/seo-geo` (needs the SEO stack) | SEO and AI search lead |
| Competitor Gap Report | `/reports/competitor` (`/reports/competitor/:competitor`) | Content / PR strategist |
| Content Action Plan | `/reports/content-action-plan` | Content strategist |
| Keyword Deep Dive | `/reports/keyword` (`/reports/keyword/:keyword`) | SEO / AI search lead |

**Custom reports** (`/reports/custom/new`, `/reports/custom/:id`, `/reports/custom/:id/edit`; `web/src/components/Reports/customReport/`): any signed-in user can name a report, pick blocks from a list sorted into categories (one per report above, an *Insights* category, plus their own headings, Markdown text, https images and YouTube or Vimeo videos), drag or add them into one ordered list and save it. Every user sees every saved report (at most 50). A saved report opens on every keyword and its saved period (30, 90 or 180 days); the reader can narrow it to a keyword group or one keyword and change the period in the URL, like the scope reports. Each data source is fetched once however many blocks read it. A block that needs a particular scope (a single keyword for the Keyword Deep Dive blocks, a keyword group for the group KPI and Run stability blocks) says so instead of showing the wrong data. The catalogue and the stored block types live in `customReport/blockCatalog.ts`.

**Insights** (`GET /api/reports/insights`, rules in `lambda/shared/insights_engine.py` and `insights_citations.py`) are derived from the KPI engine's figures for a scope by fixed rules with named thresholds: the *play* each AI engine calls for (get cited, get ranked first, both, or defend), the brand's best position per keyword and engine (a keyword every engine places outside the top 3 is a *prompt gap*), who the engines cite (your domains, each competitor's domains from Brand tracking, third parties) and which of your pages (documents told apart from web pages), competitors the answers word mixed or negative (at least 30% of 5 or more mentions, with the reasons given), the first-party brands measured against the best of them and, for a keyword group, how far each keyword's position swung across the runs of the window. Each insight carries a severity and the numbers it rests on. The Visibility tab reads out the top three; the custom-report *Insights* blocks show the facts behind them. After every run, for each keyword group the run fully covers, a **GenerateInsights** step asks Bedrock (the `ANALYSIS` role) for up to three written insights and six recommendations from those computed insights and KPIs only, in the language of the group's keywords; a validator drops any item that cites an unknown insight or a number not in its evidence, and the result is stored in `CitationAnalysis-ReportInsights`, so reading a report never calls Bedrock. The *Written insights* block shows it; admins can regenerate it (`POST /api/reports/insights/regenerate`).

### KPIs

The Visibility tab, the per-group report, the Executive Summary, Brand Visibility, Competitor Benchmark, AI Engines, Sources, Sentiment and Keyword Deep Dive reports, their exports and the KPI alerts use one set of KPIs, counted per AI-engine answer and pooled across a scope: answers, mentions, mention rate, share of voice, average position, top-1 and top-3 share, visibility score (position-weighted, 0–100), citations, citation rate, citation share, net sentiment, engine coverage and keyword coverage. Definitions, formulas and edge cases are in [docs/kpi-definitions.md](docs/kpi-definitions.md); Google AI Overviews counts as one more engine when the SEO stack provides it. Since 2.43 only the sources an answer cites count as citations, not the pages the engine only read; [docs/geo-corrections.md](docs/geo-corrections.md) explains which figures moved. The Dashboard, Brand Mentions, Personas, Prompt Insights, Citation Gaps, Action Center and the Competitor Gap and Content Action Plan reports still compute their own figures.

## Screenshots

Pages of the dashboard, in the light theme.

![Citation Analysis dashboard: total answers and citations, citations by AI provider chart, brand mentions donut, SEO vs GEO quadrant card, Google rankings card and KPI alerts](docs/dashboard.png)

![Visibility tab for the LATAM Airlines keyword group: AI insights, headline KPIs (mention rate 100%, share of voice, visibility score, citation rate) and a KPI table with change and trend](docs/visibility.png)

![Brand Mentions leaderboard for one keyword: brands by rank with the AI providers that named them, mention count, best rank, score and first-party or competitor tag](docs/brandmentions.png)

![Citation gap analysis: sources that cite competitors but not your brand, with a priority for each](docs/citationgapanalysis.png)

<details>
<summary>More screenshots</summary>

<table>
  <tr>
    <td><img src="docs/citations.png" alt="Citations page: every URL cited by AI answers with citation totals, provider and keyword filters and Excel export" width="100%"><br>Citations</td>
    <td><img src="docs/seoanalysis.png" alt="Cited page detail: SEO analysis score of 8 out of 10 with listed strengths and weaknesses of the page" width="100%"><br>Cited page SEO analysis</td>
  </tr>
  <tr>
    <td><img src="docs/promptinsights.png" alt="Prompt Insights: top-3 win rate of 37.8% with winning, losing and opportunity queries" width="100%"><br>Prompt Insights</td>
    <td><img src="docs/actioncenter.png" alt="Action Center: prioritised recommendations with a trackable status" width="100%"><br>Action Center</td>
  </tr>
  <tr>
    <td><img src="docs/keywordresearch.png" alt="Keyword research history with an expanded keyword expansion result showing search intent, competition and relevance per keyword" width="100%"><br>Keyword Research</td>
    <td><img src="docs/seo.png" alt="SEO section with DataForSEO data: domain overview, backlinks, rank tracking, site audit, performance and local SEO" width="100%"><br>SEO</td>
  </tr>
  <tr>
    <td><img src="docs/contentstudio.png" alt="Content Studio: content ideas generated from citation gaps" width="100%"><br>Content Studio</td>
    <td><img src="docs/generatedcontent.png" alt="Generated content brief and article preview in Content Studio with DOCX export" width="100%"><br>Generated content</td>
  </tr>
  <tr>
    <td><img src="docs/reports.png" alt="Executive Summary report: headline AI visibility KPIs and a KPI table" width="100%"><br>Executive Summary report</td>
    <td><img src="docs/analysis.png" alt="Run Analysis page: choose markets, keyword groups and keywords to send to the AI engines" width="100%"><br>Run Analysis</td>
  </tr>
  <tr>
    <td><img src="docs/settings.png" alt="Settings: keyword groups and keyword management" width="100%"><br>Settings: keywords</td>
    <td><img src="docs/brandtracking.png" alt="Brand tracking settings: industry, first-party brands, owned domains and competitor brands with brand expansion" width="100%"><br>Settings: brand tracking</td>
  </tr>
  <tr>
    <td><img src="docs/brandleaderboard.png" alt="Visibility brand leaderboard: visibility score, mention rate, share of voice, average and best position, engines and first-party or competitor type per brand" width="100%"><br>Brand leaderboard</td>
    <td><img src="docs/aiengines.png" alt="Visibility per AI engine: mention rate, visibility score and citation rate chart with every KPI per engine including net sentiment" width="100%"><br>KPIs per AI engine</td>
  </tr>
  <tr>
    <td><img src="docs/branddetails.png" alt="Brand detail: overall rank, providers, mentions and score, with each engine's rank, sentiment and the context the brand is named in" width="100%"><br>Brand detail per engine</td>
    <td><img src="docs/citationscreenshot.png" alt="Cited page detail: screenshot of the cited web page captured by the Amazon Bedrock AgentCore Browser crawl" width="100%"><br>Cited page screenshot</td>
  </tr>
  <tr>
    <td><img src="docs/report-benchmark.png" alt="Competitor Benchmark report: share of voice, rank among all brands named, leading brand and a share-of-voice donut" width="100%"><br>Competitor Benchmark report</td>
    <td><img src="docs/report-engines.png" alt="AI Engines report: engine coverage, engines naming the brand, strongest engine and KPIs per engine" width="100%"><br>AI Engines report</td>
  </tr>
  <tr>
    <td><img src="docs/report-sentiment.png" alt="Sentiment report: net sentiment, positive, negative and neutral or mixed mentions, and net sentiment over time" width="100%"><br>Sentiment report</td>
    <td><img src="docs/report-contentactionplan.png" alt="Content Action Plan report: citation gaps, high-priority targets, briefs ready and the top citation targets with competitors named" width="100%"><br>Content Action Plan report</td>
  </tr>
  <tr>
    <td><img src="docs/report-custom.png" alt="Custom report built from report sections: KPIs over time and share of voice over 90 days" width="100%"><br>Custom report</td>
    <td><img src="docs/researchagent.png" alt="Keyword Research agent: industry template, business, market, language and the dimensions the agent expands by" width="100%"><br>Research agent</td>
  </tr>
  <tr>
    <td><img src="docs/markets.png" alt="Markets settings: countries and languages the keywords are asked from, with local competitors and local brand names" width="100%"><br>Settings: markets</td>
    <td><img src="docs/aiassistants.png" alt="AI assistants settings: MCP server URL and setup steps to connect Claude, ChatGPT, Kiro or Amazon Quick to the dashboard data" width="100%"><br>Settings: AI assistants (MCP)</td>
  </tr>
  <tr>
    <td><img src="docs/seoperformance.png" alt="SEO Performance: Lighthouse performance, accessibility, best practices and SEO scores with Core Web Vitals" width="100%"><br>SEO Performance (Lighthouse)</td>
    <td></td>
  </tr>
</table>

</details>

## Architecture

![Architecture diagram](architecture-diagram.png)

### Workflows (Step Functions)

- **`CitationAnalysis-Workflow`** (one execution per analysis run, 7-day timeout): ParseKeywords (writes the run's keyword list to `runs/<execution>/keywords.json` in the keywords bucket) → ProcessKeywords Distributed Map (one child execution per keyword: SearchAllProviders, a Parallel state calling every provider at once through its own `CitationAnalysis-Search-<provider>` Lambda → MergeProviderResults → DeduplicateCitations → CrawlCitations Map → SummarizeKeywordResult; results written to S3) → GenerateSummary (reads the results from S3, stores the full report under `execution-summaries/`) → KpiAlerts → GenerateInsights (a Map with one ReportInsights invocation per fully covered keyword group and market, four at a time, skipped when no group is complete) → BuildCitationRollup (per-scope citation totals and pages under `citation-rollups/` in the keywords bucket, which `GET /api/citations` serves without scanning the Citations table). A failed alert, insight or rollup step keeps the report. The run's state and history stay the same size however many keywords it covers, and there is no per-run keyword cap. Keywords run 20 at a time by default (`-c processKeywordsConcurrency=N`) and citations are crawled 10 at a time per keyword (`-c crawlConcurrency=N`). Each provider has a cap on calls in flight across the whole run (`-c providerConcurrency`); a keyword whose provider is at its cap waits for a free slot, and every client waits out rate limits (`Retry-After`, `x-ratelimit-reset`) instead of failing, so no provider call is lost to throttling. SerpAPI searches are submitted asynchronously and read back from its Search Archive, so a slow search is waited for rather than re-sent. A failed crawl or alert evaluation does not fail the run; up to 10% of keywords may fail (reported as `completed_with_errors`) before the run stops. `runs/` objects expire after 30 days.
- **`CitationAnalysis-KeywordResearch`** (one execution per research job, 60-minute timeout; the API marks a job failed only after 65 minutes): PlanResearch → ExecuteResearchSteps Map (up to 10 steps in parallel) → EvaluateResearch → continue? → PlanResearch … | FinalizeResearch. Each step checkpoints its result into the job row, so a failed provider keeps the other results and can be retried on its own.

### Lambda functions

All the sample's own functions run Python 3.12. CPU-bound functions are sized for CPU, which Lambda allocates in proportion to memory: 1,769 MB (one vCPU) for API-StatsInsights, API-CitationsContent, API-GetBrandMentions, KpiAlerts and ReportInsights; 1,024 MB for API-KeywordMgmt, API-ConfigMgmt, API-ExecutionMgmt and ParseKeywords; 3,008 MB and 900 s for GenerateSummary, which also builds the citation rollup. API functions stop at API Gateway's 29 s; inside it, every request carries a time budget (`lambda/shared/request_deadline.py`) and answers partial data with a truncation flag instead of a 504.

| Function | Code | Role |
|---|---|---|
| ParseKeywords, Search-`<provider>` (one per provider), Deduplication, Crawler, GenerateSummary, KpiAlerts | `lambda/parse-keywords`, `search`, `deduplication`, `crawler`, `generate-summary`, `kpi-alerts` | Analysis workflow steps |
| ResearchWorker | `lambda/research-worker` | Keyword research steps |
| API-StatsInsights, API-CitationsContent, API-KeywordMgmt, API-ConfigMgmt, API-ExecutionMgmt, API-GetBrandMentions, API-ManageBrandConfig, API-GetPersonaRankings, API-SelfReflection, API-ContentStudio, API-ManageUsers, API-Health | `lambda/api/*.py` | REST API handlers; the consolidated functions bundle several handler files each |
| ContentStudioWorker | `lambda/api/content-studio.py` | Content generation, fed by a DynamoDB stream and a 5-minute reconcile rule |
| ReportInsights | `lambda/report-insights/` | GenerateInsights workflow step and on-demand regenerate: one Bedrock narrative per fully covered keyword group |
| Mcp (stack `CitationAnalysisMcpStack`) | `lambda/mcp/` | MCP server: JSON-RPC over Streamable HTTP, tool catalogue, replays tool calls against the API handler Lambdas |
| SeoRouter, SeoJobs, SeoCallbacks, Search-google_ai_overview (stack `CitationAnalysisSeoStack`) | `lambda/seo/`, `seo-jobs/`, `seo-callbacks/`, `search/` | SEO API, long-running SEO jobs, DataForSEO callbacks, the Google AI Overviews engine |

Two layers: the **shared layer** (`lambda/layer/`: `lambda/shared` modules plus `requests`, `bs4` and `tzdata`) used by every function except the crawler, and the **crawler layer** (`lambda/crawler-layer/`: Playwright, Bedrock AgentCore and a copy of the shared modules). Synth fails if either layer is not built or its copy of `lambda/shared` is stale. The crawler uses a pre-created AgentCore browser with Web Bot Auth and reuses a crawl for 30 days.

### Data

All tables are DynamoDB on-demand with AWS-managed encryption, point-in-time recovery and `RETAIN`:

| Table (`CitationAnalysis-…`) | Key | Holds |
|---|---|---|
| SearchResults | keyword / timestamp_provider | Every provider answer, with extracted brands and its `market_id` |
| Citations | keyword / normalized_url | Every deduplicated citation, with `content_type` (`video` or `page`) |
| CrawledContent | normalized_url / crawled_at | Crawled page content, summaries and SEO data |
| Keywords | id | Keywords; `group_ids` holds group membership, `market_id` the market, `concept_id` the keyword a translation localizes |
| KeywordGroups | id | Keyword groups |
| KeywordResearch | id | Research jobs and their steps (TTL) |
| ResearchTemplates | id | Saved research agent prompts |
| BrandConfig | config_id | Industry, first-party and competitor brands, owned domains (`default`); the market list (`markets`) |
| ProviderConfig | provider_id | Provider enablement, model override, health |
| QueryPrompts | id | Personas |
| ContentStudio, ContentBriefBatches, ContentBriefTemplates | id / batch_id / id | Generated content, batch manifests, saved prompt templates |
| CustomReports | id | Saved custom reports (title, ordered blocks, period; at most 50) |
| SelfReflection | keyword_brand / persona_timestamp | Ranking analysis cache (24 h TTL) |
| RecommendationStatus | recommendation_id | Action Center item status (TTL) |
| ReportInsights | scope_key / run_timestamp | Written report insights per keyword group and market (TTL) |
| KpiSnapshots, KpiAlerts, AlertSettings, ContentChanges | group_id / snapshot_at, id, config_id, group_id / changed_at | KPI alert baselines, alerts, thresholds, content-change markers |

The SEO stack (`CitationAnalysisSeoStack`) adds its own tables, with the same settings. Measurements are kept and
never expire (Silver); only caches, receipts, locks and crawl bookkeeping carry a TTL:

| Table (`CitationAnalysis-…`) | Key | Holds |
|---|---|---|
| SeoKeywordMetrics | keyword_id / market_id | The latest search volume, CPC, difficulty and intent per keyword and market: a cache of DataForSEO's values, replaced whole on each refresh, not a history |
| SeoCache | cache_key | Paid-answer cache (TTL per answer; payloads over 350 KB in the `seo` bucket), local SEO jobs, Lighthouse runs and IndexNow history (kept), DataForSEO callback gates (`callback#<id>`, 2-day TTL) |
| SeoRankTracking | pk / sk, GSI1 | Trackers (`TRACKER#<id>` / `META`), their extra keywords (`KW#`), runs (`RUN#`), per-keyword state (`STATE#`) and each check's results (`RUN#<run>` / `PAIR#<keyword>#<device>`, history through GSI1) (Silver, kept); the run lock (`ACTIVE_RUN`, TTL) |
| SeoDomainSnapshots | `<domain>#<market_id>` / snapshot_at | Each traffic snapshot's overview figures (Silver, kept); its ranked keywords are in the `seo` bucket |
| SeoBacklinkSnapshots | domain / snapshot_at | Each backlink snapshot's overview metrics (Silver, kept) |
| SeoAudits | pk / sk, GSI1 | Site audits, their pages, issues and link summary (kept); the crawl's frontier URLs (90-day TTL) |

The `seo` bucket (`citation-analysis-seo-<account>`) holds `seo/cache/<key>.json` (oversized cache payloads),
`seo/lighthouse/<run>-<index>.json` (full Lighthouse reports), `seo/domain-snapshots/<domain>/<market>/<snapshot_at>.json`
(a snapshot's ranked keywords, written once) and `seo/site-audit/<id>/robots.txt`.

S3 buckets (`citation-analysis-<name>-<account>`): `keywords` (keyword files, run summaries, `runs/` scratch, `citation-rollups/`, and `api-responses/` for API answers too large for Lambda's 6 MiB response limit, expired after 1 day), `raw-responses`, `screenshots` (moved to Infrequent Access after 90 days), `web` (the dashboard) and `access-logs` (expire after 90 days). The SEO stack adds `seo` (its oversized cache payloads, Lighthouse reports, domain-snapshot keywords and robots.txt copies), so `raw-responses` holds only the providers' answers. KPI alert emails go through the SNS topic `CitationAnalysis-KpiAlerts`.

### API and hosting

A REST API (`CitationAnalysis-API`, stage `prod`, all routes under `/api`) with Lambda proxy integrations and a Cognito user pool authorizer on every route except `GET /api/health`. Saved custom reports are `GET`/`POST /api/custom-reports` and `PUT`/`DELETE /api/custom-reports/{id}` on API-ConfigMgmt, open to any signed-in user. The dashboard is a static Vite build in a private S3 bucket served by CloudFront through origin access control; its content security policy allows embedded players from `www.youtube-nocookie.com` and `player.vimeo.com` only (custom report video blocks).

### SEO stack (optional)

`CitationAnalysisSeoStack` (`lib/seo-stack.ts`) holds the SEO features in their own stack and API (`CitationAnalysis-SeoApi`, Cognito-protected, routes under `/api/seo/`), because the main stack is at CloudFormation's 500-resource limit. It reads Google data from [DataForSEO](https://dataforseo.com/), a pay-per-use API whose login is stored as `citation-analysis/dataforseo-key`. Deployed with the main stack's `-c seoEngine=true`, it also adds **Google AI Overviews** as an answer engine: one Google results page per keyword per run, whose AI Overview is the answer and whose references are its citations. Setup, permissions, daily limits and DataForSEO list prices are in [docs/seo.md](docs/seo.md); the SEO vs GEO metrics are in [docs/seo-metrics.md](docs/seo-metrics.md).

### MCP server (preview)

A second stack, `CitationAnalysisMcpStack`, holds an MCP server for AI assistants (Kiro, Claude.ai and Claude Code, ChatGPT, Amazon Quick): a Streamable HTTP endpoint, `POST /mcp` on its own REST API (`CitationAnalysis-McpApi`) behind its own CloudFront distribution, which gives the server a host root so clients find the OAuth discovery documents where RFC 9728 and RFC 8414 put them (`https://<dist>.cloudfront.net/mcp`, `https://<dist>.cloudfront.net/.well-known/...`), and one Lambda (`CitationAnalysis-Mcp`, reserved concurrency 10) that replays every tool call against the existing API handler Lambdas as the signed-in user, so permissions and figures are the dashboard's. `tools/list` advertises eight direct tools (keyword groups, keywords, brand configuration, visibility, reports, citations, recommendations, keyword management) plus `search_tools` → `describe_tool` → `call_tool` over a catalogue of 44 more (`lambda/mcp/catalogue.py`; 18 of them are SEO operations that need the SEO stack), and two prompts (`geo_audit`, `setup_brand_tracking`); `-c mcpPinnedTools` promotes catalogue entries to the direct list. Operations that spend money take two steps: `estimate_run` / `estimate_research` / `estimate_content_brief` return a call count and a single-use confirmation token (5 minutes, bound to the caller and the exact request), which `start_run` (admin only, as on the dashboard) / `start_research` / `generate_content_brief` must present; the DataForSEO operations work the same way (`estimate_seo_*` before `run_seo_*` and `start_seo_job`). Per-caller limits default to 1 run in flight, 5 runs, 20 research or content jobs and 50 DataForSEO lookups or SEO jobs per UTC day, and 50 keywords per run (`-c mcpLimits='{"runsPerDay":10}'`); tokens, counters and an audit record of every write and spend call live in the on-demand `CitationAnalysis-McpState` table. User management, provider keys, brand-configuration and schedule writes and deletes are not exposed. Clients sign in with OAuth 2.1 and PKCE through a Cognito Managed Login domain (`citation-analysis-<account>`) and a public `mcp` app client (1-hour access tokens, 90-day refresh tokens). The protected-resource metadata (at `/.well-known/oauth-protected-resource/mcp`) names the distribution's base URL as the authorization server, and the API serves its metadata at `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`, pointing at Cognito's endpoints and advertising PKCE S256 (Cognito's own discovery document omits `code_challenge_methods_supported`, which makes Claude and ChatGPT refuse to connect). The Cognito resource server is identified by the MCP endpoint URL, so the scopes are `<McpUrl>/read`, `<McpUrl>/write` and `<McpUrl>/run` and a client that sends the endpoint as the RFC 8707 `resource` parameter gets an access token whose `aud` is the endpoint. Behind the Cognito authorizer the Lambda checks the token's issuer, client, use and audience; an anonymous call gets `401` with a `WWW-Authenticate` pointer to the protected-resource metadata (RFC 9728). Register each client's callback URL with `-c mcpRedirectUris`; the stack outputs `McpUrl`, `McpClientId`, `McpAuthorizeUrl`, `McpTokenUrl` and `McpResourceMetadataUrl` are what a client's connection form asks for. Per-client steps are in [docs/mcp.md](docs/mcp.md) and, for signed-in users, on the dashboard's Settings › AI assistants section (`/settings/ai-assistants`), which takes the URL and client id from the stack outputs at build time. The stack lives in `lib/mcp-stack.ts` and can be destroyed on its own. Dynamic client registration is not offered; clients use the pre-registered `McpClientId`.

Kiro CLI connects with a server entry like this (in `.kiro/settings/mcp.json` or an agent's `mcpServers`), after `http://localhost:5173/oauth/callback` (the default `mcpRedirectUris` value) is registered; Kiro opens the Managed Login page in the browser and stores the token:

```json
{
  "mcpServers": {
    "citation-analysis": {
      "url": "<McpUrl>",
      "oauth": {
        "clientId": "<McpClientId>",
        "redirectUri": "http://localhost:5173/oauth/callback"
      }
    }
  }
}
```

## Project structure

```
├── bin/                     # CDK app entry point (CitationAnalysisStack, CitationAnalysisMcpStack, CitationAnalysisSeoStack, CitationAnalysisWebSearchStack)
├── lib/
│   ├── citation-analysis-stack.ts
│   ├── mcp-stack.ts         # MCP server stack
│   ├── seo-stack.ts         # SEO stack (DataForSEO, Google AI Overviews engine)
│   ├── web-search-stack.ts  # Amazon Bedrock Web Search gateway stack
│   └── constructs/          # auth.ts (Cognito), tables.ts, buckets.ts, api-functions.ts, provider-search.ts,
│                            # bedrock-model-access.ts, custom-resource-provider.ts, logged-state-machine.ts,
│                            # python-layer.ts, python-bytecode.ts, mcp-server.ts, seo-*.ts, web-search.ts
├── lambda/
│   ├── api/                 # API handlers
│   ├── mcp/                 # MCP server: auth, protocol, catalogue, tool search, invoker, spend limits
│   ├── search/              # Provider queries, brand extraction, web-search providers
│   ├── deduplication/  crawler/  parse-keywords/  generate-summary/  kpi-alerts/  report-insights/
│   ├── research-worker/     # Keyword research state machine steps
│   ├── seo/  seo-jobs/  seo-callbacks/   # SEO stack router, long-running jobs, DataForSEO callbacks
│   ├── shared/              # Shared modules (KPI engine, clients, decorators, config)
│   ├── layer/  crawler-layer/   # Layer build scripts and requirements
│   ├── testing/             # Test support: module loader, DynamoDB stubs, events, env
│   ├── conftest.py
│   └── requirements-dev.txt # Python dev toolchain
├── web/src/
│   ├── api/  components/  constants/  exporters/  formatting/
│   ├── hooks/  infrastructure/  types/
│   └── test/                # Test support
├── docs/                    # kpi-definitions.md, geo-corrections.md, seo*.md, mcp.md, design-system.md, screenshots
├── test-fixtures/           # JSON fixtures shared by the Python and TypeScript tests
├── scripts/                 # Deploy, build and quality-gate scripts
└── cdk.json
```

## Prerequisites

- Node.js 24 (pinned in `.nvmrc`; the newest Lambda Node.js runtime, so don't go above it) and npm
- Python 3.12 and pip. The layer builds, `cdk synth` and `npm test` compile every shipped module to CPython 3.12 bytecode (Lambda's read-only `/var/task` and `/opt` would otherwise make each cold start recompile ~430 modules). They need a CPython 3.12 (`$PYTHON312`, `python3.12` on `PATH`, or `uv python install 3.12`) or a running Docker, and fail on any other Python version. See [Python bytecode in the assets](#python-bytecode-in-the-assets).
- AWS CLI with credentials and a default region (`aws configure`, or `AWS_REGION`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- An API key for at least one of OpenAI, Perplexity, Google Gemini or Anthropic. Paid keys are needed: free tiers hit rate limits at analysis volume; $5–10 of credit per provider covers regular use.
- Docker (optional): the layer builds use the Lambda Python image when Docker is running and fall back to cross-platform pip wheels otherwise; handler bundling uses the Lambda Python 3.12 image only when no local 3.12 is found.

### Python bytecode in the assets

- **Layers:** `build-layer.sh` installs with `pip --no-compile`, copies `shared/`, then runs `scripts/compile-python312.sh`: `unchecked-hash` bytecode for third-party packages, `checked-hash` for `shared/`. Hash-based `.pyc` carry no mtime, so two builds of the same input are byte-identical and the layer's asset hash does not change. Synth fails ("layer is stale") when a shared module has no `cpython-312.pyc` or its embedded source hash no longer matches the `.py`; rerun the layer build.
- **Handlers:** `apiLambdaCode` and the worker directories are bundled at synth (`lib/constructs/python-bytecode.ts`): only runtime files (no `test_*.py`, `conftest.py` or caches), compiled `checked-hash` by a local 3.12 or, without one, inside the Lambda 3.12 bundling image. The asset hash covers just the shipped files, so editing one API handler redeploys only the Lambdas that bundle it.
- Every other `.pyc` (pytest's 3.14 caches in the source trees and the built layer) stays out of the assets.

## Deployment

```bash
npm run deploy      # same as ./scripts/deploy.sh
```

`scripts/deploy.sh` checks the tools and AWS credentials, runs `npm install`, builds both Lambda layers and the dashboard, compiles the CDK app, offers to run `cdk bootstrap` if the account/region is not bootstrapped, deploys every stack (`cdk deploy --all`), rebuilds the dashboard with the new API and Cognito outputs, syncs it to the web bucket, invalidates CloudFront, verifies the core resources and prints the dashboard URL.

<details>
<summary>Manual deployment</summary>

The dashboard needs the API URL and Cognito IDs, which exist only after the first deploy, so the frontend is built twice:

```bash
npm install
bash lambda/layer/build-layer.sh           # rebuild after any change to lambda/shared
bash lambda/crawler-layer/build-layer.sh
(cd web && npm install && npm run build)   # synth requires web/dist
npm run build
cdk bootstrap                              # first time per account/region (also webSearchRegion if it differs)
cdk deploy --all                           # main, MCP, SEO and web search gateway stacks
./scripts/deploy-web.sh                    # rebuild with the stack outputs, upload, invalidate CloudFront
```

</details>

Other commands:

| Command | Does |
|---|---|
| `npm run deploy:cdk` | `cdk deploy --all --require-approval never` (layers and `web/dist` must already be built) |
| `npm run deploy:full` | `deploy:cdk`, then clear the CloudFront cache |
| `./scripts/deploy-web.sh` | Frontend only: build, sync to S3, invalidate CloudFront |
| `./scripts/build-web.sh` | Build the dashboard with `VITE_*` values from the stack outputs |
| `npm run clear-cache` | Invalidate the CloudFront distribution |
| `npm run synth` | `cdk synth` |
| `./scripts/quick-error-check.sh [minutes]` | Count provider retries and errors in the Search Lambda logs |
| `python3 scripts/delete-orphaned-log-groups.py [--delete]` | List (or delete) `/aws/lambda/*` log groups whose function no longer exists |

Get the dashboard URL later with:

```bash
aws cloudformation describe-stacks --stack-name CitationAnalysisStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' --output text
```

## Getting started

1. **Create the first user.** Self sign-up is off. Create an administrator with the CLI and add it to the `Admin` group; admins can then invite users from **Settings > Users**.

   ```bash
   aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
     --username user@example.com \
     --user-attributes Name=email,Value=user@example.com Name=email_verified,Value=true \
     --desired-delivery-mediums EMAIL
   aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> \
     --username user@example.com --group-name Admin
   ```

2. **Settings > AI providers.** Use **Add Key** and enable each provider you want. Keys are stored in Secrets Manager as `citation-analysis/<provider>-key`. Only enabled providers with a key are queried; a provider that fails three times in a row with an invalid key or no credit is disabled automatically and flagged in the dashboard banner.

   | Provider | Default model | Web search |
   |---|---|---|
   | OpenAI | `gpt-5-mini` | Responses API `web_search` tool, `tool_choice: required` (every answer searches) |
   | Perplexity | `perplexity/sonar` | Agent API (`POST /v1/agent`) with the `web_search` tool, asked to cite inline (`[1][2]`); the Sonar Chat Completions API it replaced was retired on 2026-09-27 |
   | Google Gemini | `gemini-3.6-flash` | Google Search grounding (`generateContent`) |
   | Anthropic Claude | `claude-sonnet-5-5` | `web_search_20260318` tool in direct mode (`allowed_callers: ["direct"]`, so its text cites its sources; it reads full search results, so more input tokens), no cap on searches, 4,096 output tokens |

   **Change model** on each card picks another model: OpenAI, Gemini and Claude list the models your key can use, Perplexity lists the Agent API models (`perplexity/sonar`, `openai/gpt-6-luna`, ...), and you can type any id. A Perplexity model saved before 2.37.0 (`sonar`, `sonar-pro`, `sonar-reasoning-pro`) is read as `perplexity/sonar`. Before a model is saved it must answer a real web-search request with your key, so a model that cannot search is refused instead of failing the next run.

   The same page lists optional web-search providers (Brave, Tavily, Exa, SerpAPI, Firecrawl, Amazon Bedrock Web Search). They add cited links to a run but write no answer, so they do not count towards the KPIs. Amazon Bedrock Web Search needs no key: see [Web search gateway](#web-search-gateway). A SerpAPI key also enables the research agent's Google signals step.

3. **Settings > Brand tracking.** Pick an industry preset or Custom, add your brand names and websites under **Your brand** and your competitors with their websites under **Competitors** (**Suggest sub-brands** and **Find competitors** suggest more with Bedrock), and add your **Owned Domains**. Each competitor can list its own domains too (**Find Competitors** suggests them, unticked until you confirm), so the insights tell competitor citations from third-party ones. Without first-party brands nothing counts as your mention; without owned domains the citation KPIs stay empty.

4. **Settings > Keywords.** Add the queries your customers ask (for example "best hotels in Barcelona"). Keyword groups work like folders, one per property or product line; a keyword can be in several groups. Tick keywords and use **Add to group**, or filter the list by group. Deleting a group keeps its keywords.

   **Settings > Markets** (optional). A market is one country plus one language (for example Chile / Spanish `es-CL`, Brazil / Portuguese `pt-BR`), with an optional city, region, coordinates, currency and the local competitors and brand names to track there. To add one, pick the country and the language from the lists, name a city if you want one other than the largest, and press **Next: describe this market**: one Bedrock call proposes the rest (language tag with its regional variant, currency, time zone, region, coordinates, id, name, extra local competitors, local brand names), the second step shows the details for you to check and edit, and you save from there. Give a keyword a market and every run asks it as a user in that market would: each AI engine gets a short instruction (location, answer language, currency) in its system channel plus its native location hint (OpenAI and Claude `user_location`, Perplexity `user_location` with coordinates), and the search providers get their country and language parameters. No engine has an answer-language parameter, so the instruction is what localizes the answer; the location hints steer the search. Write keywords in the market's language: search providers localize their results mostly through the query language. **Add to markets…** on a keyword asks Bedrock how a local user in each chosen market would type it and creates linked translations. A keyword without a market is asked exactly as before. The header's market selector narrows every scoped view, report, the Dashboard totals and the Citations tab to one market; KPI snapshots, alerts and written insights are kept per keyword group and market, so markets are never pooled into one number unless you pick *All markets (combined)*.

5. **Settings > Personas** (optional). Each persona is a prompt template with a `{keyword}` placeholder, for example "As a parent travelling with 3 young kids, what are the best options for {keyword}?". A run sends every enabled persona × keyword × provider. Filter the Visibility and Brand Mentions pages by persona to compare.

6. **Operations > Run Analysis.** Pick a keyword group, tick keywords, or leave everything unticked to run all active keywords, then **Start Analysis**.

7. **Operations > Schedule.** Named daily, weekly or monthly schedules in any IANA timezone, with **Run now**. An analysis run is scoped to all keywords, keyword groups (resolved when the schedule fires) or a fixed selection. With the SEO stack deployed, a schedule can instead take paid **domain traffic** or **backlink snapshots** of every owned and competitor domain; saving or running one asks first and names its paid calls. The page also lists each rank tracker's next check, read-only (a tracker's frequency is set on the tracker).

8. **Settings > Alerts** (optional). After every run the KpiAlerts step compares each keyword group's KPIs with its previous complete run and raises alerts for a mention-rate drop, a loss of average position, a competitor entering the top positions, a keyword that stops naming you, and a visibility gain after a content change you recorded. Alerts appear on the Dashboard and can be emailed.

## Configuration

### Bedrock models

Internal model calls use Amazon Bedrock (global inference profiles) and need no external key. `lambda/shared/models.py` maps each task to a tier:

| Tier | Model | Used for |
|---|---|---|
| fast | Claude Haiku 5.5 (low effort) | Brand extraction, crawler page summaries, Content Studio, research agent round evaluation |
| balanced | Claude Sonnet 5.5 (medium effort) | Ranking analysis (self-reflection), Action Center recommendations, brand expansion and competitor discovery, research agent planning, written report insights |
| deep | Claude Opus 5.5 (high effort) | Not used by default |

The tiers above are the defaults. An Admin can pick another model per tier in **Settings › Bedrock models** (`/api/providers/bedrock`): the list holds the account's active `global.anthropic.claude-*` inference profiles; **Test** makes a live Converse call and reads the account's tokens- and requests-per-minute quota for the model, reporting why a model cannot be used (`not_subscribed`, `access_denied`, `no_capacity` for a 0 tokens/min quota, `throttled`, `unsupported`, `unavailable`); **Save** re-tests first and stores the model with the request style that worked in the ProviderConfig row `bedrock-<tier>`. Choosing the default model removes the override. Every Lambda that calls Bedrock reads the saved model (cached 60 s per container; a read error falls back to the default).

Request style per model: adaptive (`thinking: adaptive` with an `output_config.effort` per tier and no `temperature`; the 5.x models and Opus 4.7/4.8 refuse sampling parameters) or budget (`temperature` plus a thinking token budget; Haiku, Sonnet and Opus 4.5 refuse adaptive thinking). A saved model uses the style its test proved; any other model starts from a first guess by family (for example `global.anthropic.claude-sonnet-4-6` gets the budget request), and a refusal that names the other style is retried once in that style and remembered for the container.

A function's tier can be changed with `BEDROCK_TIER_<ROLE>` or a model pinned with `BEDROCK_MODEL_<ROLE>`, which wins over the model saved in Settings (roles: `SUMMARIZATION`, `EXTRACTION`, `GENERATION`, `ANALYSIS`, `RESEARCH_PLANNING`, `RESEARCH_EVALUATION`); the stacks set the tiers in `bedrockTierEnv` in `lib/constructs/bedrock-invoke.ts`. A model chosen in Settings needs its own Marketplace subscription (see below); the test reports `not_subscribed` until it exists.

### Anthropic model access

Anthropic models on Bedrock need three things: `bedrock:InvokeModel` (granted per Lambda role), the one-time Anthropic use-case form (per account) and an AWS Marketplace subscription per model (per account). The `BedrockModelAccess` construct submits the form and subscribes Haiku 5.5, Sonnet 5.5 and Opus 5.5 at deploy time, so a new account needs no console steps; only its deploy-time function holds `aws-marketplace:Subscribe`. The `BedrockModelsEnabled` output lists the subscribed models.

- The account needs a verified payment method and a billing country Anthropic supports. A model that cannot be subscribed is reported as unavailable and the deploy continues. A refused form (already submitted, organization-level grant) is not an error.
- The form and subscriptions are account state and stay when the stack is deleted.
- Opus may not be offered on demand to every account; the default tiers do not use it.

If model access is managed elsewhere, skip all of this with `cdk deploy -c skipModelProvisioning=true` (`BedrockModelsEnabled` then reads `none (skipModelProvisioning)`); Bedrock calls fail with `AccessDeniedException` until access exists.

### CDK context

| Key | Default | Effect |
|---|---|---|
| `processKeywordsConcurrency` | `20` | Keywords processed in parallel per run |
| `crawlConcurrency` | `10` | Cited pages crawled in parallel per keyword |
| `providerConcurrency` | `{"openai":10,"perplexity":3,"gemini":10,"claude":5,"brave":10,"tavily":10,"exa":5,"serpapi":5,"firecrawl":2,"agentcore":5}` | Most calls each provider may have in flight across the whole run (reserved concurrency of its `CitationAnalysis-Search-<provider>` Lambda). Override any subset, e.g. `-c providerConcurrency='{"perplexity":5,"firecrawl":10}'`; `0` means no cap. The defaults suit free and entry-tier keys; raise them for paid plans. They reserve 65 Lambda concurrency, so an account with a low Lambda concurrency limit must lower them (AWS keeps at least 100 unreserved). |
| `providerPacing` | `{"perplexity":1.1,"firecrawl":12}` | Fewest seconds between two requests to a provider across every slot, kept through a shared send-time ledger in the ProviderConfig table (`lambda/shared/provider_pacing.py`). A cap bounds calls in flight, not how often they start: Perplexity allows about one request a second per key and Firecrawl's plan counts searches per minute, refused ones included. Override any subset, e.g. `-c providerPacing='{"perplexity":0,"firecrawl":6}'`; `0` means no pacing. |
| `seoEngine` | `false` | `-c seoEngine=true` adds Google AI Overviews (from the deployed SEO stack) as an answer engine in every run |
| `skipModelProvisioning` | `false` | Skip the Anthropic form and Marketplace subscriptions |
| `anthropicCompanyName`, `anthropicCompanyWebsite`, `anthropicIndustry`, `anthropicUseCases` | `Citation Analysis`, `https://aws.amazon.com/bedrock/`, `Technology`, "Summarize content and generate new marketing content." | Details submitted on the Anthropic form |
| `dev` | off | `-c dev=true` lets `http://localhost:5173` call the API (`cd web && npm run dev`) |
| `mcpRedirectUris` | `["http://localhost:5173/oauth/callback","http://localhost:5173/callback"]` (Kiro, Claude Code) | OAuth callback URLs of the MCP clients (exact match in Cognito), as a JSON array or a comma-separated string |
| `mcpPinnedTools` | none | Catalogue operations the MCP server also lists as direct tools, e.g. `-c mcpPinnedTools=get_prompt_insights,list_providers` |
| `mcpLimits` | `{"runsInFlight":1,"runsPerDay":5,"jobsPerDay":20,"maxRunKeywords":50,"seoCallsPerDay":50}` | Per-caller limits of the MCP spend tools; override any subset as a JSON object; `0` turns that spend off |

### Secrets

The stack imports, and never creates, `citation-analysis/{openai,perplexity,gemini,claude,brave,tavily,exa,serpapi,firecrawl}-key`. The tenth provider, `agentcore` (Amazon Bedrock Web Search), has no secret: it uses IAM. **Settings > AI providers** creates or updates a secret when you save a key; `aws secretsmanager create-secret --name citation-analysis/<provider>-key --secret-string <key>` works too.

### Web search gateway

The `agentcore` provider (Amazon Bedrock Web Search) queries an Amazon-operated web index through an AgentCore Gateway. It is deployed by its own stack, `CitationAnalysisWebSearchStack`, and needs no secret or API key: the search Lambda signs requests with its IAM role and the gateway uses `AWS_IAM` inbound auth.

| Context | Default | Effect |
|---|---|---|
| `webSearchRegion` | `us-east-1` | Region of the gateway; allowed values `us-east-1`, `us-west-2`, `eu-west-1`, `ap-northeast-1` |

Until the stack is deployed the provider shows **Gateway not deployed** in **Settings > AI providers** and cannot be enabled. AWS terms for the web search tool: show the source citations and links, and do not extract results in bulk or build a competing index.

## Security

- **Authentication:** Cognito user pool, email sign-in, self sign-up disabled, password policy of 8+ characters with all character classes, 1-hour access and ID tokens and 7-day refresh tokens. MFA is not configured. The API's Cognito authorizer covers every route except `GET /api/health`; user management requires the `Admin` group.
- **MCP server:** OAuth 2.1 authorization-code flow with PKCE on a public app client (no client secret, no implicit grant), scopes `<McpUrl>/read`, `<McpUrl>/write` and `<McpUrl>/run`, RFC 8707 audience binding, 90-day refresh tokens. Its Cognito authorizer validates access tokens only, and the Lambda rejects a token whose issuer, client id, `token_use` or audience is not this server's. Tool calls run as the token's user with that user's groups, so admin-only routes stay admin-only. Spend tools need a single-use confirmation token from their estimate and are capped per caller (`mcpLimits`); every write and spend call leaves an audit record (365 days) in `CitationAnalysis-McpState`. The Cognito Managed Login domain is the only hosted sign-in page the sample defines; the dashboard itself does not use it.
- **Edge:** CloudFront with HTTPS redirect and security headers (CSP, HSTS, frame DENY). There is no WAF, by design, so the sample stays pay-per-use: the API relies on the Cognito authorizer, a 100 rps / 200 burst stage throttle and a 10,000 requests/day usage plan. See [SECURITY.md](SECURITY.md#aws-waf) to add one.
- **CORS:** API error responses and each Lambda allow only the CloudFront origin (read from SSM `/citation-analysis/cors-origin`).
- **Data:** S3 buckets block public access and require TLS; DynamoDB and S3 are encrypted at rest; API keys live in Secrets Manager; Lambda logs are kept 30 days.

To allow self sign-up, set `selfSignUpEnabled: true` in `lib/constructs/auth.ts` and remove `hideSignUp` from the `Authenticator` in `web/src/App.tsx`.

**Federated sign-in (for example Microsoft Entra ID)** is not wired up: the stack defines no identity provider (the only Cognito domain is the MCP stack's Managed Login domain), and the dashboard signs in with the Amplify `Authenticator` (email and password). Adding it means a user pool domain, an OIDC identity provider (issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`, scopes `openid email profile`) and `supportedIdentityProviders` with the authorization-code flow on the client in `lib/constructs/auth.ts` (do this in CDK rather than the console, or the next deploy overwrites it; keep the client secret out of source control), plus the OAuth settings in `Amplify.configure` in `web/src/App.tsx` and a sign-in-with-redirect button. See [adding OIDC identity providers to a user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html).

## Cost

> Unit prices below were taken from each vendor's pricing page on 26 May 2026, at US East (N. Virginia) rates. Prices change; re-check the linked pages before sizing a workload.

You pay AWS for the infrastructure and Bedrock, and each external AI provider on your account with them. AI charges usually dominate. With no batching or prompt caching, AI cost scales with `keywords × providers × personas × runs`.

### AWS infrastructure

For 100 keywords analysed weekly across four providers and three personas (about 4,800 provider calls a month), AWS typically costs **$12–50 per month**, mostly the crawler and DynamoDB. Every service is pay-per-use; the only fixed charge is Secrets Manager's $0.40 per stored key.

| Service | Monthly | Notes |
|---|---|---|
| [Bedrock AgentCore Browser](https://aws.amazon.com/bedrock/agentcore/pricing/) | $5–20 | One browser session per newly cited URL; the main variable |
| [DynamoDB on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/) | $2–10 | 21 tables; $0.625/M writes, $0.125/M reads, $0.25/GB above 25 GB |
| [Lambda](https://aws.amazon.com/lambda/pricing/) | $1–3 | Mostly within the free tier |
| [API Gateway REST](https://aws.amazon.com/api-gateway/pricing/) | $1–5 | $3.50/M calls |
| [S3](https://aws.amazon.com/s3/pricing/) | $1–5 | Raw responses, screenshots, access logs |
| [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) | $2–4 | $0.40 per stored provider key |
| [CloudFront](https://aws.amazon.com/cloudfront/pricing/) | $0–2 | Small dashboard traffic |
| [Step Functions](https://aws.amazon.com/step-functions/pricing/) | <$1 | $0.000025 per state transition |
| [Cognito](https://aws.amazon.com/cognito/pricing/) | $0 | First 10,000 MAUs free on Essentials |

### AI provider rates

| Provider | Model | Input | Output | Source |
|---|---|---|---|---|
| OpenAI | `gpt-5-mini` | $0.25/M | $2.00/M | [OpenAI](https://platform.openai.com/docs/models/gpt-5-mini) |
| Anthropic | `claude-sonnet-4-5` | $3.00/M | $15.00/M | [Anthropic](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| Google Gemini | `gemini-3-flash-preview` | $0.50/M | $3.00/M | [Google](https://ai.google.dev/gemini-api/docs/pricing) |
| Perplexity | `sonar` | $1.00/M | $1.00/M | [Perplexity](https://docs.perplexity.ai/getting-started/pricing) |

Perplexity also charges about $0.005 per request for search context (low-context mode).

2.37.0 changed the defaults (Perplexity `perplexity/sonar` on the Agent API, Gemini `gemini-3.6-flash`, Claude `claude-sonnet-5-5` with uncapped searches and 4,096 output tokens). The rates and the worked example below were measured on the earlier defaults; check the linked pricing pages. On the Agent API Perplexity reports each answer's exact cost (`usage.cost.total_cost`, stored in the answer's metadata as `cost_usd`); a market-tuned test answer (Chile, Spanish) cost about $0.0055.

Bedrock, on your AWS bill:

| Model | Input | Output | Volume driver |
|---|---|---|---|
| Claude Haiku 4.5 | $1.00/M | $5.00/M | Brand extraction runs on every answer; crawler summaries on every new page |
| Claude Sonnet 4.6 | $3.00/M | $15.00/M | On demand: ranking analyses (cached 24 h per keyword, brand and persona), Action Center, brand discovery, research agent |

### Worked example

The workload above is `100 × 4 × 3 × 4 = 4,800` calls a month, 1,200 per provider. At about 100 input and 1,500 output tokens per call (Claude is capped at 1,024), each provider sees 120,000 input and 1.8 million output tokens:

| Line | Monthly |
|---|---|
| OpenAI gpt-5-mini: 120k × $0.25/M + 1.8M × $2.00/M | $3.63 |
| Anthropic Sonnet 4.5: 120k × $3.00/M + 1.8M × $15.00/M | $27.36 |
| Gemini 3 Flash Preview: 120k × $0.50/M + 1.8M × $3.00/M | $5.46 |
| Perplexity Sonar: 120k × $1.00/M + 1.8M × $1.00/M + 1,200 × $0.005 | $7.92 |
| Bedrock Haiku brand extraction: 4,800 answers × ~2,000 input and ~300 output tokens | ~$17 |
| **AI total** (excluding crawler summaries and on-demand Sonnet calls) | **~$61** |

With the infrastructure above, this workload costs roughly $75–110 a month. Anthropic accounts for $27 of the AI total; running only Gemini and Perplexity brings AI cost to about $30.

### Reducing cost

- Disable providers and personas you do not need: each multiplies the call count.
- Run weekly rather than daily for about a seventh of the cost.
- Pick a cheaper model for any engine in **Settings > AI providers** (for example Claude Haiku over Sonnet).
- Lower the crawl concurrency (`-c crawlConcurrency=N`, default 10 pages per keyword) to spread AgentCore usage.
- `SearchResults`, `Citations` and `CrawledContent` have no TTL; add one if you do not need full history.
- Track spend in [AWS Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/) by the `aws:cloudformation:stack-name = CitationAnalysisStack` cost allocation tag once it is activated.

## Development

```bash
npm run build          # tsc (CDK app)
npm run watch          # tsc -w
npm run lint:fix       # ESLint --fix
cd web && npm run dev  # Vite dev server on :5173 (deploy with -c dev=true)
```

The tenets every change is measured against are in [TENETS.md](TENETS.md). UI conventions are in [docs/design-system.md](docs/design-system.md); versioning and the changelog in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-changelog).

### Validation

`npm run validate` (`scripts/validate.sh`) runs every quality gate in parallel lanes and stops at the first failure; the
`quality gates` workflow runs the same script, one lane per job, on every pull request. `npm run validate:help` explains
the lanes, options, logs and the workflow to follow on a failure; `npm run validate:failed` re-runs only the steps that
did not pass.

| Lane | Steps | Checks |
|---|---|---|
| `py` | ruff, pyright, vulture ×2, contracts, pytest | `scripts/lint-python.sh` (lint, types, dead code in production code, then the whole tree); `scripts/check-contracts.py`: every env var CDK sets is read by a Lambda and vice versa, every member in `web/src/types` is read by dashboard code (allowlist entries need a reason); the Lambda tests |
| `tsc` | version, repo script tests, `tsc` ×2, knip ×4 | `package.json`, `web/package.json` and the newest `CHANGELOG.md` release agree; the tests of `scripts/*.mjs`; `tsc --noEmit` for the CDK app and the dashboard; knip, then `knip --production --strict`, for both |
| `lint` | ESLint, jscpd ×4, gitleaks, actionlint + zizmor | ESLint over the CDK app, `web/src` and `scripts/*.mjs`; jscpd over TypeScript and Python, code then tests; secrets in the working tree (`.gitleaks.toml`); the GitHub Actions workflows (`scripts/actions-lint.sh`) |
| `test` | vite build, Vitest | the dashboard build the CDK app stages, then the CDK stack tests |
| `web` | Vitest | the dashboard tests (jsdom) |
| `sec` | CodeQL | `scripts/codeql-local.sh`: CodeQL's `security-and-quality` suites for Python, JavaScript/TypeScript and GitHub Actions; any result fails. For Python it loads the repository's model pack (`scripts/codeql/python-lambda-models`), which declares the API Gateway `event` of every decorated Lambda handler as attacker-controlled input: CodeQL only knows web frameworks as taint sources, so without it the log-injection, SSRF, path- and regex-injection queries are silent on Lambda code. Needs `gh extension install github/gh-codeql`; skipped with a notice without it, and skipped on GitHub Actions, where code scanning runs |

The gate needs the Python dev toolchain in a repo-local venv, both built layers (the tests import runtime libraries from the shared layer, and the CDK tests synthesize the app) and the scanners:

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt
bash lambda/layer/build-layer.sh && bash lambda/crawler-layer/build-layer.sh
brew install gitleaks actionlint zizmor shellcheck   # macOS; elsewhere their GitHub releases
```

Rules the gates enforce:

- **Complexity** is a hard stop: cyclomatic complexity 12 in both languages (ruff `C901`, ESLint `complexity`), and ruff's `PLR0911`/`PLR0912`/`PLR0915` at 11 returns, 16 branches and 53 statements. ESLint also caps files at 400 lines and nesting at depth 3. Split the code; never raise a limit or add `# noqa`.
- **Python lint** also runs flake8-bandit (`S`), `BLE001`, tryceratops, flake8-pytest-style, no `print` (`T20`), UTC-aware datetimes (`DTZ`) and lazy logger arguments (`G`) over `lambda/` and `scripts/`; each per-file exemption in `pyproject.toml` states its reason.
- **Types:** pyright in `standard` mode over `lambda/` and `scripts/`, with imports resolved from `lambda/` and the built shared layer. Fix findings; never suppress them inline.
- **Duplication:** jscpd at 25 tokens / 3 lines with comments skipped (`mode: weak`) and `.ts` compared with `.tsx`, in all four configs (`.jscpd.json`, `.jscpd.tests.json`, `.jscpd.python.json`, `.jscpd.python-tests.json`). Import statements are not counted as duplication: the TypeScript configs and the Python tests config drop them with `ignorePattern` (whole statements only, never `vi.mock` or other code). The Python production config keeps them, because dropping them there joins handler docstrings to the module setup and creates more clones than it removes. The clones that remain were reviewed as incidental (hoisted `vi.mock` lines, handler headers, matching prop runs) and are recorded in `.jscpd-baseline/`; any clone not in the baseline fails (`failOnNewClones: 0`). After removing a baselined clone, or when a reviewer accepts a new incidental one, run `npm run duplication:baseline` and commit the result. Share test builders instead of copying arrange blocks: `web/src/test/`, the `*-fixtures.ts` next to the module, and `lambda/testing/` (`lambda/conftest.py` puts `lambda/` and the built layer on `sys.path`).
- **Dead code:** knip and vulture each run twice, because a symbol only its own tests use counts as dead. The production pass excludes tests (knip's `!` patterns in `knip.json` and `web/knip.json`; vulture without `test_*.py`, `conftest.py` and `lambda/testing/`), the second pass covers the whole tree. Vulture's floor is 60% confidence, the level it assigns unused functions, classes and attributes.
- **Custom ESLint rules** in `.eslint-rules/`: no generic names (utils, helpers, manager, data …) in files and exports, and no helper functions defined inside test files.

Mutation testing is not part of `validate` (one module takes minutes). Run it on the modules a change touches and resolve every surviving mutant with a test, a deletion, or a `// Stryker disable` comment explaining why it is equivalent:

```bash
npm run mutation:python -- lambda/shared/scope_params.py lambda/shared/test_scope_params.py
(cd web && npm run mutation -- --mutate src/hooks/useAnalysisEndpoint.ts)
```

## FAQ

### What is generative engine optimization (GEO)?

GEO, also called answer engine optimization (AEO), is work aimed at making a brand or page appear in the answers that AI engines write, either named in the text or cited as a source. The term comes from [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735) (Aggarwal et al., KDD 2024). Google's guide [Optimizing your website for generative AI features on Google Search](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) says that, for Google Search, optimizing for generative AI search is still SEO. This project does not change your content for you; it measures where you stand, so you can see whether changes help.

### How is this different from an SEO rank tracker?

An SEO rank tracker records where a page ranks in a list of search results. An AI engine writes an answer instead, names some brands in some order and cites some sources, and the answer can change from one run to the next and from one engine to another. This project stores every answer and computes per-answer KPIs over them: mention rate, share of voice, average position within the answer, visibility score and citation rate ([docs/kpi-definitions.md](docs/kpi-definitions.md)). The survey [Optimizing Visibility in Generative Engines](https://arxiv.org/abs/2607.14035) reports substantial run-to-run variability and low source overlap between engines and recommends repeated measurement; scheduled runs across several engines are how this project measures. With the optional SEO stack it also tracks Google organic rankings, and the SEO vs GEO report sets the two side by side.

### Which AI engines does it track?

OpenAI, Perplexity, Google Gemini and Anthropic Claude, each called through its API with web search on (models and search tools are in [Getting started](#getting-started)), and Google AI Overviews through DataForSEO when the [SEO stack](#seo-stack-optional) is deployed. The engines are queried through their APIs, not the consumer apps, so answers can differ from what the ChatGPT, Perplexity, Gemini or Claude apps show a signed-in user. Brave, Tavily, Exa, SerpAPI, Firecrawl and Amazon Bedrock Web Search can add cited links to a run, but they write no answer and do not count towards the KPIs.

### What does it cost to run?

You pay AWS for the infrastructure and Bedrock, and each AI provider directly. AI calls scale with keywords × providers × personas × runs. The [Cost](#cost) section works through 100 keywords run weekly on four providers with three personas: AWS about $12–50 a month and roughly $75–110 a month in total, measured on the model defaults before 2.37.0. DataForSEO list prices for the SEO features are in [docs/seo.md](docs/seo.md#prices). Check each vendor's pricing page before sizing a workload.

### Can AI assistants query the data?

Yes. The optional MCP server lets Kiro, Claude, ChatGPT and other MCP clients read keywords, KPIs, reports and citations as the signed-in user, and start runs after a cost estimate and confirmation. See [docs/mcp.md](docs/mcp.md).

### Is it production ready?

No. It is sample code for demonstration and education, as the notice at the top says. It has no AWS WAF and no MFA by default, and you should review security, compliance and cost with your own teams before using it for production work. See [Security](#security).

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
