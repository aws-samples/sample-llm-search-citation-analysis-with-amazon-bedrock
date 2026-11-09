import {
  describe, expect, it
} from 'vitest';
import { synthesizeDashboardStacks } from './api-stack-fixtures';
import { COGNITO_AUTH, methodRouteLabels, resolvePath } from './citation-analysis-stack-fixtures';
import {
  extractExportServiceSnapshot, readViewJobEventNames, referencedLogicalIds, resourcesGranting
} from './export-jobs-fixtures';

/**
 * The export service of 2.45.0 (every view's "Export all"): the Exports
 * table, the `CitationAnalysis-Export` state machine and its worker, the
 * `/api/exports` Lambda and routes, their least-privilege grants and the
 * 7-day expiry of the files. One synthesis of the main and API stacks.
 */
const snapshot = extractExportServiceSnapshot(synthesizeDashboardStacks('ExportService'));
const { states } = snapshot;
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const EXPORTS_OBJECTS = /^\{"Fn::Join":\["",\[\{"Fn::GetAtt":\["KeywordsBucket\w+","Arn"\]\},"\/exports\/\*"\]\]\}$/;
const SPILLED_RESPONSES = /"\/api-responses\/\*"\]\]\}$/;
const CATCH_ALL_TO_MARK_FAILED = [{ errors: ['States.ALL'], next: 'MarkExportFailed', resultPath: '$.error' }];
/** A view job runs at most 900 s, and a computing status that old is dead: the wait covers any live job. */
const VIEW_JOB_WAIT_SECONDS = 960;
const EXPORT_STATE_MACHINE_ARN_SUFFIX = /:stateMachine\/?:?CitationAnalysis-Export"\]\]\}$/;
const SERVICE_EXCEPTIONS = [
  'Lambda.ClientExecutionTimeoutException', 'Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException',
];

const ROUTER_FUNCTION_NAMES: Record<string, string> = {
  'stats-insights': 'CitationAnalysis-API-StatsInsights',
  'citations-content': 'CitationAnalysis-API-CitationsContent',
  'keyword-mgmt': 'CitationAnalysis-API-KeywordMgmt',
  'config-mgmt': 'CitationAnalysis-API-ConfigMgmt',
  'brand-mentions': 'CitationAnalysis-API-GetBrandMentions',
  'persona-rankings': 'CitationAnalysis-API-GetPersonaRankings',
  'content-studio': 'CitationAnalysis-API-ContentStudio',
  users: 'CitationAnalysis-API-ManageUsers',
};
/** The SEO stack's router, named in this stack (the SEO stack deploys after it, so it has no logical id here). */
const SEO_ROUTER_FUNCTION_NAME = 'CitationAnalysis-SeoRouter';
const routerLogicalIds = Object.values(ROUTER_FUNCTION_NAMES)
  .map((name) => snapshot.functionLogicalIds[name])
  .sort((left, right) => left.localeCompare(right));
const workerFunctionsJson = JSON.stringify(snapshot.workerEnvironment.EXPORT_API_FUNCTIONS);

