import {
  describe, it, expect
} from 'vitest';
import {
  collectRefTargets,
  extractTableKeySchema,
  extractTableProperty,
} from '../citation-analysis-stack-fixtures';
import { DEFAULT_MCP_LIMITS, MCP_STATE_TABLE_NAME } from './mcp-state';
import {
  extractGrantedActions,
  extractStateEnvVars,
  limitsFromContext,
  synthesizeMcpState,
} from './mcp-state-fixtures';

const { template } = synthesizeMcpState();

describe('McpState table', () => {
  it('keys items by string pk and sk', () => {
    expect(extractTableKeySchema(template, MCP_STATE_TABLE_NAME)).toStrictEqual([
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ]);
  });

  it('bills on demand, so it adds no fixed monthly cost', () => {
    expect(extractTableProperty(template, MCP_STATE_TABLE_NAME, 'BillingMode')).toBe('PAY_PER_REQUEST');
  });

  it('expires tokens, counters and audit records through the ttl attribute', () => {
    expect(extractTableProperty(template, MCP_STATE_TABLE_NAME, 'TimeToLiveSpecification')).toStrictEqual({
      AttributeName: 'ttl', Enabled: true,
    });
  });

  it('is retained when the stack is deleted', () => {
    const tables = template.findResources('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });

    expect(Object.keys(tables)).toHaveLength(1);
  });
});

describe('grantTo', () => {
  it('allows the item operations state.py performs and nothing else', () => {
    expect(extractGrantedActions(template)).toStrictEqual([
      'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem',
    ]);
  });

  it('passes the table name as MCP_STATE_TABLE', () => {
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];

    expect(collectRefTargets(extractStateEnvVars(template).MCP_STATE_TABLE)).toStrictEqual([tableId]);
  });

  it('passes the default limits as MCP_LIMITS', () => {
    expect(extractStateEnvVars(template).MCP_LIMITS).toBe(
      '{"runsInFlight":1,"runsPerDay":5,"jobsPerDay":20,"maxRunKeywords":50}'
    );
  });

  it('passes overridden limits from the mcpLimits context', () => {
    const { template: overridden } = synthesizeMcpState({ mcpLimits: '{"runsPerDay":2}' });

    expect(JSON.parse(String(extractStateEnvVars(overridden).MCP_LIMITS))).toStrictEqual({ ...DEFAULT_MCP_LIMITS, runsPerDay: 2 });
  });
});

describe('readMcpLimits', () => {
  it('keeps the defaults without the context', () => {
    expect(limitsFromContext(undefined)).toStrictEqual({ runsInFlight: 1, runsPerDay: 5, jobsPerDay: 20, maxRunKeywords: 50 });
  });

  it('accepts an object from cdk.json', () => {
    expect(limitsFromContext({ jobsPerDay: 0, maxRunKeywords: 10 })).toStrictEqual({
      ...DEFAULT_MCP_LIMITS, jobsPerDay: 0, maxRunKeywords: 10,
    });
  });

  it('accepts a JSON string from the command line', () => {
    expect(limitsFromContext('{"runsInFlight":2}').runsInFlight).toBe(2);
  });

  it('refuses an unknown limit by name', () => {
    expect(() => limitsFromContext({ runsPerWeek: 3 })).toThrow("unknown limit 'runsPerWeek'");
  });

  it.each([-1, 1.5, '3', null])('refuses the value %s', (value) => {
    expect(() => limitsFromContext({ runsPerDay: value })).toThrow("'runsPerDay' must be a whole number >= 0");
  });

  it('refuses a value that is not a JSON object', () => {
    expect(() => limitsFromContext('[1]')).toThrow("CDK context 'mcpLimits': expected a JSON object");
  });

  it('refuses malformed JSON', () => {
    expect(() => limitsFromContext('{runsPerDay:2')).toThrow('expected a JSON object, got {runsPerDay:2');
  });
});
