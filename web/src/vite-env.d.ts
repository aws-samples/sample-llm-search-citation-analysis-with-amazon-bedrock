/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_USER_POOL_ID: string
  readonly VITE_USER_POOL_CLIENT_ID: string
  /** Injected at build time from package.json via vite `define`. */
  readonly VITE_APP_VERSION: string
  /** `McpUrl` output of `CitationAnalysisMcpStack`; unset when the MCP stack is not deployed. */
  readonly VITE_MCP_URL?: string
  /** `McpClientId` output of `CitationAnalysisMcpStack`; unset when the MCP stack is not deployed. */
  readonly VITE_MCP_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