describe('Export state machine', () => {
  it('prepares the export, then writes chunks until every row is written, then finalizes', () => {
    expect(snapshot.startAt).toBe('PrepareExport');
    expect(states.PrepareExport.next).toBe('ExportChunk');
    expect(states.ExportChunk.next).toBe('AllRowsWritten');
    expect(states.AllRowsWritten).toMatchObject({
      type: 'Choice',
      choices: [
        { Variable: '$.done', BooleanEquals: true, Next: 'FinalizeExport' },
        { Variable: '$.view_job', IsPresent: true, Next: 'WaitForViewJob' },
      ],
      defaultState: 'ExportChunk',
    });
  });

  it('has no Wait state: nothing waits a while and re-checks a view job', () => {
    expect(Object.values(states).filter((state) => state.type === 'Wait')).toStrictEqual([]);
  });

  it('waits for a computing view job on a task token the worker registers against the job run', () => {
    expect(states.WaitForViewJob).toMatchObject({
      type: 'Task',
      resource: expect.stringMatching(/:states:::lambda:invoke\.waitForTaskToken$/),
      parameters: {
        action: 'wait_view_job', 'export_id.$': '$.export_id', 'view_job.$': '$.view_job', 'task_token.$': '$$.Task.Token',
      },
      resultPath: null,
      next: 'ExportChunk',
    });
  });

  it('gives up waiting for the event after the longest a view job can run', () => {
    expect(states.WaitForViewJob.timeoutSeconds).toBe(VIEW_JOB_WAIT_SECONDS);
  });

  it('runs the chunk once more when the wait times out, and fails the export on any other error of the wait', () => {
    expect(states.WaitForViewJob.catch).toStrictEqual([
      { errors: ['States.Timeout'], next: 'ExportChunkAfterViewJobWait', resultPath: null },
      ...CATCH_ALL_TO_MARK_FAILED,
    ]);
  });

  it('tells the chunk after a timed-out wait which job it waited on, then goes on as after any chunk', () => {
    expect(states.ExportChunkAfterViewJobWait).toMatchObject({
      parameters: { action: 'chunk', 'export_id.$': '$.export_id', 'timed_out_job.$': '$.view_job.id' },
      next: 'AllRowsWritten',
      catch: CATCH_ALL_TO_MARK_FAILED,
    });
  });

  it('sends each step its action and the execution export id', () => {
    expect([states.PrepareExport, states.ExportChunk, states.FinalizeExport].map((state) => state.parameters)).toStrictEqual([
      { action: 'prepare', 'export_id.$': '$.export_id' },
      { action: 'chunk', 'export_id.$': '$.export_id' },
      { action: 'finalize', 'export_id.$': '$.export_id' },
    ]);
  });

  it('catches any error of prepare, chunk and finalize into MarkExportFailed with the error', () => {
    expect([states.PrepareExport, states.ExportChunk, states.FinalizeExport].map((state) => state.catch)).toStrictEqual([
      CATCH_ALL_TO_MARK_FAILED, CATCH_ALL_TO_MARK_FAILED, CATCH_ALL_TO_MARK_FAILED,
    ]);
  });

  it('marks the export failed with the caught error, then fails the execution', () => {
    expect(states.MarkExportFailed.parameters).toStrictEqual({ action: 'fail', 'export_id.$': '$.export_id', 'error.$': '$.error' });
    expect(states.MarkExportFailed.next).toBe('ExportFailed');
    expect(states.ExportFailed.type).toBe('Fail');
  });

  it('retries every step on Lambda service exceptions and throttling', () => {
    expect(['PrepareExport', 'ExportChunk', 'ExportChunkAfterViewJobWait', 'WaitForViewJob', 'FinalizeExport', 'MarkExportFailed']
      .map((name) => states[name].retry.slice(0, 2)))
      .toStrictEqual(Array(6).fill([
        { errors: SERVICE_EXCEPTIONS, maxAttempts: 6 },
        { errors: ['Lambda.TooManyRequestsException'], maxAttempts: 6 },
      ]));
  });

  it('resumes a chunk killed by its timeout once from its checkpoint, and no other step', () => {
    expect([states.ExportChunk.retry[2], states.ExportChunkAfterViewJobWait.retry[2]]).toStrictEqual(Array(2).fill(
      { errors: ['Lambda.Unknown'], maxAttempts: 1 }
    ));
    expect(['PrepareExport', 'WaitForViewJob', 'FinalizeExport', 'MarkExportFailed'].map((name) => states[name].retry)).not.toContainEqual(
      expect.arrayContaining([expect.objectContaining({ errors: ['Lambda.Unknown'] })])
    );
  });

  it('runs up to seven days, the life of the export item', () => {
    expect(snapshot.timeoutSeconds).toBe(SEVEN_DAYS_IN_SECONDS);
  });

  it('may invoke only the export worker', () => {
    expect(referencedLogicalIds(snapshot.stateMachineRoleStatements, 'lambda:InvokeFunction')).toStrictEqual([snapshot.workerLogicalId]);
  });
});

