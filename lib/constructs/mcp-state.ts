import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * `CitationAnalysis-McpState`: the MCP server's own state (`lambda/mcp/state.py`).
 * Single-use spend confirmation tokens (5 minutes), the per-caller UTC-day
 * counters and run-start lock, the runs a caller started (for the in-flight
 * check) and the audit records of write and spend tool calls (365 days). One
 * on-demand table with string keys `pk` / `sk` and TTL attribute `ttl`, so it
 * adds no fixed monthly cost.
 */

export const MCP_STATE_TABLE_NAME = 'CitationAnalysis-McpState';
const MCP_LIMITS_CONTEXT = 'mcpLimits';

/** Per-caller limits of the spend tools; the keys of the `mcpLimits` CDK context and of `MCP_LIMITS`. */
export interface McpLimits {
  /** Analysis runs a caller may have running at once. */
  readonly runsInFlight: number;
  /** Analysis runs a caller may start per UTC day. */
  readonly runsPerDay: number;
  /** Keyword research and Content Studio jobs a caller may start per UTC day (one shared count). */
  readonly jobsPerDay: number;
  /** Keywords one `start_run` may cover. */
  readonly maxRunKeywords: number;
}

export const DEFAULT_MCP_LIMITS: McpLimits = {
  runsInFlight: 1,
  runsPerDay: 5,
  jobsPerDay: 20,
  maxRunKeywords: 50,
};

/** The item operations `state.py` performs; no Scan and no batch writes. */
const STATE_ACTIONS = [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:Query',
];

/** Thrown at synth time when `-c mcpLimits=...` is not usable. */
class InvalidMcpLimitsError extends Error {
  constructor(message: string) {
    super(`CDK context '${MCP_LIMITS_CONTEXT}': ${message}`);
    this.name = 'InvalidMcpLimitsError';
  }
}

function contextObject(raw: unknown): Record<string, unknown> {
  const decoded: unknown = typeof raw === 'string' ? decodeJson(raw) : raw;
  if (typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)) {
    return Object.fromEntries(Object.entries(decoded));
  }
  throw new InvalidMcpLimitsError(`expected a JSON object, got ${JSON.stringify(raw)}`);
}

function decodeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidMcpLimitsError(`expected a JSON object, got ${raw}`);
  }
}

function limitValue(key: string, value: unknown): number {
  if (!(key in DEFAULT_MCP_LIMITS)) {
    throw new InvalidMcpLimitsError(`unknown limit '${key}' (known: ${Object.keys(DEFAULT_MCP_LIMITS).join(', ')})`);
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new InvalidMcpLimitsError(`'${key}' must be a whole number >= 0, got ${JSON.stringify(value)}`);
}

/**
 * The spend limits: the defaults, overridden per deployment with
 * `-c mcpLimits='{"runsPerDay":10}'` (a JSON string on the command line, or an
 * object in cdk.json). Unknown keys and values that are not whole numbers >= 0
 * fail synth rather than silently keep a default. `0` turns the spend off.
 */
export function readMcpLimits(scope: Construct): McpLimits {
  const raw: unknown = scope.node.tryGetContext(MCP_LIMITS_CONTEXT);
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MCP_LIMITS;
  const overrides = Object.fromEntries(
    Object.entries(contextObject(raw)).map(([key, value]) => [key, limitValue(key, value)])
  );
  return { ...DEFAULT_MCP_LIMITS, ...overrides };
}

export interface McpStateProps {
  /** Defaults to `DEFAULT_MCP_LIMITS`; pass `readMcpLimits(stack)` to honour the context. */
  readonly limits?: McpLimits;
}

export class McpState extends Construct {
  public readonly table: dynamodb.Table;
  public readonly limits: McpLimits;

  constructor(scope: Construct, id: string, props: McpStateProps = {}) {
    super(scope, id);
    this.limits = props.limits ?? DEFAULT_MCP_LIMITS;
    // Retained like the main stack's tables, so a stack teardown keeps the audit records. No
    // point-in-time recovery: tokens and counters live minutes to days, and every audit line is
    // also in the function's log group.
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: MCP_STATE_TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }

  /** Lets `serverFunction` use the table (item operations only) and tells it the table name and the limits. */
  public grantTo(serverFunction: lambda.Function): void {
    this.table.grant(serverFunction, ...STATE_ACTIONS);
    serverFunction.addEnvironment('MCP_STATE_TABLE', this.table.tableName);
    serverFunction.addEnvironment('MCP_LIMITS', JSON.stringify(this.limits));
  }
}
