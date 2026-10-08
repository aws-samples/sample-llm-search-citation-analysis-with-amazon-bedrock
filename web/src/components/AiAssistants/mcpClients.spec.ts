import {
  describe, expect, it 
} from 'vitest';
import {
  buildClaudeCodeCommand, buildKiroMcpJson, buildRedirectUrisCommand, MCP_CLIENTS
} from './mcpClients';
import { isMcpDeployed } from './mcpConfig';
import {
  FAKE_MCP_CONFIG, UNDEPLOYED_MCP_CONFIG 
} from './mcpConfig-fixtures';

describe('buildClaudeCodeCommand', () => {
  it('adds the server over HTTP with the client id and the default callback port', () => {
    expect(buildClaudeCodeCommand(FAKE_MCP_CONFIG)).toBe(
      'claude mcp add --transport http citation-analysis https://d111example.cloudfront.net/mcp --client-id example-public-client --callback-port 5173',
    );
  });
});

describe('buildKiroMcpJson', () => {
  it('is valid JSON with the server URL and the OAuth client id and redirect URI from docs/mcp.md', () => {
    expect(JSON.parse(buildKiroMcpJson(FAKE_MCP_CONFIG))).toStrictEqual({
      mcpServers: {
        'citation-analysis': {
          url: 'https://d111example.cloudfront.net/mcp',
          oauth: {
            clientId: 'example-public-client',
            redirectUri: 'http://localhost:5173/oauth/callback' 
          },
        },
      },
    });
  });
});

describe('buildRedirectUrisCommand', () => {
  it('keeps the default local callbacks ahead of the extra ones', () => {
    expect(buildRedirectUrisCommand(['https://chatgpt.com/connector_platform_oauth_redirect'])).toBe(
      'npx cdk deploy CitationAnalysisMcpStack \\\n  -c mcpRedirectUris=\'["http://localhost:5173/oauth/callback","http://localhost:5173/callback","https://chatgpt.com/connector_platform_oauth_redirect"]\'',
    );
  });
});

describe('MCP_CLIENTS', () => {
  it('lists the assistants in picker order', () => {
    expect(MCP_CLIENTS.map((client) => client.id)).toStrictEqual(['claude', 'claude-code', 'chatgpt', 'kiro', 'quick', 'other']);
  });

  it.each(MCP_CLIENTS.map((client) => [client.id, client]))('fills the server URL and the client id into the %s snippets', (_id, client) => {
    const values = client.guide(FAKE_MCP_CONFIG).snippets.map((snippet) => snippet.value).join('\n');

    expect(values).toContain('https://d111example.cloudfront.net/mcp');
    expect(values).toContain('example-public-client');
  });

  it('derives the Amazon Quick authorization server metadata from the server host root', () => {
    const quick = MCP_CLIENTS.find((client) => client.id === 'quick');
    const labels = quick?.guide(FAKE_MCP_CONFIG).snippets.map((snippet) => [snippet.label, snippet.value]);

    expect(labels).toContainEqual(['Authorization server metadata', 'https://d111example.cloudfront.net/.well-known/openid-configuration']);
  });

  it('names one scope per server permission for Amazon Quick', () => {
    const quick = MCP_CLIENTS.find((client) => client.id === 'quick');
    const scopes = quick?.guide(FAKE_MCP_CONFIG).snippets.find((snippet) => snippet.label === 'Scopes');

    expect(scopes?.value).toBe(
      'openid https://d111example.cloudfront.net/mcp/read https://d111example.cloudfront.net/mcp/write https://d111example.cloudfront.net/mcp/run',
    );
  });

  it('marks only Kiro and Claude Code as working with the default callbacks', () => {
    const byDefault = MCP_CLIENTS.filter((client) => client.guide(FAKE_MCP_CONFIG).callback.allowedByDefault);

    expect(byDefault.map((client) => client.id)).toStrictEqual(['claude-code', 'kiro']);
  });
});

describe('isMcpDeployed', () => {
  it('is false when the build has no MCP stack outputs', () => {
    expect(isMcpDeployed(UNDEPLOYED_MCP_CONFIG)).toBe(false);
  });

  it('is false when only the server URL is set', () => {
    expect(isMcpDeployed({
      ...FAKE_MCP_CONFIG,
      clientId: '' 
    })).toBe(false);
  });

  it('is true when both the server URL and the client id are set', () => {
    expect(isMcpDeployed(FAKE_MCP_CONFIG)).toBe(true);
  });
});