describe('Resuming exports on view-job.finished', () => {
  const { viewJobRule } = snapshot;
  const target = (viewJobRule.Targets as Record<string, unknown>[] | undefined)?.[0] ?? {};

  it('matches the event the view jobs publish, by the names both languages share', () => {
    const names = readViewJobEventNames();

    expect(viewJobRule.EventPattern).toStrictEqual({ source: [names.source], 'detail-type': [names.detailType] });
  });

  it('listens on the default bus', () => {
    expect(viewJobRule.EventBusName).toBeUndefined();
  });

  it('invokes the export worker with the job run and its status', () => {
    expect(JSON.stringify(target.Arn)).toContain(snapshot.workerLogicalId);
    expect(target.InputTransformer).toStrictEqual({
      InputPathsMap: { 'detail-job_id': '$.detail.job_id', 'detail-started_at': '$.detail.started_at', 'detail-status': '$.detail.status' },
      InputTemplate: '{"action":"view_job_finished","job_id":<detail-job_id>,"started_at":<detail-started_at>,"status":<detail-status>}',
    });
  });

  it('stops retrying the delivery of an event to the worker once the waiting exports have timed out anyway', () => {
    expect(target.RetryPolicy).toStrictEqual({ MaximumEventAgeInSeconds: VIEW_JOB_WAIT_SECONDS, MaximumRetryAttempts: 4 });
  });

  it('retries a resume that raised twice, within the same bound (EventBridge invokes the worker asynchronously)', () => {
    expect(snapshot.workerAsyncInvoke).toStrictEqual([{ retryAttempts: 2, maxEventAgeSeconds: VIEW_JOB_WAIT_SECONDS }]);
  });

  it('lets EventBridge invoke the worker for this rule only', () => {
    expect(snapshot.workerInvokePermissions).toStrictEqual([
      { principal: 'events.amazonaws.com', sourceArn: expect.stringContaining('ViewJobFinishedRule') },
    ]);
  });

  it('lets the worker answer task tokens of the export state machine only', () => {
    expect(['states:SendTaskSuccess', 'states:SendTaskFailure'].map((action) => resourcesGranting(snapshot.workerStatements, action)))
      .toStrictEqual(Array(2).fill([expect.stringMatching(EXPORT_STATE_MACHINE_ARN_SUFFIX)]));
    expect(snapshot.workerStatements.flatMap((statement) => statement.actions).filter((action) => action.startsWith('states:')))
      .toStrictEqual(['states:SendTaskSuccess', 'states:SendTaskFailure']);
  });

  it('lets GenerateSummary publish to the default bus under the view jobs source, in its one PutEvents statement', () => {
    const publishing = snapshot.generateSummaryStatements.filter((statement) => statement.actions.includes('events:PutEvents'));

    expect(publishing.map((statement) => statement.actions)).toStrictEqual([['events:PutEvents']]);
    expect(resolvePath(JSON.parse(publishing[0].conditions ?? 'null'), ['StringEquals', 'events:source']))
      .toContain(readViewJobEventNames().source);
    expect(publishing[0].resources).toMatch(/:event-bus\/default"\]\]\}$/);
  });
});

describe('Export worker', () => {
  /** 2.45.0 owner decision (2026-11-07): one vCPU, so the XLSX writing and deflate of a chunk run at full speed. */
  it('runs a chunk for the Lambda maximum with 1769 MB', () => {
    expect([snapshot.workerTimeout, snapshot.workerMemory]).toStrictEqual([900, 1769]);
  });

  it('is told the jobs table, the bucket, the API routers it replays the views against and the user pool', () => {
    expect(Object.keys(snapshot.workerEnvironment)).toStrictEqual([
      'DYNAMODB_TABLE_EXPORTS', 'EXPORTS_BUCKET', 'EXPORT_API_FUNCTIONS', 'USER_POOL_ID',
    ]);
  });

  /** F12: Prepare re-reads an Admin-only export's owner's groups; without the pool id it fails closed. */
  it('is told the id of the dashboard user pool', () => {
    expect(snapshot.workerEnvironment.USER_POOL_ID).toStrictEqual({ Ref: expect.stringMatching(/^AuthuserPool/) });
  });

  it('may list the groups of a user of the dashboard user pool only', () => {
    expect(referencedLogicalIds(snapshot.workerStatements, 'cognito-idp:AdminListGroupsForUser')).toStrictEqual([
      expect.stringMatching(/^AuthuserPool/),
    ]);
  });

  it('is granted no other Cognito action', () => {
    expect(snapshot.workerStatements.flatMap((statement) => statement.actions)
      .filter((action) => action.startsWith('cognito-idp:'))).toStrictEqual(['cognito-idp:AdminListGroupsForUser']);
  });

  it('names every router the row sources read by its router key, the SEO router last', () => {
    expect([...workerFunctionsJson.matchAll(/\\"([a-z-]+)\\":\\"/g)].map((match) => match[1]))
      .toStrictEqual([...Object.keys(ROUTER_FUNCTION_NAMES), 'seo']);
  });

  it('may invoke exactly the dashboard routers of this stack', () => {
    expect(referencedLogicalIds(snapshot.workerStatements, 'lambda:InvokeFunction').filter((id) => !id.startsWith('AWS::')))
      .toStrictEqual(routerLogicalIds);
  });

  it('may invoke the SEO router by its name', () => {
    expect(JSON.stringify(resourcesGranting(snapshot.workerStatements, 'lambda:InvokeFunction')))
      .toContain(`:function:${SEO_ROUTER_FUNCTION_NAME}`);
  });

  it('reads and writes objects only under exports/', () => {
    expect(['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:AbortMultipartUpload']
      .flatMap((action) => resourcesGranting(snapshot.workerStatements, action))
      .filter((resources) => !EXPORTS_OBJECTS.test(resources))).toStrictEqual([]);
  });

  it('reads no application table: the views come through the routers', () => {
    expect(snapshot.workerStatements.filter((statement) => statement.actions.some((action) => action.startsWith('dynamodb:')))
      .map((statement) => statement.actions)).toStrictEqual([['dynamodb:GetItem', 'dynamodb:PutItem']]);
    expect(referencedLogicalIds(snapshot.workerStatements, 'dynamodb:GetItem')).toStrictEqual([
      expect.stringMatching(/^ExportsTable/),
    ]);
  });
});

describe('Exports API Lambda', () => {
  it('serves exports.py with the state machine to start', () => {
    expect(snapshot.apiHandler).toBe('exports.handler');
    expect(snapshot.apiEnvironment.EXPORT_STATE_MACHINE_ARN).toStrictEqual({ Ref: snapshot.stateMachineLogicalId });
  });

  it('presigns, deletes and aborts only under exports/', () => {
    expect(['s3:DeleteObject', 's3:AbortMultipartUpload']
      .flatMap((action) => resourcesGranting(snapshot.apiStatements, action))
      .filter((resources) => !EXPORTS_OBJECTS.test(resources))).toStrictEqual([]);
    expect(resourcesGranting(snapshot.apiStatements, 's3:GetObject')
      .filter((resources) => !EXPORTS_OBJECTS.test(resources) && !SPILLED_RESPONSES.test(resources))).toStrictEqual([]);
  });

  it('starts executions of the export state machine only', () => {
    expect(resourcesGranting(snapshot.apiStatements, 'states:StartExecution')).toStrictEqual([
      JSON.stringify({ Ref: snapshot.stateMachineLogicalId }),
    ]);
  });

  it('stops only executions of the export state machine', () => {
    const resources = resourcesGranting(snapshot.apiStatements, 'states:StopExecution');

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatch(/:execution:CitationAnalysis-Export:\*"\]\]\}$/);
  });

  it('reads and writes only the jobs table and its owner index', () => {
    expect(referencedLogicalIds(snapshot.apiStatements, 'dynamodb:Query')).toStrictEqual([expect.stringMatching(/^ExportsTable/)]);
    expect(resourcesGranting(snapshot.apiStatements, 'dynamodb:Query')[0]).toContain('/index/OwnerCreatedIndex');
  });
});

describe('Exports table', () => {
  it('keys jobs by export id and indexes them by owner and creation time', () => {
    expect(snapshot.table.KeySchema).toStrictEqual([{ AttributeName: 'export_id', KeyType: 'HASH' }]);
    expect(snapshot.table.GlobalSecondaryIndexes).toStrictEqual([{
      IndexName: 'OwnerCreatedIndex',
      KeySchema: [{ AttributeName: 'owner', KeyType: 'HASH' }, { AttributeName: 'created_at', KeyType: 'RANGE' }],
      Projection: { ProjectionType: 'ALL' },
    }]);
  });

  it('expires items at expires_at', () => {
    expect(snapshot.table.TimeToLiveSpecification).toStrictEqual({ AttributeName: 'expires_at', Enabled: true });
  });

  it('keeps point-in-time recovery and survives a stack teardown like every table', () => {
    expect(snapshot.table.PointInTimeRecoverySpecification).toStrictEqual({ PointInTimeRecoveryEnabled: true });
    expect(snapshot.tableDeletionPolicy).toBe('Retain');
  });
});

describe('Export files lifecycle', () => {
  it('expires exports/ after seven days and aborts abandoned uploads after one', () => {
    expect(snapshot.exportsLifecycleRule).toStrictEqual({
      Id: 'ExpireExports',
      Status: 'Enabled',
      Prefix: 'exports/',
      ExpirationInDays: 7,
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    });
  });
});

describe('Export routes', () => {
  it('serves start, list, read, cancel or delete, and mark seen', () => {
    expect(methodRouteLabels(snapshot.exportRoutes)).toStrictEqual([
      'GET /api/exports', 'POST /api/exports', 'GET /api/exports/{id}', 'DELETE /api/exports/{id}', 'POST /api/exports/{id}/seen',
    ]);
  });

  it('puts every export route behind the Cognito authorizer', () => {
    expect(snapshot.exportRoutes.filter((route) => route.authorizationType !== COGNITO_AUTH)).toStrictEqual([]);
  });
});

describe('Resource budgets with the export service', () => {
  it('keeps the main stack within 350 resources', () => {
    expect(snapshot.mainResourceCount).toBeLessThanOrEqual(350);
  });

  it('keeps the API stack within 400 resources', () => {
    expect(snapshot.apiResourceCount).toBeLessThanOrEqual(400);
  });
});
