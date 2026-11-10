import {
  describe, expect, it
} from 'vitest';
import { synthesizeDashboardStacks } from './api-stack-fixtures';
import {
  allowStatementsOfRole,
  extractDistributedMapNames,
  extractFunctionMemorySize,
  extractFunctionRoleActions,
  extractFunctionRoleActionsOn,
  extractFunctionStatesStatements,
  extractFunctionTimeout,
  extractLambdaEnvVars,
  extractStateMachineStates,
  extractTableProperty,
  findFunctionRoleLogicalId,
  findLambdaLogicalId,
  resolvePath,
} from './citation-analysis-stack-fixtures';

/**
 * The scope snapshots of 2.45.0 (design-complete-scopes §2, §4 "Main agent"): the
 * KeywordRunBrands table, the writers' and the builder's environment and grants,
 * and every Lambda that serves a scoped view from the snapshots.
 */
const stacks = synthesizeDashboardStacks('ScopeSnapshots');
const template = stacks.mainTemplate;
const keywordRunBrandsId = Object.keys(template.findResources('AWS::DynamoDB::Table', {
  Properties: { TableName: 'CitationAnalysis-KeywordRunBrands' },
}))[0] ?? '';
const keywordRunKpisId = Object.keys(template.findResources('AWS::DynamoDB::Table', {
  Properties: { TableName: 'CitationAnalysis-KeywordRunKpis' },
}))[0] ?? '';
const generateSummaryId = findLambdaLogicalId(template, 'CitationAnalysis-GenerateSummary');
const deduplicationId = findLambdaLogicalId(template, 'CitationAnalysis-Deduplication');

const READERS = [
  'CitationAnalysis-API-StatsInsights',
  'CitationAnalysis-API-CitationsContent',
  'CitationAnalysis-API-GetBrandMentions',
  'CitationAnalysis-API-ConfigMgmt',
  'CitationAnalysis-API-KeywordMgmt',
  'CitationAnalysis-API-ContentStudio',
  'CitationAnalysis-ReportInsights',
];

describe('KeywordRunBrands table', () => {
  it('keys every brand row by keyword and run, like KeywordRunKpis', () => {
    expect(extractTableProperty(template, 'CitationAnalysis-KeywordRunBrands', 'KeySchema')).toStrictEqual([
      { AttributeName: 'keyword', KeyType: 'HASH' },
      { AttributeName: 'run_timestamp', KeyType: 'RANGE' },
    ]);
  });

  it('bills the brand rows on demand', () => {
    expect(extractTableProperty(template, 'CitationAnalysis-KeywordRunBrands', 'BillingMode')).toBe('PAY_PER_REQUEST');
  });
});

describe('Deduplication writes the KeywordLatest objects', () => {
  const environment = extractLambdaEnvVars(template, 'CitationAnalysis-Deduplication');

  it('is told the snapshot bucket, the brand table, the personas and the crawl table', () => {
    expect(Object.keys(environment)).toStrictEqual(expect.arrayContaining([
      'SCOPE_SNAPSHOT_BUCKET', 'DYNAMODB_TABLE_KEYWORD_RUN_BRANDS', 'DYNAMODB_TABLE_QUERY_PROMPTS', 'DYNAMODB_TABLE_CRAWLED_CONTENT',
    ]));
  });

  it('is told the builder a finished latest backfill starts', () => {
    expect(environment).toHaveProperty('SCOPE_SNAPSHOT_FUNCTION_NAME');
  });

  it('may only put KeywordRunBrands rows', () => {
    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-Deduplication', keywordRunBrandsId)).toStrictEqual(['dynamodb:PutItem']);
  });

  it('may list the KeywordLatest prefix, so a keyword with no object yet reads as missing instead of AccessDenied', () => {
    const listing = allowStatementsOfRole(template, findFunctionRoleLogicalId(template, 'CitationAnalysis-Deduplication'))
      .filter((statement) => JSON.stringify(resolvePath(statement, ['Action'])).includes('s3:ListBucket'));

    expect(listing.map((statement) => resolvePath(statement, ['Condition']))).toStrictEqual([
      { StringLike: { 's3:prefix': ['scope-snapshots/keywords/*'] } },
    ]);
  });

  it('may invoke the builder', () => {
    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-Deduplication', generateSummaryId)).toStrictEqual(['lambda:InvokeFunction']);
  });
});

