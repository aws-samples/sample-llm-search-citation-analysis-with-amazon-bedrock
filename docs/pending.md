# Pending work

State as of 7 October 2026, after version 2.31.0 was deployed and tested live.
Items are grouped by what unblocks them. Strike a line through or delete it
when it is done; the list is meant to reach zero.

## 1. Needs the account owner

- **Connect the vendor clients to the MCP server**, in the agreed order: Claude.ai, ChatGPT, Amazon Quick
  (web), Amazon Quick Desktop. Each needs the owner's account. For every client:
  1. Take `McpUrl`, `McpClientId`, `McpAuthorizeUrl`, `McpTokenUrl` from
     `aws cloudformation describe-stacks --stack-name CitationAnalysisMcpStack --query 'Stacks[0].Outputs'`.
  2. Add the client's redirect URL to `-c mcpRedirectUris` (JSON array or comma-separated; the default
     `http://localhost:5173/oauth/callback` must stay in the list for Kiro) and redeploy the MCP stack only:
     `npx cdk deploy CitationAnalysisMcpStack --exclusively -c mcpRedirectUris='["http://localhost:5173/oauth/callback","<client redirect>"]'`.
     Cognito matches callback URLs exactly.
  3. Enter the client id as a public client (no secret). Scopes are the ones in the metadata document
     (`McpResourceMetadataUrl`): `openid`, `<McpUrl>/read`, `<McpUrl>/write`, `<McpUrl>/run`.
  4. Prove one read tool (`list_keyword_groups`) and one scoped read (`get_visibility` for a group).

  Things to watch, in order of likelihood:
  - Cognito's discovery document omits `code_challenge_methods_supported`. The MCP spec tells clients to
    refuse in that case; Kiro proceeds with S256 anyway (logged). A client that refuses cannot be fixed on
    our side without putting another authorization server in front of Cognito.
  - Amazon Quick's manual OAuth form has no scope field; confirm it reads `scopes_supported` from the metadata.
    Its redirect URL is shown on the Create integration form.
  - ChatGPT reportedly caps tool definitions at 5,000 tokens; `tools/list` measured about 2,150, so this
    should pass. Measure again after adding a direct tool.
  - Quick Desktop OAuth support is unverified; the fallback would be the personal-key route (not built, see §3).
- **Decide the demo brand configuration.** The global brand configuration was swapped for the demo brand on
  7 October; the pre-demo configuration is backed up locally (path recorded in `docs/geo-insights-roadmap.md`).
  Restore it with a `put-item` of the backup's `Item`, or keep the demo configuration while the demo runs.
- **Four-engine sample.** Claude is enabled again (2.30.1 proved the key); run the demo keyword group once more so
  the insights and the Phase 2 heatmap rest on four engines, not three.
- In Kiro, `/mcp logout citation-analysis` drops the cached token of the deleted test user `mcp-test@example.com`.
  The token expires within the hour anyway.

## 2. Follow-ups found during 2.30.1 / 2.31.0

- `_claude_result` in `lambda/api/manage-providers.py` reads any non-authentication 400 from Anthropic as "key
  accepted", so a Claude key with no credit still saves silently; only the model check (run when a provider is
  switched on, or a model saved) detects an exhausted balance. Fix: treat the credit-balance error text as a
  failure in the key probe too.
- The Keyword Deep Dive report calls the Action Center recommendations without a scope. `useRecommendations`
  now takes one; pass the report's keyword scope so the recommendations match the page (optional, small).
- `ruff format --check` is not a gate and the tree does not conform (16 files in `lambda/mcp` alone). Either
  adopt it (one formatting commit, then add it to `scripts/validate-python.sh`) or leave it out deliberately.
- Insight thresholds (`ENGINE_TOP1_MIN`, `ENGINE_CITED_MIN`, `SUBBRAND_*`, `UNSTABLE_POSITION_RANGE` in
  `lambda/shared/insights_engine.py`) were set from one keyword group. Owner decision: review once three groups
  have weekly data.

## 3. Planned, not built (from the roadmap)

MCP server, in priority order:

- **Run tools** behind the `<McpUrl>/run` scope (start an analysis, read run status). The scope exists on the
  resource server and in the metadata document; no operation uses it yet.
- **`CitationAnalysis-McpState` table**: single-use confirmation tokens for spend operations and per-caller rate
  counters. Connector hosts do not support MCP elicitation, so a spend confirmation has to be a two-step tool
  flow (estimate → token → execute).
- **Spend guard** for the operations that cost provider or Bedrock money (runs, Content Studio, research,
  self-reflection), built on the table above. The dashboard's own routes stay ungated by owner decision.
- **Personal-key route `/mcp-key`** (hashed, expiring, read and write only) for header-only clients such as
  Quick Desktop. A method takes one authorizer, hence a second route with a Lambda REQUEST authorizer.
- Catalogue growth: the 18 operations cover the read tabs and keyword management; Content Studio, research
  jobs, schedules, alerts, users and provider settings are not exposed.

Report insights:

- **Phase 1 leftover**: the `caveat` insight kind (competitor caveats: at least 30% mixed or negative sentiment
  over at least 5 mentions, with up to three stored reasons). `CAVEAT_SHARE_MIN` / `CAVEAT_MIN_MENTIONS` are
  named in the roadmap and unused.
- **Phase 2**: `kpi_engine.Answer` gains `cited_urls`; brand configuration gains `competitor_domains` (suggested
  by `find_competitors`, confirmed by an admin); `GET /api/visibility/sentiment-examples` gains `classification`;
  new facts and sections: prompt × engine heatmap, who the engines cite (owned, per competitor, third party),
  most-cited owned pages grouped by host and first path segment with documents flagged, competitor caveats.
- **Phase 3**: `GenerateInsights` workflow state after `KpiAlerts` (with a `Catch`), one Bedrock call per fully
  covered group on the `ANALYSIS` role, validator that drops items citing unknown insight ids or numbers not in
  the evidence, storage in `CitationAnalysis-ReportInsights`, narrative in the group's keyword language,
  regenerate behind a confirmation dialog. The endpoint already reserves `narrative: null` for it.

## 4. Verified live, for the record

So nobody re-tests these by hand: anonymous `POST /mcp` answers 401 with the `WWW-Authenticate`
`resource_metadata` pointer; the metadata document lists the four scopes; Managed Login renders with the
Cognito default branding; the PKCE code exchange returns an access token with `aud` = `McpUrl` when the client
sends `resource`; `initialize`, `tools/list` (11 tools), direct tools, `search_tools` → `describe_tool` →
`call_tool`, `manage_keywords` (write), unknown-tool and bad-argument errors all behave; a token issued for the
old scopes is refused by the authorizer; the figures the tools return equal the dashboard API's. Kiro CLI
connected three ways: `kiro-cli chat` with an MCP-only agent, `kiro-cli acp` driven by a JSON-RPC client
(`/tmp/mcp-test/acp_oauth_client.py`, local scratch), and a full OAuth sign-in Kiro negotiated itself with
`oauth.clientId`. The insights endpoint produced four insights for the demo group on live data.
