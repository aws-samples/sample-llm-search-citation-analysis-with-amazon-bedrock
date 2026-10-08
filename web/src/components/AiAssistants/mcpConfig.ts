/** The MCP server a client connects to: the `CitationAnalysisMcpStack` outputs baked in at build time. */
export interface McpConfig {
  /** `McpUrl`, e.g. `https://<dist>.cloudfront.net/mcp`; empty when the MCP stack is not deployed. */
  readonly url: string;
  /** `McpClientId`: the pre-registered public OAuth client (no secret). */
  readonly clientId: string;
}

/** Reads the MCP stack outputs `scripts/build-web.sh` exports as `VITE_MCP_*`. */
export function readMcpConfig(): McpConfig {
  return {
    url: (import.meta.env.VITE_MCP_URL ?? '').trim(),
    clientId: (import.meta.env.VITE_MCP_CLIENT_ID ?? '').trim(),
  };
}

/** Both values are needed by every client, so a half-configured build counts as not deployed. */
export function isMcpDeployed(config: McpConfig): boolean {
  return config.url !== '' && config.clientId !== '';
}