describe('GenerateSummary builds the snapshots and runs the view jobs', () => {
  const environment = extractLambdaEnvVars(template, 'CitationAnalysis-GenerateSummary');

  it('is told the bucket, the history tables, the personas and SearchResults', () => {
    expect(Object.keys(environment)).toStrictEqual(expect.arrayContaining([
      'SCOPE_SNAPSHOT_BUCKET', 'DYNAMODB_TABLE_KEYWORD_RUN_KPIS', 'DYNAMODB_TABLE_KEYWORD_RUN_BRANDS',
      'DYNAMODB_TABLE_QUERY_PROMPTS', 'DYNAMODB_TABLE_SEARCH_RESULTS',
    ]));
  });

  it('reads the history of both per-run tables', () => {
    expect([
      extractFunctionRoleActionsOn(template, 'CitationAnalysis-GenerateSummary', keywordRunKpisId),
      extractFunctionRoleActionsOn(template, 'CitationAnalysis-GenerateSummary', keywordRunBrandsId),
    ]).toStrictEqual([['dynamodb:Query'], ['dynamodb:Query']]);
  });

  it('can abort the multipart upload of an export it could not finish', () => {
    expect(extractFunctionRoleActions(template, 'CitationAnalysis-GenerateSummary')).toContain('s3:Abort*');
  });

  it('gives GenerateSummary 1769 MB (one vCPU, owner decision 2026-11-07); the rollup and the large snapshot builds run on the distributed build worker', () => {
    expect([
      extractFunctionMemorySize(template, 'CitationAnalysis-GenerateSummary'),
      extractFunctionTimeout(template, 'CitationAnalysis-GenerateSummary'),
    ]).toStrictEqual([1769, 900]);
  });

  it('is told the distributed build state machine', () => {
    expect(environment).toHaveProperty('SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN');
  });

  it('may only start and list executions of the build state machine', () => {
    expect(extractFunctionStatesStatements(template, 'CitationAnalysis-GenerateSummary')).toStrictEqual([{
      actions: ['states:ListExecutions', 'states:StartExecution'],
      resources: [environment.SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN],
    }]);
  });

  it('may invoke itself, so a series build that ran out of time resumes', () => {
    const selfInvoke = allowStatementsOfRole(template, findFunctionRoleLogicalId(template, 'CitationAnalysis-GenerateSummary'))
      .filter((statement) => JSON.stringify(resolvePath(statement, ['Resource'])).includes(':function:CitationAnalysis-GenerateSummary'));

    expect(selfInvoke.map((statement) => resolvePath(statement, ['Action']))).toStrictEqual(['lambda:InvokeFunction']);
  });
});

describe('Every provider search Lambda reads back the answers of its run', () => {
  const searchResultsId = Object.keys(template.findResources('AWS::DynamoDB::Table', {
    Properties: { TableName: 'CitationAnalysis-SearchResults' },
  }))[0] ?? '';

  it('may query SearchResults, so a retried keyword asks no provider twice (stored_slim_results)', () => {
    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-Search-openai', searchResultsId)).toContain('dynamodb:Query');
  });
});

