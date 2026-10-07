import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  McpServer, type McpServerInputs, readMcpContextList
} from './constructs/mcp-server';
import { McpState, readMcpLimits } from './constructs/mcp-state';
import { pythonLayer } from './constructs/python-layer';

/**
 * The local callbacks allowed when `mcpRedirectUris` is not set: Kiro's pinned
 * `oauth.redirectUri` and Claude Code's `--callback-port 5173`
 * (`http://localhost:<port>/callback`). Web clients' callbacks are added per deployment.
 */
export const DEFAULT_REDIRECT_URIS = ['http://localhost:5173/oauth/callback', 'http://localhost:5173/callback'];

export interface CitationAnalysisMcpStackProps extends cdk.StackProps {
  /** The main stack's `mcpInputs`. */
  readonly inputs: McpServerInputs;
}

/**
 * A sibling of `CitationAnalysisStack` holding the MCP server, its own REST
 * API and the CloudFront distribution in front of it (the server's host root
 * for OAuth discovery). Separate because the main stack sits at CloudFormation's 500-resource
 * limit, and because the server's API, authorizer and Cognito client are a
 * self-contained unit that can be removed without touching the dashboard.
 *
 * The server's shared layer is this stack's own version of the same build
 * output (`lambda/layer/`), not the main stack's: a cross-stack layer reference
 * would block every main-stack deploy that rebuilds the layer.
 *
 * Context: `mcpRedirectUris` (the MCP clients' OAuth callback URLs, exact match
 * in Cognito) and `mcpPinnedTools` (catalogue operations listed as direct
 * tools), each a JSON array or a comma-separated string, and `mcpLimits` (the
 * spend tools' per-caller limits, a JSON object; see `constructs/mcp-state.ts`).
 */
export class CitationAnalysisMcpStack extends cdk.Stack {
  public readonly server: McpServer;

  constructor(scope: Construct, id: string, props: CitationAnalysisMcpStackProps) {
    super(scope, id, props);

    const sharedLayer = pythonLayer(this, 'SharedLayer', {
      directory: 'layer',
      label: 'Shared',
      layerVersionName: 'CitationAnalysis-McpSharedLayer',
      description: 'Shared Python code and dependencies for the Citation Analysis MCP server',
    });

    const state = new McpState(this, 'McpState', { limits: readMcpLimits(this) });

    this.server = new McpServer(this, 'McpServer', {
      ...props.inputs,
      sharedLayer,
      state,
      redirectUris: readMcpContextList(this, 'mcpRedirectUris', DEFAULT_REDIRECT_URIS),
      pinnedTools: readMcpContextList(this, 'mcpPinnedTools', []),
      domainPrefix: `citation-analysis-${this.account}`,
    });
  }
}
