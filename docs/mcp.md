# Connecting AI assistants (MCP server)

The `CitationAnalysisMcpStack` stack serves the Citation Analysis API as an MCP server, so an assistant can read keywords, reports and citations, set up keyword groups and, with your approval, start runs, research jobs and content briefs. Every tool call is replayed against the dashboard's own API handlers as the signed-in user: you get the same permissions and the same figures as in the browser.

The endpoint speaks MCP over Streamable HTTP (JSON responses, no SSE stream) and is protected with OAuth 2.1 + PKCE by the deployment's Cognito user pool. Dynamic client registration is not offered. Every client uses the pre-registered public client id (no secret).

The server sits behind its own CloudFront distribution (`https://<dist>.cloudfront.net`), which maps the host root onto the API Gateway stage. Clients discover the authorization server from well-known URLs at the host root: RFC 9728's `/.well-known/oauth-protected-resource/mcp`, RFC 8414's `/.well-known/oauth-authorization-server` and OIDC's `/.well-known/openid-configuration`. On an execute-api URL the stage (`/prod`) is a path segment, so none of those locations exist and clients such as Claude Code fail to sign in. The distribution caches nothing and passes every request through to the API, `Authorization` header included.

## What you need

The dashboard has a page for this: Settings › AI assistants (`/settings/ai-assistants`, "Connect an AI assistant") shows the server URL, per-client steps with copyable snippets (and a `mcp.json` download for Kiro), example questions, instructions to give your assistant, and the tool list. It takes `McpUrl` and `McpClientId` from the stack outputs at build time (`scripts/build-web.sh` exports them as `VITE_MCP_URL` and `VITE_MCP_CLIENT_ID`), so rebuild the dashboard after the first MCP stack deploy (`npm run deploy` deploys both stacks before it builds the dashboard; or run `./scripts/deploy-web.sh`). Without those outputs the page says the MCP server isn't deployed.

From the `CitationAnalysisMcpStack` outputs (`aws cloudformation describe-stacks --stack-name CitationAnalysisMcpStack`):

| Output | Use |
|---|---|
| `McpUrl` | The server URL (`https://<dist>.cloudfront.net/mcp`) |
| `McpClientId` | OAuth client id (public client, leave the secret empty) |
| `McpAuthorizeUrl` | Authorization URL (`https://citation-analysis-<account>.auth.<region>.amazoncognito.com/oauth2/authorize`) |
| `McpTokenUrl` | Token URL (same host, `/oauth2/token`) |
| `McpResourceMetadataUrl` | RFC 9728 protected resource metadata (`https://<dist>.cloudfront.net/.well-known/oauth-protected-resource/mcp`); clients find it on their own from the `401` |
| `McpApiUrl` | The API Gateway stage behind CloudFront, for debugging only; don't give it to clients |

Scopes are named after the server URL:

| Scope | Grants |
|---|---|
| `openid` | Sign-in |
| `<McpUrl>/read` | Every read tool |
| `<McpUrl>/write` | Keyword and group changes; keyword research and Content Studio (estimate and start) |
| `<McpUrl>/run` | Analysis runs (estimate and start), which are also admin-only |

Cognito matches callback URLs exactly. Allow each client's callback when you deploy, as a JSON array or a comma-separated list. The value replaces the defaults (`http://localhost:5173/oauth/callback` for Kiro, `http://localhost:5173/callback` for Claude Code), so keep those entries if you use them:

```bash
npx cdk deploy CitationAnalysisMcpStack \
  -c mcpRedirectUris='["http://localhost:5173/oauth/callback","http://localhost:5173/callback","https://claude.ai/api/mcp/auth_callback","https://claude.com/api/mcp/auth_callback","https://chatgpt.com/connector_platform_oauth_redirect"]'
```

Vendors change their callback URLs. Copy the one your client shows on its connection form whenever it shows one.

## Clients

### Kiro (IDE and CLI)