describe('The distributed scope snapshot and citation rollup build', () => {
  const states = extractStateMachineStates(template, 'CitationAnalysis-ScopeSnapshotBuild');

  it('gives the build worker 1769 MB (one vCPU, owner decision 2026-11-07): measured 10x peak <= 606 MB heap + runtime', () => {
    expect(extractFunctionMemorySize(template, 'CitationAnalysis-ScopeSnapshotWorker')).toBe(1769);
  });

  it('runs the rollup shard and merge Maps beside the fold units and series', () => {
    expect(extractDistributedMapNames(template, 'CitationAnalysis-ScopeSnapshotBuild'))
      .toStrictEqual(['FoldUnits', 'RollupMerges', 'RollupShards', 'SeriesBatches']);
  });

  it('catches every failure of the plan, the build and the publish into one Fail state', () => {
    expect(['PlanSnapshotBuild', 'BuildSnapshotsAndRollup', 'PublishSnapshotBuild'].map((name) => resolvePath(states[name], ['Catch'])))
      .toStrictEqual(Array.from({ length: 3 }, () => [{ ErrorEquals: ['States.ALL'], Next: 'ScopeSnapshotBuildFailed', ResultPath: '$.error' }]));
  });

  it('ends a failed build with nothing published', () => {
    expect(states.ScopeSnapshotBuildFailed).toStrictEqual({
      Type: 'Fail',
      Error: 'ScopeSnapshotBuildFailed',
      Cause: 'Nothing published: both current.json files still name the previous builds',
    });
  });

  it('publishes only after the plan and the parallel build', () => {
    expect([resolvePath(states.PlanSnapshotBuild, ['Next']), resolvePath(states.BuildSnapshotsAndRollup, ['Next'])])
      .toStrictEqual(['BuildSnapshotsAndRollup', 'PublishSnapshotBuild']);
  });
});

describe('KpiAlerts pools the per-run KPI rows', () => {
  it('is told the KeywordRunKpis table', () => {
    expect(extractLambdaEnvVars(template, 'CitationAnalysis-KpiAlerts')).toHaveProperty('DYNAMODB_TABLE_KEYWORD_RUN_KPIS');
  });

  it('may only batch-get those rows', () => {
    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', keywordRunKpisId)).toStrictEqual(['dynamodb:BatchGetItem']);
  });
});

describe.each(READERS)('%s serves scoped views from the snapshots', (functionName) => {
  it('is told the bucket, the builder and the personas table', () => {
    expect(Object.keys(extractLambdaEnvVars(template, functionName))).toStrictEqual(expect.arrayContaining([
      'SCOPE_SNAPSHOT_BUCKET', 'SCOPE_SNAPSHOT_FUNCTION_NAME', 'DYNAMODB_TABLE_QUERY_PROMPTS',
    ]));
  });

  it('may invoke the builder for rebuilds and view jobs', () => {
    expect(extractFunctionRoleActionsOn(template, functionName, generateSummaryId)).toStrictEqual(['lambda:InvokeFunction']);
  });

  it('may read snapshot objects and put and delete its rebuild marker and view jobs', () => {
    expect(extractFunctionRoleActions(template, functionName)).toStrictEqual(expect.arrayContaining(['s3:GetObject', 's3:PutObject', 's3:DeleteObject']));
  });

  it('may list the snapshot prefix, so a view job not computed yet reads as missing instead of AccessDenied', () => {
    const listing = allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName))
      .filter((statement) => JSON.stringify(resolvePath(statement, ['Action'])).includes('s3:ListBucket'))
      .map((statement) => resolvePath(statement, ['Condition']));

    expect(listing).toContainEqual({ StringLike: { 's3:prefix': ['scope-snapshots/*'] } });
  });
});

describe.each(['CitationAnalysis-API-ManageBrandConfig', 'CitationAnalysis-API-ConfigMgmt'])('%s starts the KeywordLatest backfill', (functionName) => {
  it('is told the Deduplication Lambda', () => {
    expect(extractLambdaEnvVars(template, functionName)).toHaveProperty('KEYWORD_LATEST_BACKFILL_FUNCTION');
  });

  it('may invoke it', () => {
    expect(extractFunctionRoleActionsOn(template, functionName, deduplicationId)).toStrictEqual(['lambda:InvokeFunction']);
  });
});
