# Pending work

Open work on the Citation Analysis sample: connecting the remaining MCP clients, reviewing insight thresholds once
real data accumulates, and features to build only if a client needs them.

Checked against the code on 8 November 2026 (version 2.43.1). Version 2.33.1 was deployed to a test account on 7 October 2026 and proven from Kiro and Claude Code. Report insights Phases 1–3 and the MCP server
(discovery, read, write and spend tools, limits, audit, prompts) are implemented; what is left needs an account owner,
real data over time, or a client that has not been tried yet. Delete a line when it is done; the list is meant to
reach zero.

## 1. Needs the account owner

- **Connect the web vendor clients to the MCP server**: Claude.ai, ChatGPT, Amazon Quick (web), Amazon Quick
  Desktop. Each needs the owner's account. Steps per client are in [mcp.md](mcp.md): take the stack outputs, add the
  client's redirect URL to `-c mcpRedirectUris` (keep the defaults for Kiro and Claude Code), redeploy the MCP stack
  only, enter the client id as a public client, and prove one read tool and one scoped read. Since 2.33.1 discovery
  works the way these clients expect (host-root metadata behind CloudFront, PKCE advertised); Kiro and Claude Code
  already connect this way. Things to watch: Amazon Quick's manual OAuth form has no scope field (confirm it reads
  `scopes_supported`); Quick Desktop's OAuth support is unverified (if it cannot do OAuth, build the personal-key
  route in §3).
- **Decide the demo brand configuration.** The global brand configuration was swapped for the demo brand on 7 October;
  the pre-demo configuration is backed up locally (its path was recorded in `docs/geo-insights-roadmap.md`, which is no
  longer in the repository; ask the owner for it). Restore it with a
  `put-item` of the backup's `Item`, or keep the demo configuration while the demo runs.

- **Codex CLI.** It rewrites the redirect URI with a per-server callback id (`http://127.0.0.1/callback/<id>`,
  openai/codex#30460), which Cognito's exact callback matching rejects. Either wait for the upstream fix or register
  the exact URL Codex writes into `~/.codex/config.toml` (`[mcp_servers.<name>.oauth] callback_url`) with
  `-c mcpRedirectUris`, pinned to a port with `-c mcp_oauth_callback_port=<port>`.

## 2. Needs data over time

- **Review the insight thresholds** (`ENGINE_TOP1_MIN`, `ENGINE_CITED_MIN`, `SUBBRAND_*`, `UNSTABLE_POSITION_RANGE`,
  `CAVEAT_*`, `PROMPT_TOP_POSITION`, `LEAD_HIGH_*` in `lambda/shared/insights_engine.py`). They were set from one
  keyword group; owner decision: review once three groups have weekly data.
- **Watch the narrative drop rate.** The GenerateInsights step stores how many model items the validator dropped
  (`dropped`, shown under the *Written insights* block). A high rate on real runs means the prompt in
  `lambda/report-insights/handler.py` needs tightening, not the validator loosening.

## 3. Built only if a client needs it

- **Personal-key route `/mcp-key`** (hashed, expiring, read and write only, no spend) for header-only clients such as
  Amazon Quick Desktop, if it proves unable to do OAuth. A method takes one authorizer, hence a second route with a
  Lambda REQUEST authorizer. Not built on purpose: long-lived keys are the riskiest addition and no tested client needs
  them.
- **Dynamic client registration.** Not needed by any client tried (Kiro, Claude Code take a pre-registered client id);
  only a client that supports nothing else would justify a registration façade.

## 4. Decided against, for the record

- `ruff format` as a gate: it would rewrite 609 of the 623 Python files (`ruff format --check .`, 8 November 2026). If adopted, do it as a separate formatting-only change with a
  `.git-blame-ignore-revs` file, not inside a feature change.
- A CloudWatch alarm or custom metric on MCP refusals: no fixed monthly cost in this sample; the refusals are in the
  structured audit log lines and in `CitationAnalysis-McpState`.

## 5. Constraint to keep in mind

- `CitationAnalysisStack` is at 497 of CloudFormation's 500 resources (`cdk.out/CitationAnalysisStack.template.json`, synth of 2.43.1 on 8 November 2026). The next sizeable addition goes into another
  stack (as the MCP server did), not into the main one.
