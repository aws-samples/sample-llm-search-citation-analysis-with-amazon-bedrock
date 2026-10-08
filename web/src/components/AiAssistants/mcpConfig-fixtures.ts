import type { McpConfig } from './mcpConfig';

export const FAKE_MCP_CONFIG = {
  url: 'https://d111example.cloudfront.net/mcp',
  clientId: 'example-public-client',
} satisfies McpConfig;

export const UNDEPLOYED_MCP_CONFIG = {
  url: '',
  clientId: '',
} satisfies McpConfig;
