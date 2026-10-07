# Connecting AI assistants (MCP server)

The `CitationAnalysisMcpStack` stack serves the Citation Analysis API as an MCP server, so an assistant can read keywords, reports and citations, set up keyword groups and, with your approval, start runs, research jobs and content briefs. Every tool call is replayed against the dashboard's own API handlers as the signed-in user: you get the same permissions and the same figures as in the browser.

The endpoint speaks MCP over Streamable HTTP (JSON responses, no SSE stream) and is protected with OAuth 2.1 + PKCE by the deployment's Cognito user pool. Dynamic client registration is not offered. Every client uses the pre-registered public client id (no secret).

The server sits behind its own CloudFront distribution (`https://<dist>.cloudfront.net`), which maps the host root onto the API Gateway stage. Clients discover the authorization server from well-known URLs at the host root: RFC 9728's `/.well-known/oauth-protected-resource/mcp`, RFC 8414's `/.well-known/oauth-authorization-server` and OIDC's `/.well-known/openid-configuration`. On an execute-api URL the stage (`/prod`) is a path segment, so none of those locations exist and clients such as Claude Code fail to sign in. The distribution caches nothing and passes every request through to the API, `Authorization` header included.

## What you need

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

Prompts (`prompts/list`, `prompts/get`):

- `geo_audit(group)`: an audit of one keyword group built from visibility, insights, KPI history and citation gaps. It quotes only numbers the tools returned.
- `setup_brand_tracking(brand, market)`: proposes brands, competitors and a group of buying-intent prompts, and creates the group and keywords only after you approve.

## Spending credit: estimate, then confirm

Any operation that calls AI providers, search providers or Bedrock is split into two steps:

| Estimate | Start | Scope | Who |
|---|---|---|---|
| `estimate_run` | `start_run` | `run` | Admins only, as in the dashboard |
| `estimate_research` | `start_research` | `write` | Any signed-in user |
| `estimate_content_brief` | `generate_content_brief` | `write` | Any signed-in user |

1. The estimate counts what the spend would do, without spending. For a run that is keywords × enabled personas (or 1) × enabled AI engines and search providers with a key. For research it is the web-search calls and, for the agent, the upper bound of Bedrock calls. For a brief it is one Bedrock generation. Counts only, no prices: provider pricing differs per account. Use each provider's pricing page for the cost.
2. If the spend can start, the estimate returns a `confirmation_token`. The token is single use, valid 5 minutes, and bound to you, the operation and the exact request (scope and arguments). The assistant is told to show you the estimate and wait for your approval.
3. The start call carries the same arguments and the token. The token is used up atomically before anything else happens. Missing, expired, used, issued to someone else or issued for other arguments: the start is refused and nothing starts.

The tokens rely on no MCP elicitation, because connector hosts do not support it. The approval is the assistant asking you in the conversation. A tool result can carry text from third-party pages, but it cannot start a spend by itself, because a spend needs a fresh estimate and token.

### Limits per user

Defaults, changeable per deployment with `-c mcpLimits='{"runsPerDay":10}'` (`0` turns a spend off):

| Key | Default | Meaning |
|---|---|---|
| `runsInFlight` | 1 | Analysis runs you can have running at once (checked through the run status the API reports) |
| `runsPerDay` | 5 | Analysis runs you can start per UTC day |
| `jobsPerDay` | 20 | Research jobs and content briefs together, per UTC day |
| `maxRunKeywords` | 50 | Keywords one `start_run` can cover; counted at the estimate and again at the start |

A refusal names the limit and, for the daily ones, when it resets (midnight UTC). A start that the API itself refuses gives the day's use back.

## Audit

Every call writes one structured log line (`caller_sub`, `tool`, `operation`, `outcome`, `ms`, and `reason` when refused) to `/aws/lambda/CitationAnalysis-Mcp`. Tokens and request bodies are never logged. Write and spend calls are also recorded in the `CitationAnalysis-McpState` table for 365 days (partition `audit#<sub>`). The same on-demand table holds the confirmation tokens and the per-user counters.

## Not exposed

User management, provider API keys and provider settings, brand configuration writes, schedule writes, and every delete. Use the dashboard for those.
