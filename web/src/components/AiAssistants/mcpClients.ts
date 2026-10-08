/**
 * How each AI assistant connects to the MCP server: the steps, the values to
 * paste and the OAuth callback it signs in through. The source of truth is
 * `docs/mcp.md` (Clients); keep the two in step.
 */
import type { McpConfig } from './mcpConfig';

type SnippetLanguage = 'bash' | 'json' | 'text';

export interface ConfigSnippet {
  readonly label: string;
  readonly value: string;
  readonly language: SnippetLanguage;
  /** Offer the value as a file download under this name. */
  readonly downloadName?: string;
}

export interface ClientCallback {
  /** The OAuth callback URLs the client signs in through. */
  readonly urls: readonly string[];
  /** True when the stack allows them without `mcpRedirectUris` (`DEFAULT_REDIRECT_URIS` in `lib/mcp-stack.ts`). */
  readonly allowedByDefault: boolean;
}

export interface ClientGuide {
  readonly steps: readonly string[];
  readonly snippets: readonly ConfigSnippet[];
  readonly callback: ClientCallback;
  readonly notes: readonly string[];
}

export type McpClientKey = 'claude' | 'claude-code' | 'chatgpt' | 'kiro' | 'quick' | 'other';

interface McpClient {
  readonly id: McpClientKey;
  readonly label: string;
  readonly guide: (config: McpConfig) => ClientGuide;
}

/** The name every snippet registers the server under. */
const SERVER_NAME = 'citation-analysis';
const KIRO_CALLBACK = 'http://localhost:5173/oauth/callback';
const CLAUDE_CODE_CALLBACK = 'http://localhost:5173/callback';
/** Mirrors `DEFAULT_REDIRECT_URIS` in `lib/mcp-stack.ts`. */
const DEFAULT_CALLBACKS = [KIRO_CALLBACK, CLAUDE_CODE_CALLBACK];
const SIGN_IN_STEP = 'Save, then connect and sign in with your dashboard email and password.';

function snippet(label: string, value: string, language: SnippetLanguage = 'text'): ConfigSnippet {
  return {
    label,
    value,
    language,
  };
}

function callback(urls: readonly string[], allowedByDefault: boolean): ClientCallback {
  return {
    urls,
    allowedByDefault,
  };
}

/** The server URL and client id, plus (for manual OAuth forms) a discovery document under the host root and the scopes. */
function connectionSnippets(config: McpConfig, discovery?: {
  readonly label: string;
  readonly path: string 
}): ConfigSnippet[] {
  const basics = [snippet('Server URL', config.url), snippet('OAuth client ID', config.clientId)];
  if (discovery === undefined) return basics;
  const origin = config.url.replace(/\/mcp\/?$/, '');
  const scopes = ['read', 'write', 'run'].map((scope) => `${config.url}/${scope}`);
  return [...basics, snippet(discovery.label, `${origin}${discovery.path}`), snippet('Scopes', ['openid', ...scopes].join(' '))];
}