Add a remote server to `.kiro/settings/mcp.json` (or to an agent's `mcpServers`). Kiro opens the Managed Login page in the browser and stores the token:

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

### Claude.ai and Claude Desktop

Settings › Connectors › Add custom connector: name, `<McpUrl>`, then under Advanced settings the OAuth client id `<McpClientId>` with an empty client secret. Allow both `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`: Claude uses either one depending on the domain you opened it from. Claude Desktop uses the same connector as claude.ai.

### Claude Code

```bash
claude mcp add --transport http citation-analysis <McpUrl> --client-id <McpClientId> --callback-port 5173
```

Then run `/mcp` in Claude Code (or `claude mcp login citation-analysis`) to sign in. With `--callback-port 5173` the callback is `http://localhost:5173/callback`, which the stack allows by default. Claude Code finds the authorization server through host-root discovery, so you don't need to set `oauth.authServerMetadataUrl`. Remove it if you set it for an earlier execute-api URL.

### ChatGPT (developer mode)

Settings › Security and login › Developer mode on, then create a connector with `<McpUrl>`, authentication OAuth, and under Advanced OAuth settings the client id `<McpClientId>` with no secret. Allow the redirect URI ChatGPT shows there (usually `https://chatgpt.com/connector_platform_oauth_redirect`).

### Amazon Quick (web)

Integrations › MCP › add, server URL `<McpUrl>`, then configure OAuth manually:

| Field | Value |
|---|---|
| Client id | `<McpClientId>` |
| Client type | Public (no client secret) |
| Authorization URL | `<McpAuthorizeUrl>` |
| Token URL | `<McpTokenUrl>` |
| Scopes | `openid <McpUrl>/read <McpUrl>/write <McpUrl>/run` |
| Redirect URL | Shown on the form, `https://<region>.quicksight.aws.amazon.com/sn/oauthcallback`; add it to `mcpRedirectUris` |

Read tools carry `readOnlyHint: true`, so Quick's scheduled agents can run them unattended.

### Amazon Quick Desktop

Not verified yet. If it offers the same OAuth form as Quick web, use the same values and the redirect URL it shows. If it accepts only a static header, it cannot connect: personal access keys are designed but not built.

## Tools

`tools/list` shows eight direct tools (keyword groups, keywords, brand configuration, visibility, reports, citations, recommendations, keyword management) plus `search_tools`, `describe_tool` and `call_tool`. Every other operation is in the catalogue: find it with `search_tools`, read its schema with `describe_tool`, and run it with `call_tool`. To list some catalogue operations directly, pin them with `-c mcpPinnedTools=get_report_insights,estimate_run`. Add `?tools=full` to the URL to list everything.

Catalogue reads include providers, personas, engine answers, persona rankings, prompt insights, report insights (`get_report_insights`), recent searches, crawled pages, sentiment examples, custom reports (list and one by id), schedules, KPI alerts, run status (`get_run_status`), research jobs and templates, and Content Studio items.

Large lists come in pages: keywords, the citation list, recent searches, crawled pages, brand appearances (`get_brand_mentions` `view=appearances`), group KPI keywords and drivers (`get_report` `kind=group_kpis`), sentiment examples, schedules, research jobs and Content Studio items return `next_token`; pass it back with the same arguments for the next page (`null` on the last page). A result over 50,000 characters is cut to a first page and marked `truncated`; when it also has a `next_token`, ask again with a smaller `limit` first, because the cursor continues after the whole page. An API answer over 5 MB is read by the server from its temporary S3 copy, so tools see the same data as the dashboard.

SEO reads (SEO stack, router `seo`; they need `CitationAnalysisSeoStack` deployed). They are free: none calls DataForSEO, and each description starts with "Free".

- `get_keyword_metrics(keyword_ids, market_id?)`: the stored search volume, monthly searches, keyword difficulty, CPC, competition and intent of up to 500 keywords (`POST /api/seo/keywords/metrics/lookup`). Ids without stored metrics are absent; fetching new metrics for tracked keywords is not exposed (use the dashboard).
- `get_seo_geo_comparison(market_id?, group_id?)`: per keyword, the Google organic position, competitor positions, whether an AI Overview showed and cites you, the AI mention rate and the SEO vs GEO quadrant, with totals (`GET /api/seo/seo-geo`).
- `get_seo_recommendations(market_id?, group_id?)`: the SEO recommendations over those rows, with their status (`GET /api/seo/insights`).
- `get_rank_tracking(view, ...)`: `trackers` (active trackers with their `keyword_scope` — `all` Settings keywords of the market, one `group`, or `list` for older trackers of extra keywords only — keyword counts and latest run), `tracker` (one tracker and its keywords), `results` (positions over `1d`/`7d`/`30d`/`90d`) or `history` (one keyword over up to 365 days).
- `get_domain_snapshots(domain, market_id?)`: the stored estimated-traffic snapshots of a domain.
- `get_backlink_snapshots()`: the stored weekly backlink snapshots of your and your competitors' domains.
- `get_site_audits(view, ...)`: `list` (recent audits), `summary` (status, progress, summary, AI readiness) or `issues` (issue types, or with `issue_type` the affected pages, paged).
- `get_local_job(job_id)`: status and results of a local job (rank grid, reviews, profile updates).

Engine filters (`provider`) accept `google_ai_overview` (Google AI Overviews) next to the four other AI engines.

Prompts (`prompts/list`, `prompts/get`):

- `geo_audit(group)`: an audit of one keyword group built from visibility, insights, KPI history and citation gaps. It quotes only numbers the tools returned.
- `setup_brand_tracking(brand, market)`: proposes brands, competitors and a group of buying-intent prompts, and creates the group and keywords only after you approve.

## Spending credit: estimate, then confirm

Any operation that calls AI providers, search providers, DataForSEO or Bedrock is split into two steps:

| Estimate | Start | Scope | Who |
|---|---|---|---|
| `estimate_run` | `start_run` | `run` | Admins only, as in the dashboard |
| `estimate_research` | `start_research` | `write` | Any signed-in user |
| `estimate_content_brief` | `generate_content_brief` | `write` | Any signed-in user |
| `estimate_seo_keywords` | `run_seo_keywords` | `run` | Any signed-in user |
| `estimate_seo_domain` | `run_seo_domain` | `run` | Any signed-in user |
| `estimate_seo_backlinks` | `run_seo_backlinks` | `run` | Any signed-in user |
| `estimate_seo_local` | `run_seo_local` | `run` | Any signed-in user |
| `estimate_seo_job` | `start_seo_job` | `run` | Admins only, as in the dashboard |

1. The estimate counts what the spend would do, without spending. For a run that is keywords × enabled personas (or 1) × enabled AI engines and search providers with a key, plus keywords × 1 for Google AI Overviews when it is on (it asks the plain keyword once per keyword, whatever the personas). The DataForSEO credential itself is not a provider a run calls. For research it is the web-search calls and, for the agent, the upper bound of Bedrock calls. For a brief it is one Bedrock generation. Counts only, no prices: provider pricing differs per account. Use each provider's pricing page for the cost.
2. If the spend can start, the estimate returns a `confirmation_token`. The token is single use, valid 5 minutes, and bound to you, the operation and the exact request (scope and arguments). The assistant is told to show you the estimate and wait for your approval.
3. The start call carries the same arguments and the token. The token is used up atomically before anything else happens. Missing, expired, used, issued to someone else or issued for other arguments: the start is refused and nothing starts.

### DataForSEO (family `seo`)

The SEO stack's paid operations, each through the SEO API with its caches and checks (a cached answer costs nothing; a billed DataForSEO call is never re-sent):

- `*_seo_keywords`: `lookup=research` (keyword ideas around a seed: `mode`, `limit` 150/300/500, `clickstream`, `group_keywords`) or `lookup=serp` (organic Google results, `depth` 20/50).
- `*_seo_domain`: `lookup=overview` (organic keywords, traffic, traffic value) or `lookup=ranked_keywords` (one page of the keywords a domain ranks for).
- `*_seo_backlinks`: `lookup=overview` (totals and a year of history) or one page of `links`, `referring_domains` or `top_pages`.
- `*_seo_local`: `lookup=businesses` (listings near a point), `profile` (one Google Business Profile) or `serp` (Maps or Local Finder results and where a business sits in them).
- `*_seo_job` (Admin): `rank_run` (check a rank tracker now), `site_audit` (crawl your own site), `domain_snapshot`, `backlinks_snapshot` (every tracked domain) or `rank_grid` (local rank on a 3×3, 5×5 or 7×7 grid). Follow a job with the free reads above.

The estimate states the most DataForSEO calls the request makes and the list price of one call (from the same price table the SEO API uses), for example "at most 1 DataForSEO call(s); live Google organic results, $0.0035 at depth 20". A rank run counts one live check per keyword and device (from the free tracker estimate); a backlinks snapshot one call per tracked domain; a site audit makes no DataForSEO call. No dollar total is added up and no spend is tracked. Each tool's description gives the approximate price per call.

A failed DataForSEO call answers with the SEO API's fixed error text (for example "DataForSEO is unavailable, try again later"), never the provider's own message. Results are trimmed to 50,000 characters like every tool result.

The tokens rely on no MCP elicitation, because connector hosts do not support it. The approval is the assistant asking you in the conversation. A tool result can carry text from third-party pages, but it cannot start a spend by itself, because a spend needs a fresh estimate and token.

### Limits per user

Defaults, changeable per deployment with `-c mcpLimits='{"runsPerDay":10}'` (`0` turns a spend off; an unknown key fails synth):

| Key | Default | Meaning |
|---|---|---|
| `runsInFlight` | 1 | Analysis runs you can have running at once (checked through the run status the API reports) |
| `runsPerDay` | 5 | Analysis runs you can start per UTC day |
| `jobsPerDay` | 20 | Research jobs and content briefs together, per UTC day |
| `maxRunKeywords` | 50 | Keywords one `start_run` can cover; counted at the estimate and again at the start |
| `seoCallsPerDay` | 50 | DataForSEO lookups and SEO jobs together (`run_seo_*`, `start_seo_job`), per UTC day |

A refusal names the limit and, for the daily ones, when it resets (midnight UTC). The keyword cap is checked by counting the scope's active keywords page by page; the count stops as soon as it passes `maxRunKeywords`. If it cannot finish inside the request's time budget the start is refused ("The scope's keywords could not all be counted (too many, or the API was slow)"), because a spend is never started on a guess. A start that the API itself refuses gives the day's use back. A start that timed out keeps it, because the run may have started. Runs in flight that cannot be checked in time count as running.

## Time budget and `upstream_timeout`

The MCP Lambda and the API Lambdas share API Gateway's 29 s limit. Each MCP request carries a deadline (`lambda/shared/request_deadline.py`), and a tool call waits for its API Lambda only for the time left minus 1 s. The call is sent once and never retried, so a write is never sent twice. When the API does not answer in time, or too little time is left to ask it (under 2 s), the tool returns an error result (`isError: true`) with:

```json
{"error": "upstream_timeout", "details": "The API did not answer in time. A write or start may still complete: check its state before retrying."}
```

For a read, ask again (with a narrower scope or smaller `limit` if it keeps happening). For a write or a start, check its state first (`get_run_status`, the keyword or group, the research job) before you retry. Each timeout writes an audit line with outcome `upstream_timeout`.

API reads that run out of time inside the 29 s answer partial data instead of an error, flagged the way the dashboard sees it (`truncated`, `keywords_truncated`, `truncated_before`); tools pass those flags through.

## Audit

Every call writes one structured log line (`caller_sub`, `tool`, `operation`, `outcome`, `ms`, and `reason` when refused) to `/aws/lambda/CitationAnalysis-Mcp`. Tokens and request bodies are never logged. Write and spend calls are also recorded in the `CitationAnalysis-McpState` table for 365 days (partition `audit#<sub>`). The same on-demand table holds the confirmation tokens and the per-user counters.

## Not exposed

User management, provider API keys and provider settings, brand configuration writes, schedule writes, SEO setup (creating or editing rank trackers, the weekly backlink snapshot schedule, cancelling an audit, fetching keyword metrics for tracked keywords), and every delete. Use the dashboard for those.