export function buildClaudeCodeCommand(config: McpConfig): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${config.url} --client-id ${config.clientId} --callback-port 5173`;
}

export function buildKiroMcpJson(config: McpConfig): string {
  const oauth = {
    clientId: config.clientId,
    redirectUri: KIRO_CALLBACK,
  };
  const servers = {
    mcpServers: {
      [SERVER_NAME]: {
        url: config.url,
        oauth 
      } 
    } 
  };
  return `${JSON.stringify(servers, null, 2)}\n`;
}

/** The deploy command that allows extra callbacks; the value replaces the list, so it keeps the defaults. */
export function buildRedirectUrisCommand(extraCallbacks: readonly string[]): string {
  const uris = JSON.stringify([...DEFAULT_CALLBACKS, ...extraCallbacks]);
  return `npx cdk deploy CitationAnalysisMcpStack \\\n  -c mcpRedirectUris='${uris}'`;
}

const claudeGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'In claude.ai or Claude Desktop, open Settings › Connectors and choose Add custom connector.',
    'Enter a name (for example Citation Analysis) and the server URL below.',
    'Open Advanced settings, paste the OAuth client ID below and leave the client secret empty.',
    SIGN_IN_STEP,
  ],
  snippets: connectionSnippets(config),
  callback: callback(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'], false),
  notes: [
    'Claude Desktop uses the same connector as claude.ai, so you add it once.',
    'Claude signs in through either callback, depending on the domain you opened it from, so allow both.',
  ],
});

const claudeCodeGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'Run the command below in a terminal.',
    'In Claude Code, run /mcp (or run claude mcp login citation-analysis in the terminal) and sign in.',
  ],
  snippets: [snippet('Terminal', buildClaudeCodeCommand(config), 'bash')],
  callback: callback([CLAUDE_CODE_CALLBACK], true),
  notes: [
    'Claude Code finds the sign-in server on its own. If you set oauth.authServerMetadataUrl for an earlier server URL, remove it.',
  ],
});

const chatGptGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'In ChatGPT, open Settings › Security and login and turn on Developer mode.',
    'Create a connector with the server URL below and set authentication to OAuth.',
    'Under Advanced OAuth settings, paste the client ID below and leave the client secret empty.',
    SIGN_IN_STEP,
  ],
  snippets: connectionSnippets(config),
  callback: callback(['https://chatgpt.com/connector_platform_oauth_redirect'], false),
  notes: ['If the connector form shows a different redirect URI, allow that one instead.'],
});

const kiroGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'Add the server below to .kiro/settings/mcp.json (or to an agent\'s mcpServers), or download the file.',
    'The first time Kiro connects, it opens the sign-in page in your browser and then stores the token.',
  ],
  snippets: [{
    ...snippet('mcp.json', buildKiroMcpJson(config), 'json'),
    downloadName: 'mcp.json' 
  }],
  callback: callback([KIRO_CALLBACK], true),
  notes: ['The same entry works in the Kiro IDE and the Kiro CLI.'],
});

const quickGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'In Amazon Quick, open Integrations › MCP and add a server with the server URL below.',
    'Choose to configure OAuth manually: paste the client ID below and set the client type to Public (no client secret).',
    'Open the authorization server metadata below and copy authorization_endpoint into Authorization URL and token_endpoint into Token URL.',
    'Paste the scopes below, note the redirect URL the form shows, and ask an administrator to allow it.',
    SIGN_IN_STEP,
  ],
  snippets: connectionSnippets(config, {
    label: 'Authorization server metadata',
    path: '/.well-known/openid-configuration',
  }),
  callback: callback(['https://<region>.quicksight.aws.amazon.com/sn/oauthcallback'], false),
  notes: [
    'Read tools are marked read-only, so Quick\'s scheduled agents can run them unattended.',
    'Amazon Quick Desktop is not verified yet. If it offers the same OAuth form, use the same values; if it accepts only a static header, it cannot connect.',
  ],
});

const otherGuide = (config: McpConfig): ClientGuide => ({
  steps: [
    'Use a client that supports remote MCP servers over Streamable HTTP with OAuth 2.1 and PKCE.',
    'Dynamic client registration is not offered: enter the client ID below and leave the client secret empty.',
    'The client finds the sign-in server through the protected resource metadata below.',
    'Ask an administrator to allow the callback URL your client signs in through.',
  ],
  snippets: connectionSnippets(config, {
    label: 'Protected resource metadata',
    path: '/.well-known/oauth-protected-resource/mcp',
  }),
  callback: callback(['<your client\'s callback URL>'], false),
  notes: ['OpenAI Codex CLI is not supported yet (openai/codex#30460).'],
});

const client = (id: McpClientKey, label: string, guide: McpClient['guide']): McpClient => ({
  id,
  label,
  guide,
});

export const MCP_CLIENTS: readonly McpClient[] = [
  client('claude', 'Claude (claude.ai / Desktop)', claudeGuide),
  client('claude-code', 'Claude Code', claudeCodeGuide),
  client('chatgpt', 'ChatGPT', chatGptGuide),
  client('kiro', 'Kiro', kiroGuide),
  client('quick', 'Amazon Quick', quickGuide),
  client('other', 'Other / Codex', otherGuide),
];
