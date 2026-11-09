import * as cdk from 'aws-cdk-lib';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cxapi from 'aws-cdk-lib/cx-api';
import * as path from 'path';
import * as fs from 'fs';
import { Auth } from './constructs/auth';
import { BedrockModelAccess } from './constructs/bedrock-model-access';
import { KpiWriteFailureAlarm } from './constructs/kpi-write-failure-alarm';
import {
  ProviderSearch, providerSearchEnvironment, EXTERNAL_SEARCH_PROVIDERS, readProviderConcurrency, readProviderPacing
} from './constructs/provider-search';
import { WEB_SEARCH_GATEWAY_URL_PARAMETER, readWebSearchRegion, webSearchPolicyStatement } from './constructs/web-search';
import type { McpServerInputs } from './constructs/mcp-server';
import type { SeoStackInputs } from './seo-stack';
import { BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME } from './constructs/seo-backlinks';
import { SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE } from './constructs/seo-domain';
import { RANK_TRACKER_SCHEDULE_GROUP } from './constructs/seo-rank-tracking';
import { SEO_ROUTER_FUNCTION_NAME } from './constructs/seo-api';
import { lambdaSourceCode, pythonLayer } from './constructs/python-layer';
import { DASHBOARD_API_PARAMETERS, RUNTIME_CONFIG_OBJECT_KEY } from './api-stack';
import { DASHBOARD_API_FUNCTION_NAMES, type DashboardApiFunctions } from './constructs/rest-api';
import {
  apiFunction, apiLambdaCode, monthLogGroup, pythonFunction, type PythonFunctionProps
} from './constructs/api-functions';
import { citationAnalysisTable, stringKey, type CitationAnalysisIndexSpec } from './constructs/tables';
import { citationAnalysisBucket } from './constructs/buckets';
import {
  allow, allowWhere, apiKeySecret, lambdaServiceRole
} from './constructs/permissions';
import { MCP_STATE_TABLE_NAME, grantAuditPut } from './constructs/mcp-state';
import { allowSavedBedrockModels, bedrockTierEnv, claudeInvokeModelStatement } from './constructs/bedrock-invoke';

/**
 * Bound concurrent Content Studio model calls without reserving API capacity.
 * DynamoDB Streams retries failed records, while this worker ceiling limits
 * both account-wide contention and accidental model spend.
 */
const CONTENT_STUDIO_WORKER_FUNCTION_NAME = 'CitationAnalysis-ContentStudioWorker';
const CONTENT_STUDIO_WORKER_CONCURRENCY = 10;
const CONTENT_STUDIO_STREAM_RETRY_ATTEMPTS = 2;
const CONTENT_STUDIO_STREAM_MAX_RECORD_AGE_MINUTES = 60;
const CONTENT_STUDIO_RECONCILE_INTERVAL_MINUTES = 5;

/**
 * Memory of the CPU-bound read routers and the per-group insights worker: one
 * full vCPU (owner decision, 2026-11-07). CPU is allocated in proportion to
 * memory, and these deserialize thousands of DynamoDB rows per request. AWS
 * Lambda Power Tuning of the read-only GET routes (balanced, 10 invocations
 * per power) chose 1280 MB for /citations, /searches and /brand-mentions and
 * 768-1024 MB for StatsInsights' single-keyword routes; one vCPU keeps margin
 * above that for live scopes up to `shared/scope_source.LIVE_ROWS_BUDGET` (the
 * window row cap of `shared/scoped_reports.py` scales with this size). The
 * 30-day CloudWatch REPORT audit
 * found no function at 60% of its peak memory.
 */
const TUNED_READ_MEMORY_MB = 1769;

/**
 * Budget of one keyword research execution. The API's reader-side stale
 * sweep (`shared/research_jobs.RESEARCH_STALE_AFTER_SECONDS`, 65 minutes)
 * must stay ABOVE this so a live job can never be marked failed and then
 * flip back when it finishes. 60 minutes: an agent job runs up to 3 rounds of
 * plan, steps (two 120 s HTTP calls plus backoff) and evaluate, ~16 minutes
 * worst case each, which ran into the old 30-minute limit.
 */
const RESEARCH_STATE_MACHINE_TIMEOUT_MINUTES = 60;

/**
 * Parallel provider steps per research job. Each step is one web-search LLM
 * call; three providers are configured today, so this is headroom for the
 * multi-round research agent rather than a limit anyone hits.
 */
const RESEARCH_STEP_CONCURRENCY = 10;

/** Name of the analysis state machine; its role policies format ARNs from it to avoid a self-reference. */
const WORKFLOW_STATE_MACHINE_NAME = 'CitationAnalysis-Workflow';

/**
 * Keywords-bucket prefix for per-run scratch objects: ParseKeywords' keyword
 * manifest and the ProcessKeywords ResultWriter output. Expired after
 * `WORKFLOW_RUNS_RETENTION_DAYS`.
 */
const WORKFLOW_RUNS_PREFIX = 'runs/';
const WORKFLOW_RUNS_RETENTION_DAYS = 30;

/**
 * Key prefix of the citation rollup in the keywords bucket
 * (`shared/citation_rollup.py`): per-scope manifests and pages that
 * GET /api/citations serves without scanning the Citations table. Written by
 * GenerateSummary after each run and on request by CitationsContent.
 */
const CITATION_ROLLUP_PREFIX = 'citation-rollups/';

/**
 * Key prefix of the scope snapshots in the keywords bucket (design 2.45.0,
 * `shared/scope_snapshot.py`): one KeywordLatest object per keyword
 * (`keywords/`, written by Deduplication), the per-scope builds and series
 * (written by GenerateSummary's BuildScopeSnapshots) and the view jobs
 * (`jobs/`, results and export files, expired after
 * `SCOPE_SNAPSHOT_JOB_RETENTION_DAYS`).
 */
const SCOPE_SNAPSHOT_PREFIX = 'scope-snapshots/';
const SCOPE_SNAPSHOT_JOBS_PREFIX = `${SCOPE_SNAPSHOT_PREFIX}jobs/`;
const SCOPE_SNAPSHOT_JOB_RETENTION_DAYS = 7;

/**
 * Keywords-bucket prefix for API responses too large for Lambda's 6 MiB cap
 * (`lambda/shared/response_spill.py` SPILL_PREFIX). Each object is read once,
 * through a 5-minute presigned URL, so a day is ample.
 */
const API_RESPONSE_SPILL_PREFIX = 'api-responses/';
const API_RESPONSE_SPILL_RETENTION_DAYS = 1;

/**
 * The export service (2.45.0, `shared/export_steps.py`): every view's
 * "Export all" file and its checkpoints live under
 * `exports/<owner>/<export_id>/` in the keywords bucket, and the job item
 * expires after the same 7 days (`shared/export_contract.EXPORT_RETENTION_DAYS`).
 */
const EXPORTS_PREFIX = 'exports/';
const EXPORT_RETENTION_DAYS = 7;
export const EXPORTS_TABLE_NAME = 'CitationAnalysis-Exports';
export const EXPORT_STATE_MACHINE_NAME = 'CitationAnalysis-Export';
/**
 * An export runs until its rows are written: each ExportChunk invocation
 * writes until its own deadline and loops, ~4 history events per chunk, so
 * thousands of chunks fit the 25,000-event limit. Seven days only stops a
 * truly stuck export; the job item is gone by then anyway.
 */
const EXPORT_STATE_MACHINE_TIMEOUT_DAYS = 7;
/** One chunk runs for the Lambda maximum; it stops 60 s before (`export-worker/handler.py`). */
const EXPORT_WORKER_TIMEOUT_SECONDS = 900;
/**
 * The `view-job.finished` event (2.49.0, `shared/view_job_events.py`): a view
 * job publishes it to the default bus once its outcome is stored, and the
 * export state machine resumes on it.
 */
export const VIEW_JOB_EVENT_SOURCE = 'citation-analysis.view-jobs';
export const VIEW_JOB_FINISHED_DETAIL_TYPE = 'view-job.finished';
/**
 * How long WaitForViewJob waits for that event before it runs ExportChunk
 * once more (an event lost): a view job runs in GenerateSummary for at most
 * 900 s, and a computing status that old counts as dead
 * (`shared/view_jobs.py` JOB_STALE_SECONDS), so 960 s covers any live job.
 */
const EXPORT_VIEW_JOB_WAIT_SECONDS = 960;

/**
 * Analysis workflow budget. Measured: ~1.9 minutes per keyword at the old
 * ProcessKeywords concurrency of 3 with providers called in sequence (32
 * keywords took 62 minutes), so the old 2-hour timeout ended runs at ~60
 * keywords and 1,000 keywords needed ~32 hours at that rate.
 * Seven days is headroom rather than a target: every task is already bounded
 * by its Lambda timeout and retries, so this only stops a run that is truly stuck.
 */
const WORKFLOW_TIMEOUT_DAYS = 7;

/**
 * Share of ProcessKeywords child executions (one per keyword) that may fail
 * before the Distributed Map fails the run. Isolated failures — one keyword
 * whose search exhausted its retries — must not discard a 1,000-keyword run;
 * GenerateSummary reports them as failed keywords. Above 10% the cause is
 * systemic (a dead provider key, throttling, a bad deploy), so the run stops
 * instead of spending on every remaining keyword.
 */
const PROCESS_KEYWORDS_TOLERATED_FAILURE_PERCENTAGE = 10;

/**
 * A Step Functions or stream worker. Its log group is `DESTROY`: these groups
 * were created by the stack from the start, and their short-lived debug
 * output is not worth keeping past the stack. The handler defaults to the
 * `handler.handler` every worker directory exposes.
 */
function workerFunction(
  scope: Construct,
  name: string,
  props: Omit<PythonFunctionProps, 'handler'> & { handler?: string }
): lambda.Function {
  return pythonFunction(
    scope,
    name,
    { ...props, handler: props.handler ?? 'handler.handler' },
    cdk.RemovalPolicy.DESTROY
  );
}

/** What a function serving scoped views reads the scope snapshots with (`shared/scope_snapshot_serve.py`). */
interface ScopeSnapshotReaderInputs {
  bucket: s3.IBucket;
  builder: lambda.IFunction;
  queryPrompts: dynamodb.ITable;
}

/**
 * Let `fn` serve scoped views from the scope snapshots: read the builds,
 * request a debounced rebuild (`rebuild-requested.json`), start and forget
 * view jobs (`jobs/`, on the GenerateSummary Lambda), and count the enabled
 * personas the routing rule needs (QueryPrompts `EnabledIndex`).
 */
function grantScopeSnapshotReader(fn: lambda.Function, inputs: ScopeSnapshotReaderInputs): void {
  fn.addEnvironment('SCOPE_SNAPSHOT_BUCKET', inputs.bucket.bucketName);
  fn.addEnvironment('SCOPE_SNAPSHOT_FUNCTION_NAME', inputs.builder.functionName);
  fn.addEnvironment('DYNAMODB_TABLE_QUERY_PROMPTS', inputs.queryPrompts.tableName);
  allow(fn, ['s3:GetObject'], [inputs.bucket.arnForObjects(`${SCOPE_SNAPSHOT_PREFIX}*`)]);
  allow(fn, ['s3:PutObject'], [
    inputs.bucket.arnForObjects(`${SCOPE_SNAPSHOT_PREFIX}rebuild-requested.json`),
    inputs.bucket.arnForObjects(`${SCOPE_SNAPSHOT_JOBS_PREFIX}*`),
  ]);
  allow(fn, ['s3:DeleteObject'], [inputs.bucket.arnForObjects(`${SCOPE_SNAPSHOT_JOBS_PREFIX}*`)]);
  allow(fn, ['lambda:InvokeFunction'], [inputs.builder.functionArn]);
  allow(fn, ['dynamodb:Query'], [inputs.queryPrompts.tableArn, `${inputs.queryPrompts.tableArn}/index/EnabledIndex`]);
}

/**
 * Keep the exports a 2.44.0 `CitationAnalysisApiStack` imports (CDK's
 * automatic `<stack>:ExportsOutput...` exports of the API Lambdas' ARNs, the
 * user pool ARN, the web bucket name and the distribution id and domain). The
 * API stack no longer imports them (2.45.0 review F11),
 * but `cdk deploy --all` updates this stack first, and CloudFormation refuses
 * to remove an export that the deployed API stack still imports. `exportValue`
 * gives each the same export name as before. Remove this call in the release
 * after 2.45.0: by then every API stack has been updated and imports none of them.
 */
function retainLegacyApiStackExports(stack: cdk.Stack, values: string[]): void {
  for (const value of values) stack.exportValue(value);
}

/** A stack output exported as `CitationAnalysis-<id>`. */
function exportedOutput(scope: Construct, id: string, value: string, description: string): void {
  new cdk.CfnOutput(scope, id, { value, description, exportName: `CitationAnalysis-${id}` });
}

/**
 * A Lambda task whose state output is the function's payload, retried on
 * Lambda service exceptions.
 */
function lambdaStep(
  scope: Construct,
  id: string,
  lambdaFunction: lambda.IFunction,
  payload?: stepfunctions.TaskInput
): tasks.LambdaInvoke {
  return new tasks.LambdaInvoke(scope, id, {
    lambdaFunction,
    payload,
    outputPath: '$.Payload',
    retryOnServiceExceptions: true,
  });
}

/** Thrown at synth time when a CDK context tuning value is not usable. */
class InvalidContextValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContextValueError';
  }
}

/**
 * Read a positive-integer tuning value from CDK context (`-c key=value` or
 * cdk.json), falling back to `fallback` when absent. Rejects anything that is
 * not a whole number >= 1 so a typo cannot silently disable parallelism.
 */
function readPositiveIntegerContext(scope: Construct, key: string, fallback: number): number {
  const raw: unknown = scope.node.tryGetContext(key);
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidContextValueError(`CDK context '${key}' must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Read a non-empty string from CDK context (`-c key=value` or cdk.json),
 * falling back to `fallback` when absent or blank.
 */
function readStringContext(scope: Construct, key: string, fallback: string): string {
  const raw: unknown = scope.node.tryGetContext(key);
  return typeof raw === 'string' && raw.trim() !== '' ? raw : fallback;
}

/**
 * Read a flag from CDK context, defaulting to false. `-c key=true` on the
 * command line arrives as the string `'true'`, while the same key in cdk.json
 * can be a real boolean, so both count.
 */
function readFlagContext(scope: Construct, key: string): boolean {
  const raw: unknown = scope.node.tryGetContext(key);
  return raw === true || raw === 'true';
}

/**
 * Foundation models the stack's Lambdas invoke, as plain model IDs. These are
 * the `global.`-stripped forms of `_TIER_MODELS` in lambda/shared/models.py —
 * the runtime calls the global inference profile, but an AWS Marketplace
 * subscription is per foundation model. Kept in lockstep with that file by a
 * test in lib/citation-analysis-stack.spec.ts.
 */
const CLAUDE_FOUNDATION_MODEL_IDS = [
  'anthropic.claude-haiku-5-5',
  'anthropic.claude-sonnet-5-5',
  'anthropic.claude-opus-5-5',
];

/** `BedrockModelsEnabled` output when provisioning was opted out of. */
const SKIPPED_MODEL_PROVISIONING = 'none (skipModelProvisioning)';

/**
 * Deploy-time Anthropic account enablement: the one-time use-case form and an
 * AWS Marketplace subscription per model. Without it a fresh account's first
 * Converse call fails with "not authorized to perform the required AWS
 * Marketplace actions", because Bedrock creates the subscription just-in-time
 * using the calling Lambda role's permissions.
 *
 * Skipped by `-c skipModelProvisioning=true`. An account whose Anthropic access
 * is granted elsewhere — an organization policy, an AWS-internal account, a
 * platform team that provisions model access separately — gains nothing from
 * the calls and may prefer that no deploy-time role hold
 * `aws-marketplace:Subscribe` at all.
 *
 * Company details on the form are overridable:
 * `cdk deploy -c anthropicCompanyName=...`.
 */
function provisionBedrockModelAccess(stack: cdk.Stack): void {
  const modelAccess = readFlagContext(stack, 'skipModelProvisioning')
    ? undefined
    : new BedrockModelAccess(stack, 'BedrockModelAccess', {
      useCase: {
        companyName: readStringContext(stack, 'anthropicCompanyName', 'Citation Analysis'),
        companyWebsite: readStringContext(stack, 'anthropicCompanyWebsite', 'https://aws.amazon.com/bedrock/'),
        intendedUsers: '0',
        industryOption: readStringContext(stack, 'anthropicIndustry', 'Technology'),
        useCases: readStringContext(
          stack,
          'anthropicUseCases',
          'Summarize content and generate new marketing content.'
        ),
      },
      modelIds: CLAUDE_FOUNDATION_MODEL_IDS,
      modelRegion: stack.region,
    });

  new cdk.CfnOutput(stack, 'BedrockModelsEnabled', {
    value: modelAccess?.subscribedModelIds.join(', ') ?? SKIPPED_MODEL_PROVISIONING,
    description: 'Anthropic models this deployment subscribed for the account',
  });
}

/**
 * A state machine with X-Ray tracing and full execution logging to its own
 * 30-day group at `/aws/vendedlogs/states/<stateMachineName>`.
 *
 * The groups are NEW, unlike the Lambda ones: the state machines ran with
 * `level: OFF`, so nothing was ever written and there is no existing group to
 * collide with. Hence `DESTROY`, matching the workers.
 *
 * `/aws/vendedlogs/states/` is the documented prefix, not cosmetic. Services
 * that deliver logs on your behalf have to name each destination group in a
 * CloudWatch Logs resource policy, and those policies cap at 5120 characters;
 * the vendedlogs prefix is covered by a wildcard instead of consuming budget
 * per group. Exceeding the cap fails as an opaque policy-length error at the
 * moment logging is enabled.
 *
 * Logging was `level: OFF` with `includeExecutionData: false`, so a failed
 * execution left nothing behind to debug: X-Ray tracing shows that a state
 * failed and how long it took, never the payload that caused it. With
 * ProcessKeywords and CrawlCitations both being Maps, "which item failed, and
 * on what input" is the only question worth asking after a failed run — and
 * it was the one question this configuration could not answer
 * (AUDIT-2026-08-19 §2.8).
 *
 * ALL rather than ERROR: on a Map, the interesting evidence is the
 * per-iteration state entry/exit either side of the failure, not just the
 * terminal error. The ingestion cost of that for a workflow that runs on a
 * schedule, capped at 30 days, is a rounding error next to the Bedrock spend
 * it orchestrates.
 *
 * `includeExecutionData` is what actually puts the failing item's input in
 * the log; without it this is only marginally better than OFF. It does mean
 * keyword and citation payloads land in CloudWatch, which is why the group
 * expires them at 30 days.
 *
 * No explicit grant needed: CDK attaches the logs:*LogDelivery /
 * PutResourcePolicy statements to the role when `logs` is set. Do not add
 * them by hand — they will just be duplicated.
 */
function loggedStateMachine(
  scope: Construct,
  id: string,
  spec: {
    logGroupId: string;
    stateMachineName: string;
    definition: stepfunctions.IChainable;
    role: iam.IRole;
    timeout: cdk.Duration;
  }
): stepfunctions.StateMachine {
  const destination = monthLogGroup(
    scope,
    spec.logGroupId,
    `/aws/vendedlogs/states/${spec.stateMachineName}`,
    cdk.RemovalPolicy.DESTROY
  );
  return new stepfunctions.StateMachine(scope, id, {
    stateMachineName: spec.stateMachineName,
    definitionBody: stepfunctions.DefinitionBody.fromChainable(spec.definition),
    role: spec.role,
    timeout: spec.timeout,
    tracingEnabled: true,
    logs: {
      destination,
      level: stepfunctions.LogLevel.ALL,
      includeExecutionData: true,
    },
  });
}

/** What the export service builds on in the main stack. */
interface ExportServiceInputs {
  sharedLayer: lambda.ILayerVersion;
  /** The keywords bucket: export files under `exports/`. */
  bucket: s3.IBucket;
  /**
   * The API Lambdas the row sources replay a view's route against, by router
   * key (`shared/export_source_routes.py` `EXPORT_API_FUNCTIONS`).
   */
  routers: Record<string, lambda.IFunction>;
  /**
   * Prepare re-reads an Admin-only export's owner's groups from this pool
   * (`export-worker/handler.py`, `AdminListGroupsForUser`).
   */
  userPool: IUserPool;
}

/** Retry an export step on Lambda throttling (the service exceptions retry already). */
function retryThrottledExportStep(task: tasks.LambdaInvoke): tasks.LambdaInvoke {
  task.addRetry({
    errors: ['Lambda.TooManyRequestsException'],
    interval: cdk.Duration.seconds(5),
    maxAttempts: 6,
    backoffRate: 2,
  });
  return task;
}

/**
 * A step of the export state machine: one action of the export worker on the
 * execution's `export_id`, retried on Lambda service errors and throttling.
 */
function exportStep(
  scope: Construct,
  id: string,
  worker: lambda.IFunction,
  action: string,
  extra: Record<string, string> = {}
): tasks.LambdaInvoke {
  return retryThrottledExportStep(lambdaStep(scope, id, worker, stepfunctions.TaskInput.fromObject({
    action, 'export_id.$': '$.export_id', ...extra,
  })));
}

/**
 * WaitForViewJob: the worker registers this task's token against the view
 * job run the chunk met (`wait_view_job`, `shared/export_view_job_wait.py`)
 * and the execution pauses until the job's `view-job.finished` event sends
 * the token back (nothing runs or re-checks meanwhile). A failed job sends a
 * task failure, which the catch turns into MarkFailed. The task output is
 * discarded, so the next chunk sees the execution input.
 */
function waitForViewJobStep(scope: Construct, worker: lambda.IFunction): tasks.LambdaInvoke {
  return retryThrottledExportStep(new tasks.LambdaInvoke(scope, 'WaitForViewJob', {
    lambdaFunction: worker,
    integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    payload: stepfunctions.TaskInput.fromObject({
      action: 'wait_view_job',
      'export_id.$': '$.export_id',
      'view_job.$': '$.view_job',
      task_token: stepfunctions.JsonPath.taskToken,
    }),
    resultPath: stepfunctions.JsonPath.DISCARD,
    taskTimeout: stepfunctions.Timeout.duration(cdk.Duration.seconds(EXPORT_VIEW_JOB_WAIT_SECONDS)),
    retryOnServiceExceptions: true,
  }));
}

/**
 * `CitationAnalysis-Export`: Prepare → ExportChunk until every row is
 * written → Finalize. A chunk that met a view job still computing answers
 * the job's run (`view_job`) and the execution waits in WaitForViewJob for
 * the job's event, then runs the next chunk once. When that wait times out
 * (an event lost), ExportChunkAfterViewJobWait runs the chunk once more and
 * fails the export if the same job still computes. Anything that escapes a
 * step runs MarkFailed (abort the upload, mark the export failed) and fails
 * the execution.
 */
function exportStateMachine(scope: Construct, worker: lambda.IFunction): stepfunctions.StateMachine {
  const markFailed = exportStep(scope, 'MarkExportFailed', worker, 'fail', { 'error.$': '$.error' });
  markFailed.next(new stepfunctions.Fail(scope, 'ExportFailed', {
    error: 'ExportFailed',
    cause: 'The export could not be completed; see the export item for the error.',
  }));
  const prepare = exportStep(scope, 'PrepareExport', worker, 'prepare');
  const chunk = exportStep(scope, 'ExportChunk', worker, 'chunk');
  const chunkAfterWait = exportStep(scope, 'ExportChunkAfterViewJobWait', worker, 'chunk', { 'timed_out_job.$': '$.view_job.id' });
  const finalize = exportStep(scope, 'FinalizeExport', worker, 'finalize');
  const waitForViewJob = waitForViewJobStep(scope, worker);
  // A chunk killed by its timeout or out of memory (Lambda.Unknown) resumes
  // once from its checkpoint; the worker fails an export whose chunks stall.
  for (const task of [chunk, chunkAfterWait]) {
    task.addRetry({ errors: ['Lambda.Unknown'], interval: cdk.Duration.seconds(5), maxAttempts: 1 });
  }
  waitForViewJob.addCatch(chunkAfterWait, { errors: ['States.Timeout'], resultPath: stepfunctions.JsonPath.DISCARD });
  for (const task of [prepare, chunk, chunkAfterWait, waitForViewJob, finalize]) {
    task.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$.error' });
  }
  const allRowsWritten = new stepfunctions.Choice(scope, 'AllRowsWritten')
    .when(stepfunctions.Condition.booleanEquals('$.done', true), finalize)
    .when(stepfunctions.Condition.isPresent('$.view_job'), waitForViewJob)
    .otherwise(chunk);
  waitForViewJob.next(chunk);
  chunkAfterWait.next(allRowsWritten);
  const role = new iam.Role(scope, 'ExportStateMachineRole', {
    roleName: 'CitationAnalysis-ExportStateMachineRole',
    assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    description: 'Role for the export state machine to invoke the export worker',
  });
  return loggedStateMachine(scope, 'ExportStateMachine', {
    logGroupId: 'ExportStateMachineLogGroup',
    stateMachineName: EXPORT_STATE_MACHINE_NAME,
    definition: prepare.next(chunk).next(allRowsWritten),
    role,
    timeout: cdk.Duration.days(EXPORT_STATE_MACHINE_TIMEOUT_DAYS),
  });
}

/**
 * Resume the exports waiting on a view job: `view-job.finished` on the
 * default bus invokes the export worker (`view_job_finished`), which sends
 * back the task token of every export waiting on that run. The worker
 * answers tokens of its own state machine only (named, not referenced: the
 * state machine already references the worker).
 */
function resumeExportsOnViewJobEvents(scope: Construct, worker: lambda.Function): void {
  new events.Rule(scope, 'ViewJobFinishedRule', {
    ruleName: 'CitationAnalysis-ViewJobFinished',
    description: 'A view job finished or failed: resume the exports waiting on it',
    eventPattern: { source: [VIEW_JOB_EVENT_SOURCE], detailType: [VIEW_JOB_FINISHED_DETAIL_TYPE] },
    targets: [new eventTargets.LambdaFunction(worker, {
      event: events.RuleTargetInput.fromObject({
        action: 'view_job_finished',
        job_id: events.EventField.fromPath('$.detail.job_id'),
        started_at: events.EventField.fromPath('$.detail.started_at'),
        status: events.EventField.fromPath('$.detail.status'),
      }),
      // Delivery to Lambda: a lost event only delays the export until the WaitForViewJob timeout.
      maxEventAge: cdk.Duration.seconds(EXPORT_VIEW_JOB_WAIT_SECONDS),
      retryAttempts: 4,
    })],
  });
  // EventBridge invokes the worker asynchronously (Step Functions invokes it synchronously), so a resume that raises
  // (Step Functions refused a token) is retried by Lambda: twice, and not after the waits it would resume timed out.
  worker.configureAsyncInvoke({ retryAttempts: 2, maxEventAge: cdk.Duration.seconds(EXPORT_VIEW_JOB_WAIT_SECONDS) });
  allow(worker, ['states:SendTaskSuccess', 'states:SendTaskFailure'], [cdk.Stack.of(scope).formatArn({
    service: 'states',
    resource: 'stateMachine',
    resourceName: EXPORT_STATE_MACHINE_NAME,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  })]);
}

/**
 * The export service (2.45.0): the Exports table, the worker that writes a
 * view's whole file chunk by chunk, the state machine that runs it, and the
 * `/api/exports` Lambda (start, list, read with a presigned download, cancel
 * or delete, mark seen). Returns the API Lambda.
 *
 * Least privilege: the worker reads the views only by invoking the API
 * routers (as the MCP server does; the caller's right to the view is checked
 * when the export is queued), and both Lambdas touch only `exports/*` of the
 * bucket. The download URL is presigned by the API Lambda for the owner on
 * each request; the object itself is never public.
 */
function exportService(scope: Construct, inputs: ExportServiceInputs): lambda.Function {
  const table = citationAnalysisTable(scope, 'ExportsTable', {
    tableName: EXPORTS_TABLE_NAME,
    partitionKey: stringKey('export_id'),
    timeToLiveAttribute: 'expires_at',
    globalSecondaryIndexes: [
      { indexName: 'OwnerCreatedIndex', partitionKey: stringKey('owner'), sortKey: stringKey('created_at') },
    ],
  });
  const exportObjects = inputs.bucket.arnForObjects(`${EXPORTS_PREFIX}*`);

  const worker = workerFunction(scope, 'ExportWorker', {
    functionName: 'CitationAnalysis-ExportWorker',
    code: lambdaSourceCode('export-worker'),
    layers: [inputs.sharedLayer],
    // Invoked by Step Functions only: a chunk writes until 60 s before this.
    timeout: cdk.Duration.seconds(EXPORT_WORKER_TIMEOUT_SECONDS),
    // Mostly I/O (synchronous router invokes, S3 parts); the CPU-heavy reads
    // run in the routers. The working set is about 200-300 MB (16 MiB part
    // buffer and copy, checkpoint copies, one router page parsed). One vCPU
    // (owner decision 2026-11-07) writes and deflates the XLSX parts at full
    // speed; confirm the size from the REPORT lines of a 1M-row export.
    memorySize: 1769,
    description: 'Export service: prepare, write one chunk, finalize or fail one export',
    environment: {
      DYNAMODB_TABLE_EXPORTS: table.tableName,
      EXPORTS_BUCKET: inputs.bucket.bucketName,
      EXPORT_API_FUNCTIONS: cdk.Stack.of(scope).toJsonString(
        Object.fromEntries(Object.entries(inputs.routers).map(([key, fn]) => [key, fn.functionName]))
      ),
      // Unset, an Admin-only export (the users list) fails closed at Prepare.
      USER_POOL_ID: inputs.userPool.userPoolId,
    },
  });
  // Prepare checks that the owner of an Admin-only export is still an Admin.
  allow(worker, ['cognito-idp:AdminListGroupsForUser'], [inputs.userPool.userPoolArn]);
  allow(worker, ['dynamodb:GetItem', 'dynamodb:PutItem'], [table.tableArn]);
  // Multipart upload (Create/UploadPart/Complete are s3:PutObject), the
  // checkpoint objects (put, get, delete) and Finalize's HeadObject.
  allow(worker, ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:AbortMultipartUpload'], [exportObjects]);
  allow(worker, ['lambda:InvokeFunction'], Object.values(inputs.routers).map((fn) => fn.functionArn));

  const stateMachine = exportStateMachine(scope, worker);
  resumeExportsOnViewJobEvents(scope, worker);

  const api = apiFunction(scope, 'Exports', inputs.sharedLayer, {
    functionName: DASHBOARD_API_FUNCTION_NAMES.exports,
    handlerFiles: ['exports.py'],
    memorySize: 512,
    description: 'API: exports (start, list, read with a presigned download, cancel or delete, mark seen)',
    environment: {
      DYNAMODB_TABLE_EXPORTS: table.tableName,
      EXPORTS_BUCKET: inputs.bucket.bucketName,
      EXPORT_STATE_MACHINE_ARN: stateMachine.stateMachineArn,
    },
  });
  allow(api, ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query'], [
    table.tableArn, `${table.tableArn}/index/OwnerCreatedIndex`,
  ]);
  // Presign the owner's download (GetObject), delete a finished export and
  // its checkpoints, abort a cancelled upload.
  allow(api, ['s3:GetObject', 's3:DeleteObject', 's3:AbortMultipartUpload'], [exportObjects]);
  allow(api, ['states:StartExecution'], [stateMachine.stateMachineArn]);
  // Cancel: only executions of the export state machine (name-formatted to
  // avoid a reference to the execution ARN, which is not a resource).
  allow(api, ['states:StopExecution'], [cdk.Stack.of(scope).formatArn({
    service: 'states',
    resource: 'execution',
    resourceName: `${EXPORT_STATE_MACHINE_NAME}:*`,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  })]);
  return api;
}

/** Measured at 10x (report-w6-b.md): every fold unit, series turn, rollup shard and merge peaks <= ~606 MB of heap and < 600 s CPU. */
const SCOPE_SNAPSHOT_WORKER_MEMORY_MB = 1769;
const SCOPE_SNAPSHOT_BUILD_NAME = 'CitationAnalysis-ScopeSnapshotBuild';

/** What the distributed build reads and writes in the main stack. */
interface ScopeSnapshotBuildInputs {
  sharedLayer: lambda.ILayerVersion;
  /** The keywords bucket: snapshots under `scope-snapshots/`, the rollup under `citation-rollups/`. */
  bucket: s3.IBucket;
  /** Starts the build (a heavy `build_scope_snapshots` or `build_citation_rollup`); gets the ARN and the start/list rights. */
  generateSummary: lambda.Function;
  /** The Deduplication Lambda: the `latest` backfill of keywords whose KeywordLatest object is behind. */
  backfill: lambda.IFunction;
  tables: {
    keywords: dynamodb.ITable;
    brandConfig: dynamodb.ITable;
    queryPrompts: dynamodb.ITable;
    keywordRunKpis: dynamodb.ITable;
    keywordRunBrands: dynamodb.ITable;
    searchResults: dynamodb.ITable;
    citations: dynamodb.ITable;
  };
}

/**
 * One step of the build: the worker's `action` on the execution's build, retried on throttling. A step killed by its
 * timeout or out of memory (Lambda.Unknown) is retried once: every step is idempotent (a fold unit, rollup shard or
 * merge whose fragment exists returns at once; a series turn resumes from its saved progress).
 */
function buildStep(scope: Construct, id: string, worker: lambda.IFunction, payload: Record<string, unknown>, resultPath?: string): tasks.LambdaInvoke {
  const task = new tasks.LambdaInvoke(scope, id, {
    lambdaFunction: worker,
    payload: stepfunctions.TaskInput.fromObject(payload),
    payloadResponseOnly: true,
    resultPath: resultPath ?? stepfunctions.JsonPath.DISCARD,
    retryOnServiceExceptions: true,
  });
  task.addRetry({ errors: ['Lambda.TooManyRequestsException'], interval: cdk.Duration.seconds(10), maxAttempts: 6, backoffRate: 2 });
  task.addRetry({ errors: ['Lambda.Unknown'], interval: cdk.Duration.seconds(10), maxAttempts: 1 });
  return task;
}

/** A Distributed Map over the item list the plan wrote at `$.<keyField>` (`[{"<item>": n}, ...]`); results discarded. */
function buildMap(scope: Construct, id: string, bucket: s3.IBucket, keyField: string, item: string, processor: stepfunctions.IChainable): stepfunctions.DistributedMap {
  return new stepfunctions.DistributedMap(scope, id, {
    maxConcurrency: 10,
    mapExecutionType: stepfunctions.StateMachineType.STANDARD,
    itemReader: new stepfunctions.S3JsonItemReader({ bucket, key: stepfunctions.JsonPath.stringAt(`$.${keyField}`) }),
    itemSelector: { 'build_id.$': '$.build_id', [`${item}.$`]: `$$.Map.Item.Value.${item}` },
    toleratedFailurePercentage: 0,
    resultPath: stepfunctions.JsonPath.DISCARD,
  }).itemProcessor(processor);
}

/**
 * `CitationAnalysis-ScopeSnapshotBuild` (2.45.0 wave 6): the scope snapshots and the citation rollup of a tenant too large
 * for one invocation, built in bounded steps (`lambda/shared/scope_snapshot_dist.py`, `lambda/shared/citation_rollup_dist.py`):
 *
 *   Plan -> Parallel( FoldUnits Map -> SeriesBatches Map (each item loops SeriesTurn until done)
 *                   | RollupShards Map -> RollupMerges Map )
 *        -> Publish (snapshots' current.json, then the rollup's current.json LAST)
 *
 * The state holds only the build id and S3 keys (< 1 KB); every list is an S3 item list the plan wrote. Any failure ends
 * in BuildFailed with nothing published (both current.json files still name the previous builds).
 */
function scopeSnapshotBuild(scope: Construct, inputs: ScopeSnapshotBuildInputs): stepfunctions.StateMachine {
  const { bucket, tables } = inputs;
  const worker = workerFunction(scope, 'ScopeSnapshotWorker', {
    functionName: 'CitationAnalysis-ScopeSnapshotWorker',
    code: lambdaSourceCode('generate-summary'),
    layers: [inputs.sharedLayer],
    // Each step stops 30 s before this; a series turn after 480 s.
    timeout: cdk.Duration.seconds(900),
    // Measured at 10x: heap peak <= ~606 MB + ~150 MB runtime, under half of it; one vCPU (owner decision 2026-11-07).
    memorySize: SCOPE_SNAPSHOT_WORKER_MEMORY_MB,
    description: 'One step of the distributed scope snapshot and citation rollup build (plan, fold unit, series turn, rollup shard or merge, publish)',
    environment: {
      SCOPE_SNAPSHOT_BUCKET: bucket.bucketName,
      SUMMARY_BUCKET: bucket.bucketName,
      CITATION_ROLLUP_BUCKET: bucket.bucketName,
      DYNAMODB_TABLE_KEYWORDS: tables.keywords.tableName,
      DYNAMODB_TABLE_BRAND_CONFIG: tables.brandConfig.tableName,
      DYNAMODB_TABLE_QUERY_PROMPTS: tables.queryPrompts.tableName,
      DYNAMODB_TABLE_KEYWORD_RUN_KPIS: tables.keywordRunKpis.tableName,
      DYNAMODB_TABLE_KEYWORD_RUN_BRANDS: tables.keywordRunBrands.tableName,
      DYNAMODB_TABLE_SEARCH_RESULTS: tables.searchResults.tableName,
      DYNAMODB_TABLE_CITATIONS: tables.citations.tableName,
      KEYWORD_LATEST_BACKFILL_FUNCTION: inputs.backfill.functionName,
    },
  });
  // Reads only: the keywords (Query on StatusIndex), brand config, personas, the per-run history, the newest run per
  // keyword, and the Citations partitions (Query), the rest scan (Scan) and its item count (DescribeTable).
  allow(worker, ['dynamodb:Query', 'dynamodb:GetItem'], [tables.keywords.tableArn, `${tables.keywords.tableArn}/index/*`]);
  allow(worker, ['dynamodb:GetItem'], [tables.brandConfig.tableArn]);
  allow(worker, ['dynamodb:Query'], [tables.queryPrompts.tableArn, `${tables.queryPrompts.tableArn}/index/EnabledIndex`]);
  allow(worker, ['dynamodb:Query'], [tables.keywordRunKpis.tableArn, tables.keywordRunBrands.tableArn]);
  allow(worker, ['dynamodb:Query', 'dynamodb:BatchGetItem'], [tables.searchResults.tableArn]);
  allow(worker, ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:DescribeTable'], [tables.citations.tableArn]);
  const objects = [bucket.arnForObjects(`${SCOPE_SNAPSHOT_PREFIX}*`), bucket.arnForObjects(`${CITATION_ROLLUP_PREFIX}*`)];
  allow(worker, ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], objects);
  worker.addToRolePolicy(new iam.PolicyStatement({
    actions: ['s3:ListBucket'],
    resources: [bucket.bucketArn],
    conditions: { StringLike: { 's3:prefix': [`${SCOPE_SNAPSHOT_PREFIX}*`, `${CITATION_ROLLUP_PREFIX}*`] } },
  }));
  allow(worker, ['lambda:InvokeFunction'], [inputs.backfill.functionArn]);

  const failed = new stepfunctions.Fail(scope, 'ScopeSnapshotBuildFailed', {
    error: 'ScopeSnapshotBuildFailed',
    cause: 'Nothing published: both current.json files still name the previous builds',
  });
  // 1. Plan: {build_id, bucket, units_key, units, series_key, series_batches, rollup_shards_key, rollup_shards,
  //    rollup_merges_key, rollup_merges, scopes} + reason.
  const plan = buildStep(scope, 'PlanSnapshotBuild', worker, { action: 'snapshot_build_plan', 'reason.$': '$.reason' }, '$');
  // 2a. Fold units, then the series batches (each item loops 480 s turns until done; the step fails itself past 40).
  const units = buildMap(scope, 'FoldUnits', bucket, 'units_key', 'unit',
    buildStep(scope, 'FoldUnit', worker, { action: 'snapshot_build_unit', 'build_id.$': '$.build_id', 'unit.$': '$.unit' }));
  const seriesTurn = buildStep(scope, 'SeriesTurn', worker, {
    action: 'snapshot_build_series', 'build_id.$': '$.build_id', 'batch.$': '$.batch', 'turn.$': '$.series.turn',
  }, '$.series');
  const startTurns = new stepfunctions.Pass(scope, 'StartSeriesTurns', { result: stepfunctions.Result.fromObject({ turn: 0, done: false }), resultPath: '$.series' });
  const batchDone = new stepfunctions.Choice(scope, 'SeriesBatchDone')
    .when(stepfunctions.Condition.booleanEquals('$.series.done', true), new stepfunctions.Succeed(scope, 'SeriesBatchBuilt'))
    .otherwise(seriesTurn);
  const series = buildMap(scope, 'SeriesBatches', bucket, 'series_key', 'batch', startTurns.next(seriesTurn).next(batchDone));
  // 2b. Rollup shards (whole markets; the last item scans the rows of inactive keywords), then the merges.
  const shards = buildMap(scope, 'RollupShards', bucket, 'rollup_shards_key', 'shard',
    buildStep(scope, 'RollupShard', worker, { action: 'snapshot_build_rollup_shard', 'build_id.$': '$.build_id', 'shard.$': '$.shard' }));
  const merges = buildMap(scope, 'RollupMerges', bucket, 'rollup_merges_key', 'merge',
    buildStep(scope, 'RollupMerge', worker, { action: 'snapshot_build_rollup_merge', 'build_id.$': '$.build_id', 'merge.$': '$.merge' }));
  const build = new stepfunctions.Parallel(scope, 'BuildSnapshotsAndRollup', { resultPath: stepfunctions.JsonPath.DISCARD })
    .branch(units.next(series))
    .branch(shards.next(merges));
  // 3. Publish: the snapshots' current.json, then the rollup's (LAST).
  const publish = buildStep(scope, 'PublishSnapshotBuild', worker, { action: 'snapshot_build_publish', 'build_id.$': '$.build_id', 'reason.$': '$.reason' }, '$.summary');
  for (const state of [plan, build, publish]) {
    state.addCatch(failed, { errors: ['States.ALL'], resultPath: '$.error' });
  }
  const role = new iam.Role(scope, 'ScopeSnapshotBuildRole', {
    roleName: 'CitationAnalysis-ScopeSnapshotBuildRole',
    assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    description: 'Role for the distributed scope snapshot and citation rollup build to invoke its worker and run its Maps',
  });
  const machine = loggedStateMachine(scope, 'ScopeSnapshotBuild', {
    logGroupId: 'ScopeSnapshotBuildLogGroup',
    stateMachineName: SCOPE_SNAPSHOT_BUILD_NAME,
    definition: plan.next(build).next(publish),
    role,
    // The first 10x build: ~11 series turns of the `all` batch (~1.5 h at tracemalloc speed, about half in Lambda).
    timeout: cdk.Duration.hours(6),
  });
  // The Distributed Maps' ItemReader (the plan's item lists live under the snapshot build).
  bucket.grantRead(machine, `${SCOPE_SNAPSHOT_PREFIX}*`);

  // GenerateSummary starts it (one execution name per workflow run) and checks that none runs. The ARN is formatted from
  // the fixed name, not referenced: GenerateSummary -> machine -> worker -> Deduplication -> GenerateSummary would be a cycle.
  const machineArn = cdk.Stack.of(scope).formatArn({
    service: 'states', resource: 'stateMachine', resourceName: SCOPE_SNAPSHOT_BUILD_NAME, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  inputs.generateSummary.addEnvironment('SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN', machineArn);
  allow(inputs.generateSummary, ['states:StartExecution', 'states:ListExecutions'], [machineArn]);
  return machine;
}

class WebBuildRequiredError extends Error {
  constructor() {
    super('Web dashboard not built. Run "./scripts/deploy.sh" for full deployment, or "cd web && npm install && npm run build" before "cdk deploy".');
    this.name = 'WebBuildRequiredError';
  }
}

/** A string partition key and sort key. */
function stringKeys(partition: string, sort: string): { partitionKey: dynamodb.Attribute; sortKey: dynamodb.Attribute } {
  return {
    partitionKey: { name: partition, type: dynamodb.AttributeType.STRING },
    sortKey: { name: sort, type: dynamodb.AttributeType.STRING },
  };
}

/** The ARN of a SEO-stack state machine, by its fixed name (no cross-stack reference: the SEO stack depends on this one). */
function seoStateMachineArn(stack: cdk.Stack, name: string): string {
  return stack.formatArn({ service: 'states', resource: 'stateMachine', resourceName: name, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME });
}

export class CitationAnalysisStack extends cdk.Stack {
  /** What the MCP stack builds on: the user pool and the API router Lambdas. */
  public readonly mcpInputs: McpServerInputs;
  /** What the SEO stack builds on: the user pool. */
  public readonly seoInputs: SeoStackInputs;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ProcessKeywords writes its per-keyword results to S3 only through
    // `resultWriterV2`, which CDK renders only with this flag on; without it
    // the Map would silently fall back to returning every result in the
    // 256 KiB state. cdk.json enables it too; pinning it here keeps every app
    // that synthesizes this stack (tests included) on the same definition.
    this.node.setContext(cxapi.STEPFUNCTIONS_USE_DISTRIBUTED_MAP_RESULT_WRITER_V2, true);
    // Dev mode: `cdk deploy --context dev=true` adds http://localhost:5173 as allowed CORS origin
    const devMode = this.node.tryGetContext('dev') === 'true';
    // Read first so a bad `-c providerConcurrency=...` fails synth before any
    // asset is staged.
    const providerConcurrency = readProviderConcurrency(this);
    const providerPacing = readProviderPacing(this);

    provisionBedrockModelAccess(this);


    // DynamoDB Table: SearchResults
    // Stores raw search results from each AI provider
    const searchResultsTable = citationAnalysisTable(this, 'SearchResultsTable', {
      tableName: 'CitationAnalysis-SearchResults',
      partitionKey: { name: 'keyword', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp_provider', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        // GSI: ProviderIndex - Query all results by provider
        {
          indexName: 'ProviderIndex',
          partitionKey: { name: 'provider', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // DynamoDB Table: Citations
    // Stores deduplicated citations with metadata
    const citationsTable = citationAnalysisTable(this, 'CitationsTable', {
      tableName: 'CitationAnalysis-Citations',
      partitionKey: { name: 'keyword', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'normalized_url', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        // GSI: UrlIndex - Inverse index for "which keywords cite this URL?"
        //
        // The base table is keyed by (keyword, normalized_url) which makes the
        // forward lookup ("citations for keyword X") cheap, but the reverse
        // ("keywords that cite URL X") requires a full table scan. The
        // get-url-breakdown handler used to scan SearchResults up to 5000 items
        // to answer this. With this GSI, the same query is a bounded
        // ``Query(normalized_url=X)`` against deduplicated rows.
        //
        // Projection is ALL because the breakdown endpoint needs
        // citing_providers, citation_count, and last_updated alongside keyword.
        {
          indexName: 'UrlIndex',
          ...stringKeys('normalized_url', 'keyword'),
        },
      ],
    });

    // DynamoDB Table: KeywordRunKpis (2.44.0)
    // One row per (keyword, run) with the additive counts every KPI in
    // shared/kpi_engine.py is computed from (shared/kpi_tally.py), written by
    // DeduplicateCitations when the keyword's run completes. History reports
    // (trends, overview, group KPIs, insights) sum these rows instead of
    // re-reading every answer, so a 365-day window of 100 keywords is whole.
    // Derived data: a missing row falls back to the raw answers, and the
    // Deduplication Lambda's `backfill_keyword_run_kpis` action rebuilds it.
    // The key of both per-(keyword, run) tables.
    const perRunKeys = { partitionKey: stringKey('keyword'), sortKey: stringKey('run_timestamp') };
    const keywordRunKpisTable = citationAnalysisTable(this, 'KeywordRunKpisTable', {
      tableName: 'CitationAnalysis-KeywordRunKpis',
      ...perRunKeys,
    });

    // DynamoDB Table: KeywordRunBrands (2.45.0)
    // Every brand of a keyword run whose KeywordRunKpis row is capped at 25
    // brands (shared/keyword_run_brands.py), written by DeduplicateCitations in
    // the same call. A side table, not wider KeywordRunKpis rows, so live
    // windows keep reading ~3 KB rows; the scope series and the window view
    // jobs read it for exact brand leaderboards.
    const keywordRunBrandsTable = citationAnalysisTable(this, 'KeywordRunBrandsTable', {
      tableName: 'CitationAnalysis-KeywordRunBrands',
      ...perRunKeys,
    });

    // DynamoDB Table: CrawledContent
    // Stores crawled page content and summaries
    const crawledContentTable = citationAnalysisTable(this, 'CrawledContentTable', {
      tableName: 'CitationAnalysis-CrawledContent',
      partitionKey: { name: 'normalized_url', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'crawled_at', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        // GSI: KeywordIndex - Query all crawled content for a keyword
        {
          indexName: 'KeywordIndex',
          partitionKey: { name: 'keyword', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'crawled_at', type: dynamodb.AttributeType.STRING },
        },
        // Compact freshness index. The hashed scope is URL+keyword for
        // successful SEO analysis and URL-wide for publisher blocks, so one
        // keyword's newer row cannot hide another keyword's reusable crawl.
        {
          indexName: 'CacheScopeIndex',
          partitionKey: { name: 'cache_scope', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'crawled_at', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.INCLUDE,
          nonKeyAttributes: ['cache_status', 'analysis_status', 'block_reason'],
        },
      ],
    });

    // DynamoDB Table: Keywords
    // Stores user-managed keywords for searches
    const keywordsTable = citationAnalysisTable(this, 'KeywordsTable', {
      tableName: 'CitationAnalysis-Keywords',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        // GSI: StatusIndex - Query keywords by status (active/inactive)
        // Enables efficient querying of active keywords without full table scan
        {
          indexName: 'StatusIndex',
          partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'keyword', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // DynamoDB Table: KeywordGroups
    // Folders of keywords (typically one per hotel/property). Membership lives
    // on each Keywords item as the `group_ids` string set, so this table only
    // holds group metadata.
    const keywordGroupsTable = citationAnalysisTable(this, 'KeywordGroupsTable', {
      tableName: 'CitationAnalysis-KeywordGroups',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });


    // DynamoDB Table: ResearchTemplates
    // Saved system prompts for the keyword research agent (2.5.0). The
    // built-in template is code, not a row; every agent job snapshots the
    // prompt it ran with, so editing a template never rewrites history.
    const researchTemplatesTable = citationAnalysisTable(this, 'ResearchTemplatesTable', {
      tableName: 'CitationAnalysis-ResearchTemplates',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB Table: BrandConfig
    // Stores brand tracking configuration (industry, tracked brands, etc.)
    const brandConfigTable = citationAnalysisTable(this, 'BrandConfigTable', {
      tableName: 'CitationAnalysis-BrandConfig',
      partitionKey: { name: 'config_id', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB Table: KeywordResearch
    // One row per research job (keyword expansion or competitor analysis).
    // Per-provider steps live inside the row (`steps` map). History reads the
    // GSI newest-first instead of scanning; rows expire after 90 days (`ttl`,
    // written by shared/research_jobs.py) — before 2.2.0 the table only grew.
    const keywordResearchTable = citationAnalysisTable(this, 'KeywordResearchTable', {
      tableName: 'CitationAnalysis-KeywordResearch',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      globalSecondaryIndexes: [
        {
          indexName: 'TypeCreatedIndex',
          partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // DynamoDB Table: ContentStudio
    // Stores generated content ideas and content. History merges bounded,
    // newest-first status queries; batch status reads exact manifest child ids.
    // KpiAlerts below shares this lifecycle index shape.
    const statusCreatedIndex: CitationAnalysisIndexSpec = {
      indexName: 'StatusCreatedIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    };
    const contentStudioTable = citationAnalysisTable(this, 'ContentStudioTable', {
      tableName: 'CitationAnalysis-ContentStudio',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      globalSecondaryIndexes: [statusCreatedIndex],
    });

    // Durable batch authority. Child ids stay ordered in the manifest so status
    // reads never depend on secondary-index propagation or discovery.
    const contentBriefBatchesTable = citationAnalysisTable(this, 'ContentBriefBatchesTable', {
      tableName: 'CitationAnalysis-ContentBriefBatches',
      partitionKey: { name: 'batch_id', type: dynamodb.AttributeType.STRING },
    });

    // Saved Content Studio prompt templates. Built-ins remain in code; every
    // generated row snapshots its exact effective prompt and provenance.
    const contentBriefTemplatesTable = citationAnalysisTable(this, 'ContentBriefTemplatesTable', {
      tableName: 'CitationAnalysis-ContentBriefTemplates',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    // Saved custom report layouts (Reports > Custom report builder), shared
    // by every signed-in user and capped at 50 rows by the handler.
    const customReportsTable = citationAnalysisTable(this, 'CustomReportsTable', {
      tableName: 'CitationAnalysis-CustomReports',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB Table: ProviderConfig
    // Stores AI provider enable/disable configuration
    const providerConfigTable = citationAnalysisTable(this, 'ProviderConfigTable', {
      tableName: 'CitationAnalysis-ProviderConfig',
      partitionKey: { name: 'provider_id', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB Table: QueryPrompts
    // Stores user-defined query prompt templates with persona modifiers
    const queryPromptsTable = citationAnalysisTable(this, 'QueryPromptsTable', {
      tableName: 'CitationAnalysis-QueryPrompts',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        // GSI for querying enabled prompts efficiently
        {
          indexName: 'EnabledIndex',
          partitionKey: { name: 'enabled', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // DynamoDB Table: SelfReflection
    // Stores LLM self-reflection analysis results with 24-hour TTL caching
    const selfReflectionTable = citationAnalysisTable(this, 'SelfReflectionTable', {
      tableName: 'CitationAnalysis-SelfReflection',
      partitionKey: { name: 'keyword_brand', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'persona_timestamp', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    // DynamoDB Table: RecommendationStatus
    // Tracks the action-tracking lifecycle (new -> in_progress -> done /
    // wontfix) for individual recommendations produced by
    // get-recommendations.py. The recommendations themselves aren't
    // persisted -- they're regenerated on every API call -- so this
    // table is the only durable record of which items have been worked
    // on. PK is a deterministic SHA-1 hash of the recommendation's
    // type + title + sorted keywords (see shared.utils.recommendation_id).
    // 90-day TTL evicts abandoned items so the table doesn't grow
    // unbounded for one-off recommendations that never get triaged.
    const recommendationStatusTable = citationAnalysisTable(this, 'RecommendationStatusTable', {
      tableName: 'CitationAnalysis-RecommendationStatus',
      partitionKey: { name: 'recommendation_id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    // Complete, exact-run KPI snapshots. The timestamp sort key makes the
    // immediately preceding complete snapshot a bounded Query.
    const kpiSnapshotsTable = citationAnalysisTable(this, 'KpiSnapshotsTable', {
      tableName: 'CitationAnalysis-KpiSnapshots',
      partitionKey: { name: 'group_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'snapshot_at', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    // The written narrative of each keyword group's run (GenerateInsights),
    // read back by GET /api/reports/insights so no report read calls Bedrock.
    // Kept as long as the run's KPI snapshot.
    const reportInsightsTable = citationAnalysisTable(this, 'ReportInsightsTable', {
      tableName: 'CitationAnalysis-ReportInsights',
      partitionKey: { name: 'scope_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'run_timestamp', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    // Durable alert instances, queried newest-first by their open or
    // acknowledged lifecycle state rather than through a table scan.
    const kpiAlertsTable = citationAnalysisTable(this, 'KpiAlertsTable', {
      tableName: 'CitationAnalysis-KpiAlerts',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      globalSecondaryIndexes: [statusCreatedIndex],
    });

    const alertSettingsTable = citationAnalysisTable(this, 'AlertSettingsTable', {
      tableName: 'CitationAnalysis-AlertSettings',
      partitionKey: { name: 'config_id', type: dynamodb.AttributeType.STRING },
    });

    const contentChangesTable = citationAnalysisTable(this, 'ContentChangesTable', {
      tableName: 'CitationAnalysis-ContentChanges',
      partitionKey: { name: 'group_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'changed_at', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    // Topic delivery and every table above are request-priced; no provisioned
    // throughput or continuously running compute is introduced. The AWS-managed
    // SNS key adds no monthly customer-managed-key charge.
    const kpiAlertsKey = kms.Alias.fromAliasName(this, 'KpiAlertsSnsKey', 'alias/aws/sns');
    const kpiAlertsTopic = new sns.Topic(this, 'KpiAlertsTopic', {
      topicName: 'CitationAnalysis-KpiAlerts',
      displayName: 'Citation Analysis KPI Alerts',
      masterKey: kpiAlertsKey,
    });
    // A missed KeywordRunKpis / KeywordLatest write tells the topic's subscribers.
    new KpiWriteFailureAlarm(this, 'KpiWriteFailureAlarm', { topic: kpiAlertsTopic });

    // ========================================
    // Secrets Manager - API Keys
    // ========================================

    // Import the provider API key secrets; an admin creates them from the
    // dashboard (Settings > AI Providers), so they may not exist yet.
    const openaiSecret = apiKeySecret(this, 'OpenAISecret', 'openai');
    const perplexitySecret = apiKeySecret(this, 'PerplexitySecret', 'perplexity');
    const geminiSecret = apiKeySecret(this, 'GeminiSecret', 'gemini');
    const claudeSecret = apiKeySecret(this, 'ClaudeSecret', 'claude');

    // Search Provider API Key Secrets
    const braveSecret = apiKeySecret(this, 'BraveSecret', 'brave');
    const tavilySecret = apiKeySecret(this, 'TavilySecret', 'tavily');
    const exaSecret = apiKeySecret(this, 'ExaSecret', 'exa');
    const serpapiSecret = apiKeySecret(this, 'SerpAPISecret', 'serpapi');
    const firecrawlSecret = apiKeySecret(this, 'FirecrawlSecret', 'firecrawl');

    // Nova Act API Key Secret (for intelligent browser navigation with verification handling)
    // Note: Not currently used by crawler code - kept for future use
    apiKeySecret(this, 'NovaActSecret', 'nova-act');

    // ========================================
    // S3 Buckets
    // ========================================

    // Access Logs Bucket - stores S3 access logs for audit trail
    // Note: versioned=false is intentional for access logs (high volume, short retention)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `citation-analysis-access-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      versioned: false, // NOSONAR: Access logs are ephemeral, versioning adds unnecessary cost
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          enabled: true,
        },
      ],
    });

    // The SEO stack's bucket (`citation-analysis-seo-<account>`, lib/seo-stack.ts)
    // logs here under `seo/`. Named, not referenced: the SEO stack deploys after
    // this one.
    accessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('logging.s3.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [accessLogsBucket.arnForObjects('seo/*')],
      conditions: {
        ArnLike: { 'aws:SourceArn': `arn:${this.partition}:s3:::citation-analysis-seo-${this.account}` },
        StringEquals: { 'aws:SourceAccount': this.account },
      },
    }));

    // Keywords Bucket
    //
    // `runs/` holds per-run scratch: the keyword manifest ParseKeywords writes
    // (`runs/<execution>/keywords.json`) and the ProcessKeywords Distributed
    // Map's ResultWriter output (`runs/map-results/`). GenerateSummary reads
    // both back within the run and keeps the full report under
    // `execution-summaries/`, so 30 days is only a window for debugging a run.
    // The bucket is unversioned, so there are no noncurrent versions to expire;
    // ResultWriter uploads in parts, so abandoned multipart uploads under the
    // prefix are cleaned up too. `execution-summaries/` is deliberately NOT
    // covered by any rule.
    const keywordsBucket = citationAnalysisBucket(this, 'KeywordsBucket', {
      name: 'keywords',
      accessLogsBucket,
      lifecycleRules: [
        {
          id: 'ExpireRunScratch',
          enabled: true,
          prefix: WORKFLOW_RUNS_PREFIX,
          expiration: cdk.Duration.days(WORKFLOW_RUNS_RETENTION_DAYS),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        {
          id: 'ExpireSpilledApiResponses',
          enabled: true,
          prefix: API_RESPONSE_SPILL_PREFIX,
          expiration: cdk.Duration.days(API_RESPONSE_SPILL_RETENTION_DAYS),
        },
        // View jobs (results, statuses, export files) answer one question of
        // one build; exports upload in parts, so abandoned uploads go too.
        {
          id: 'ExpireScopeSnapshotJobs',
          enabled: true,
          prefix: SCOPE_SNAPSHOT_JOBS_PREFIX,
          expiration: cdk.Duration.days(SCOPE_SNAPSHOT_JOB_RETENTION_DAYS),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        // Export service files and checkpoints (shared/export_steps.py):
        // 7 days, as the job item's TTL; exports upload in parts.
        {
          id: 'ExpireExports',
          enabled: true,
          prefix: EXPORTS_PREFIX,
          expiration: cdk.Duration.days(EXPORT_RETENTION_DAYS),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    // Screenshots Bucket
    const screenshotsBucket = citationAnalysisBucket(this, 'ScreenshotsBucket', {
      name: 'screenshots',
      accessLogsBucket,
      // Transition to Infrequent Access at 90 days — NOT expiration.
      //
      // This rule used to be `expiration: 90 days`, which silently deleted
      // every crawl screenshot older than a quarter. Screenshots are the only
      // evidence of what a cited page looked like at crawl time, and pages get
      // rewritten, so a deleted screenshot is not regenerable — re-crawling
      // captures today's page, not the one that was cited
      // (AUDIT-2026-08-19 §2.5).
      //
      // Screenshots are read when a citation is first reviewed and rarely
      // again, which is exactly the STANDARD_IA access pattern: same
      // durability and availability SLA, roughly 45% cheaper per GB, at the
      // cost of a per-GB retrieval fee on the infrequent reads. At the current
      // 3.3 GB / 2,055 objects that is small either way; the point is that it
      // stays small as the bucket grows without anything being destroyed.
      //
      // 90 days is kept from the previous rule deliberately: it is comfortably
      // past the 30-day minimum STANDARD_IA billing duration, so an object
      // transitioned here is never charged for storage it did not use.
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Raw Responses Bucket - stores full API responses from AI providers
    // Structure: raw-responses/{date}/{keyword}/{provider}/{timestamp}.json
    const rawResponsesBucket = citationAnalysisBucket(this, 'RawResponsesBucket', {
      name: 'raw-responses',
      accessLogsBucket,
    });

    // ========================================
    // IAM Roles
    // ========================================

    // IAM Role for Search Lambda
    // Permissions: Read secrets, write to SearchResults table
    const searchLambdaRole = lambdaServiceRole(
      this,
      'SearchLambdaRole',
      'CitationAnalysis-SearchLambdaRole',
      'Role for Search Lambda to access Secrets Manager and DynamoDB'
    );

    // Amazon Bedrock Web Search (provider `agentcore`): the gateway lives in its own
    // stack and region, found through the SSM name and region only.
    const webSearchRegion = readWebSearchRegion(this);
    const webSearchEnv = {
      WEB_SEARCH_REGION: webSearchRegion,
      WEB_SEARCH_GATEWAY_URL_PARAMETER,
    };
    searchLambdaRole.addToPolicy(webSearchPolicyStatement(this.account, webSearchRegion));

    // Grant Search Lambda read access to all API key secrets
    openaiSecret.grantRead(searchLambdaRole);
    perplexitySecret.grantRead(searchLambdaRole);
    geminiSecret.grantRead(searchLambdaRole);
    claudeSecret.grantRead(searchLambdaRole);

    // Grant Search Lambda read access to search provider secrets
    braveSecret.grantRead(searchLambdaRole);
    tavilySecret.grantRead(searchLambdaRole);
    exaSecret.grantRead(searchLambdaRole);
    serpapiSecret.grantRead(searchLambdaRole);
    firecrawlSecret.grantRead(searchLambdaRole);

    // Grant Search Lambda write access to SearchResults table
    searchResultsTable.grantWriteData(searchLambdaRole);

    // Grant Search Lambda write access to Raw Responses bucket
    rawResponsesBucket.grantWrite(searchLambdaRole);

    // Grant Search Lambda read access to BrandConfig table
    brandConfigTable.grantReadData(searchLambdaRole);

    // Grant Search Lambda access to Bedrock for brand extraction
    searchLambdaRole.addToPolicy(claudeInvokeModelStatement(this));

    // IAM Role for Deduplication Lambda
    // Permissions: Read/write to Citations table, read from SearchResults table
    const deduplicationLambdaRole = lambdaServiceRole(
      this,
      'DeduplicationLambdaRole',
      'CitationAnalysis-DeduplicationLambdaRole',
      'Role for Deduplication Lambda to access DynamoDB'
    );

    // Grant Deduplication Lambda read access to SearchResults table
    searchResultsTable.grantReadData(deduplicationLambdaRole);

    // Grant Deduplication Lambda read/write access to Citations table
    citationsTable.grantReadWriteData(deduplicationLambdaRole);

    // IAM Role for Crawler Lambda
    // Permissions: Write to CrawledContent table, invoke Bedrock models
    const crawlerLambdaRole = lambdaServiceRole(
      this,
      'CrawlerLambdaRole',
      'CitationAnalysis-CrawlerLambdaRole',
      'Role for Crawler Lambda to access DynamoDB and Bedrock'
    );

    // Cache decisions query one compact GSI; artifact persistence and cache-hit
    // metadata refresh touch only the base table. Keep this exact rather than
    // granting delete, scan, batch-write, or arbitrary update access.
    allow(crawlerLambdaRole, ['dynamodb:Query'], [
      crawledContentTable.tableArn,
      `${crawledContentTable.tableArn}/index/CacheScopeIndex`,
    ]);
    allow(crawlerLambdaRole, ['dynamodb:PutItem', 'dynamodb:UpdateItem'], [crawledContentTable.tableArn]);

    // Grant Crawler Lambda access to Bedrock for LLM summarization.
    crawlerLambdaRole.addToPolicy(claudeInvokeModelStatement(this));

    // Screenshots are the only objects this function writes.
    screenshotsBucket.grantWrite(crawlerLambdaRole, 'screenshots/*');

    // IAM Role for Step Functions State Machine
    // Permissions: Invoke all Lambda functions
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsRole', {
      roleName: 'CitationAnalysis-StepFunctionsRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'Role for Step Functions to invoke Lambda functions',
    });

    // IAM Role for EventBridge Scheduler
    // Permissions: Start Step Functions executions
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: 'CitationAnalysis-SchedulerRole',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to start Step Functions executions',
    });

    // Grant Step Functions permission to invoke Lambda functions
    // Note: Specific Lambda ARNs will be added when Lambda functions are created
    allow(stepFunctionsRole, ['lambda:InvokeFunction'], [
      `arn:aws:lambda:${this.region}:${this.account}:function:CitationAnalysis-*`,
    ]);

    // ========================================
    // Lambda Layer for Shared Code
    // ========================================

    // Shared Python code and dependencies, built by lambda/layer/build-layer.sh.
    const sharedLayer = pythonLayer(this, 'SharedLayer', {
      directory: 'layer',
      label: 'Shared',
      layerVersionName: 'CitationAnalysis-SharedLayer',
      description: 'Shared Python code and dependencies for Citation Analysis Lambda functions',
    });

    // ========================================
    // Lambda Functions
    // ========================================

    const parseKeywordsFunction = workerFunction(this, 'ParseKeywords', {
      functionName: 'CitationAnalysis-ParseKeywords',
      code: lambdaSourceCode('parse-keywords'),
      layers: [sharedLayer],
      // Resolves the run's scope from every active keyword (projected
      // StatusIndex pages): ~1 MB per 5,000 keywords. 30 s / 256 MB (0.14
      // vCPU) failed the whole run at tens of thousands of keywords; it sits
      // behind Step Functions, not API Gateway, so it may take longer.
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      description: 'Parse keywords from S3 or direct input',
      environment: {
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
        // Enabled query prompts are resolved here for executions whose input
        // does not carry them (EventBridge schedules).
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        // The markets of the run's keywords (BrandConfig item `markets`).
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        // Every run's keyword list is written here as the ProcessKeywords
        // item source (`runs/<execution>/keywords.json`).
        KEYWORDS_BUCKET: keywordsBucket.bucketName,
      },
    });

    // Grant ParseKeywords Lambda read access to the tables it resolves keywords
    // from, and write access to the run-scratch prefix only (its keyword
    // manifests; the Distributed Map reads them through the state machine role).
    keywordsBucket.grantPut(parseKeywordsFunction, `${WORKFLOW_RUNS_PREFIX}*`);
    keywordGroupsTable.grantReadData(parseKeywordsFunction);
    keywordsTable.grantReadData(parseKeywordsFunction);
    queryPromptsTable.grantReadData(parseKeywordsFunction);
    // Each manifest entry carries its keyword's market (BrandConfig item `markets`).
    brandConfigTable.grantReadData(parseKeywordsFunction);

    // Search Lambda Functions: one `CitationAnalysis-Search-<id>` per provider,
    // same code, role and environment, each capped by its reserved concurrency
    // (lib/constructs/provider-search.ts). They replace the single
    // CitationAnalysis-Search that called every provider in sequence. That
    // function's log group is kept, not deleted with it, so earlier runs' logs
    // stay readable until the 30-day retention expires them; nothing writes to
    // it any more.
    monthLogGroup(this, 'SearchLogGroup', '/aws/lambda/CitationAnalysis-Search', cdk.RemovalPolicy.RETAIN);
    const providerSearch = new ProviderSearch(this, 'ProviderSearch', {
      code: lambdaSourceCode('search'),
      role: searchLambdaRole,
      layers: [sharedLayer],
      concurrency: providerConcurrency,
      pacing: providerPacing,
      environment: providerSearchEnvironment(this, {
        searchResultsTable: searchResultsTable.tableName,
        brandConfigTable: brandConfigTable.tableName,
        providerConfigTable: providerConfigTable.tableName,
        rawResponsesBucket: rawResponsesBucket.bucketName,
      }),
      // Google AI Overviews (SEO stack, deployed with this one): a branch, no resource.
      externalProviders: EXTERNAL_SEARCH_PROVIDERS,
    });

    // Grant Search Lambda read/write access to ProviderConfig table.
    // Read: provider enablement before each query. Write: health bookkeeping —
    // record_provider_failure / record_provider_success (shared/provider_health.py)
    // update_item the provider row after every provider result, and the
    // auto-disable path flips `enabled` after repeated terminal failures.
    // Read-only here silently killed the whole health feature: the writes were
    // AccessDenied and swallowed by design (PR #103 review, blocker 1).
    providerConfigTable.grantReadWriteData(searchLambdaRole);

    const deduplicationFunction = workerFunction(this, 'Deduplication', {
      functionName: 'CitationAnalysis-Deduplication',
      code: lambdaSourceCode('deduplication'),
      role: deduplicationLambdaRole,
      layers: [sharedLayer],
      // Every citation is stored since 2.37.0, one update_item each: a keyword
      // with many personas can carry several hundred URLs. Since 2.44.0 it
      // also tallies the run's KPI counts (KeywordRunKpis) and runs the
      // resumable `backfill_keyword_run_kpis` action, which deserializes whole
      // SearchResults partitions: CPU-bound, hence 1024 MB and 300 s.
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      description: 'Deduplicate and prioritize citations; record each keyword run\'s KPI counts',
      environment: {
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_RUN_KPIS: keywordRunKpisTable.tableName,
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        // 2.45.0: the run's KeywordRunBrands row and KeywordLatest object
        // (with its counts block), built for the enabled personas.
        DYNAMODB_TABLE_KEYWORD_RUN_BRANDS: keywordRunBrandsTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        SCOPE_SNAPSHOT_BUCKET: keywordsBucket.bucketName,
      },
    });
    // The run's KPI row: read back (the backfill skips rows already current)
    // and put. The owned domains decide which citations count as first-party;
    // the backfill walks the active keywords.
    keywordRunKpisTable.grant(deduplicationLambdaRole, 'dynamodb:Query', 'dynamodb:PutItem');
    brandConfigTable.grantReadData(deduplicationLambdaRole);
    keywordsTable.grant(deduplicationLambdaRole, 'dynamodb:Scan');
    // 2.45.0: the KeywordLatest object of the run (conditional read-modify-write),
    // the brand row of a capped run, the personas, and the counts block's
    // partition counts (Citations rows, CrawledContent on KeywordIndex).
    allow(deduplicationLambdaRole, ['s3:GetObject', 's3:PutObject'], [keywordsBucket.arnForObjects(`${SCOPE_SNAPSHOT_PREFIX}keywords/*`)]);
    keywordRunBrandsTable.grant(deduplicationLambdaRole, 'dynamodb:PutItem');
    allow(deduplicationLambdaRole, ['dynamodb:Query'], [queryPromptsTable.tableArn, `${queryPromptsTable.tableArn}/index/EnabledIndex`]);
    allow(deduplicationLambdaRole, ['dynamodb:Query'], [`${crawledContentTable.tableArn}/index/KeywordIndex`]);
    // The chained `latest` backfill invokes itself with its cursor (by name:
    // the function's own ARN would make its role policy depend on it).
    allow(deduplicationLambdaRole, ['lambda:InvokeFunction'], [cdk.Arn.format({
      service: 'lambda', resource: 'function', resourceName: 'CitationAnalysis-Deduplication', arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    }, this)]);

    // Crawler Lambda Layer - Browser tools (Playwright + AgentCore)
    // Separate from shared layer to keep each under 250MB limit
    // NOTE: Run scripts/deploy.sh or lambda/crawler-layer/build-layer.sh before cdk deploy
    const crawlerLayer = pythonLayer(this, 'CrawlerLayer', {
      directory: 'crawler-layer',
      label: 'Crawler',
      layerVersionName: 'CitationAnalysis-CrawlerLayer',
      description: 'Browser automation tools (Playwright + AgentCore) for Crawler Lambda',
    });

    // ========================================
    // Pre-Created Custom Browser with Web Bot Auth
    // ========================================
    // Using a pre-created browser instead of creating dynamically per crawl:
    // - Faster crawls (skip browser creation overhead ~10s per crawl)
    // - Consistent signing identity for Web Bot Auth
    // - Lower API costs
    // - Centralized configuration in CDK

    // IAM Role for Browser Signing (required for Web Bot Auth). AgentCore
    // assumes it only for this account's browser resources; no identity policy
    // is required on the signing role itself.
    const browserSigningRole = new iam.Role(this, 'BrowserSigningRole', {
      roleName: 'CitationAnalysis-BrowserSigningRole',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': this.formatArn({
              service: 'bedrock-agentcore',
              resource: '*',
            }),
          },
        },
      }),
      description: 'Role for Bedrock AgentCore Browser signing (Web Bot Auth)',
    });

    const crawlerBrowser = new bedrockagentcore.CfnBrowserCustom(this, 'CrawlerBrowser', {
      name: 'citation_analysis_crawler',
      description: 'Pre-configured browser for citation crawling with Web Bot Auth',
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      browserSigning: {
        enabled: true, // Enables Web Bot Auth to reduce CAPTCHAs
      },
      executionRoleArn: browserSigningRole.roleArn,
    });

    allow(crawlerLambdaRole, [
      'bedrock-agentcore:ConnectBrowserAutomationStream',
      'bedrock-agentcore:StartBrowserSession',
      'bedrock-agentcore:StopBrowserSession',
    ], [crawlerBrowser.attrBrowserArn]);

    // Crawler Lambda Function - Uses ZIP deployment with crawler layer
    const crawlerFunction = workerFunction(this, 'Crawler', {
      functionName: 'CitationAnalysis-Crawler',
      code: lambdaSourceCode('crawler'),
      role: crawlerLambdaRole,
      layers: [crawlerLayer], // Crawler layer includes shared modules (copied during build)
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024, // Increased for browser automation
      description: 'Crawl cited pages using Bedrock AgentCore with screenshots and SEO analysis',
      environment: {
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
        BROWSER_ID: crawlerBrowser.attrBrowserId, // Pre-created browser with Web Bot Auth
        // Below the 300 s Lambda timeout, so a crawl the Lambda is killed in
        // the middle of cannot leave its AgentCore session running (the handler
        // also caps it at its remaining time).
        BROWSER_SESSION_TIMEOUT_SECONDS: '280',
        CRAWL_FRESHNESS_DAYS: '30',
        CRAWL_BLOCKED_FRESHNESS_DAYS: '3',
        CRAWL_CACHE_INDEX_NAME: 'CacheScopeIndex',
        ...bedrockTierEnv,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
      },
    });
    allowSavedBedrockModels(crawlerLambdaRole, providerConfigTable);

    const generateSummaryFunction = workerFunction(this, 'GenerateSummary', {
      functionName: 'CitationAnalysis-GenerateSummary',
      code: lambdaSourceCode('generate-summary'),
      layers: [sharedLayer],
      // Reads one ResultWriter record per keyword (compact child output plus
      // its input, ~1–3 KB each) and builds the full report in memory: a
      // few-thousand-keyword run is tens of MB of JSON to parse and re-serialize.
      // 256 MB / 60 s was sized for the old inline list of ~30 results.
      // In process it builds only what fits one invocation: the run summary
      // (~100 MB), a citation rollup of <= 100k Citations rows (~230 MB
      // measured) and a snapshot build within the 450 MB unit model; anything
      // larger starts CitationAnalysis-ScopeSnapshotBuild (scopeSnapshotBuild),
      // whose worker has one vCPU too. The builders stop 30 s before the 900 s;
      // one vCPU (owner decision 2026-11-07).
      timeout: cdk.Duration.seconds(900),
      memorySize: 1769,
      description: 'Generate execution summary and statistics; start or run the scope snapshot and citation rollup builds',
      environment: {
        CITATION_ROLLUP_BUCKET: keywordsBucket.bucketName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        // 2.45.0: BuildScopeSnapshots and the view jobs (shared/scope_snapshot_build.py,
        // shared/view_job_routes.py): the KeywordLatest objects and builds in the
        // keywords bucket, the per-run history, the personas, and the raw rows a
        // mention job reads.
        SCOPE_SNAPSHOT_BUCKET: keywordsBucket.bucketName,
        DYNAMODB_TABLE_KEYWORD_RUN_KPIS: keywordRunKpisTable.tableName,
        DYNAMODB_TABLE_KEYWORD_RUN_BRANDS: keywordRunBrandsTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
      },
    });

    // Grant GenerateSummary Lambda write access to keywords bucket (for storing
    // summaries) and read access to the ProcessKeywords ResultWriter output.
    keywordsBucket.grantWrite(generateSummaryFunction);
    keywordsBucket.grantRead(generateSummaryFunction, `${WORKFLOW_RUNS_PREFIX}*`);
    // The citation rollup: read every Citations row, the active keywords and
    // the brand config; write, list and prune builds under citation-rollups/.
    citationsTable.grantReadData(generateSummaryFunction);
    keywordsTable.grantReadData(generateSummaryFunction);
    brandConfigTable.grantReadData(generateSummaryFunction);
    keywordsBucket.grantRead(generateSummaryFunction, `${CITATION_ROLLUP_PREFIX}*`);
    keywordsBucket.grantDelete(generateSummaryFunction, `${CITATION_ROLLUP_PREFIX}*`);
    // The scope snapshots: read the KeywordLatest objects, write, list and
    // prune builds and series, and write view-job results and export files
    // (multipart uploads; grantWrite above covers put and abort bucket-wide).
    keywordsBucket.grantRead(generateSummaryFunction, `${SCOPE_SNAPSHOT_PREFIX}*`);
    keywordsBucket.grantDelete(generateSummaryFunction, `${SCOPE_SNAPSHOT_PREFIX}*`);
    keywordRunKpisTable.grant(generateSummaryFunction, 'dynamodb:Query');
    keywordRunBrandsTable.grant(generateSummaryFunction, 'dynamodb:Query');
    allow(generateSummaryFunction, ['dynamodb:Query'], [queryPromptsTable.tableArn, `${queryPromptsTable.tableArn}/index/EnabledIndex`]);
    allow(generateSummaryFunction, ['dynamodb:Query', 'dynamodb:BatchGetItem'], [searchResultsTable.tableArn]);
    // A view job publishes view-job.finished (shared/view_job_events.py) to the default bus, under its own source only.
    allowWhere(generateSummaryFunction, ['events:PutEvents'], [this.formatArn({
      service: 'events', resource: 'event-bus', resourceName: 'default',
    })], { StringEquals: { 'events:source': VIEW_JOB_EVENT_SOURCE } });
    // A finished chained `latest` backfill starts a build; brand-config and
    // persona writes start that backfill.
    deduplicationFunction.addEnvironment('SCOPE_SNAPSHOT_FUNCTION_NAME', generateSummaryFunction.functionName);
    allow(deduplicationLambdaRole, ['lambda:InvokeFunction'], [generateSummaryFunction.functionArn]);

    const kpiAlertsFunction = workerFunction(this, 'KpiAlerts', {
      functionName: 'CitationAnalysis-KpiAlerts',
      code: lambdaSourceCode('kpi-alerts'),
      layers: [sharedLayer],
      // 2.45.0: pools snapshots from the run's KeywordRunKpis rows
      // (BatchGetItem) and deserializes raw answers for keywords without a
      // row and for the like-for-like comparison of both runs. One vCPU
      // (owner decision 2026-11-07). It stops starting groups 30 s before the
      // timeout and lists the rest instead of timing out with nothing written.
      timeout: cdk.Duration.seconds(300),
      memorySize: 1769,
      description: 'Record complete KPI snapshots and evaluate post-run alerts',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
        // Owned domains (first_party_domains) for the citation KPIs of each snapshot.
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KPI_SNAPSHOTS: kpiSnapshotsTable.tableName,
        DYNAMODB_TABLE_KPI_ALERTS: kpiAlertsTable.tableName,
        DYNAMODB_TABLE_ALERT_SETTINGS: alertSettingsTable.tableName,
        DYNAMODB_TABLE_CONTENT_CHANGES: contentChangesTable.tableName,
        KPI_ALERTS_TOPIC_ARN: kpiAlertsTopic.topicArn,
      },
    });

    searchResultsTable.grantReadData(kpiAlertsFunction);
    // 2.45.0: one BatchGetItem of the run's KeywordRunKpis rows per 100
    // keywords, pooled per (group, market); a keyword is read raw only when
    // its row is missing or cannot answer.
    kpiAlertsFunction.addEnvironment('DYNAMODB_TABLE_KEYWORD_RUN_KPIS', keywordRunKpisTable.tableName);
    keywordRunKpisTable.grant(kpiAlertsFunction, 'dynamodb:BatchGetItem');
    keywordsTable.grantReadData(kpiAlertsFunction);
    keywordGroupsTable.grantReadData(kpiAlertsFunction);
    brandConfigTable.grantReadData(kpiAlertsFunction);
    kpiSnapshotsTable.grantReadWriteData(kpiAlertsFunction);
    kpiAlertsTable.grantWriteData(kpiAlertsFunction);
    alertSettingsTable.grantReadData(kpiAlertsFunction);
    contentChangesTable.grantReadData(kpiAlertsFunction);
    kpiAlertsTopic.grantPublish(kpiAlertsFunction);
    kpiAlertsKey.grantEncryptDecrypt(kpiAlertsFunction);
    // The payload's report is GenerateSummary's compact copy; the per-keyword
    // run identity is read back from the full report it stored.
    keywordsBucket.grantRead(kpiAlertsFunction, 'execution-summaries/*');

    // GenerateInsights: one Bedrock call per group the run fully covers (four
    // groups at a time), writing the narrative the insights report reads.
    // POST /api/reports/insights/regenerate invokes it asynchronously too.
    const reportInsightsFunction = workerFunction(this, 'ReportInsights', {
      functionName: 'CitationAnalysis-ReportInsights',
      code: lambdaSourceCode('report-insights'),
      layers: [sharedLayer],
      description: 'Write, validate and store the narrative of each fully covered keyword group',
      // One group per invocation (the GenerateInsights Map): its history
      // window read (CPU-bound deserialization, row cap sized by memory) stops
      // 75 s before the timeout, leaving the Bedrock call and the write their
      // time. 120 s / 512 MB ran every group in one call and lost them all on
      // a timeout. 2.45.0: the window comes from rollups (see
      // TUNED_READ_MEMORY_MB).
      memorySize: TUNED_READ_MEMORY_MB,
      timeout: cdk.Duration.seconds(300),
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_REPORT_INSIGHTS: reportInsightsTable.tableName,
        ...bedrockTierEnv,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
      },
    });

    searchResultsTable.grantReadData(reportInsightsFunction);
    keywordsTable.grantReadData(reportInsightsFunction);
    // History windows read the per-run KPI counts first (shared/scoped_reports.py).
    reportInsightsFunction.addEnvironment('DYNAMODB_TABLE_KEYWORD_RUN_KPIS', keywordRunKpisTable.tableName);
    keywordRunKpisTable.grant(reportInsightsFunction, 'dynamodb:Query');
    brandConfigTable.grantReadData(reportInsightsFunction);
    allow(reportInsightsFunction, ['dynamodb:PutItem'], [reportInsightsTable.tableArn]);
    reportInsightsFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    allowSavedBedrockModels(reportInsightsFunction, providerConfigTable);

    // ========================================
    // Step Functions State Machine
    // ========================================

    // Define the workflow states

    // 1. ParseKeywords Task. It files the run's keyword manifest under the
    // execution name, so the payload carries that next to the input.
    const parseKeywordsTask = lambdaStep(this, 'ParseKeywords', parseKeywordsFunction, stepfunctions.TaskInput.fromObject({
      'execution_input.$': '$',
      'execution_name.$': '$$.Execution.Name',
    }));

    // 2. SearchAllProviders: one Parallel branch per provider Lambda, each
    // queued behind its provider's cap, then MergeProviderResults flattens the
    // branches into the {keyword, timestamp, results} DeduplicateCitations reads.
    const searchAllProviders = providerSearch.searchAllProviders();

    // 3. DeduplicateCitations Task
    const deduplicationTask = lambdaStep(this, 'DeduplicateCitations', deduplicationFunction);

    // 4. CrawlSingleCitation Task
    const crawlTask = lambdaStep(this, 'CrawlSingleCitation', crawlerFunction);

    // Add retry logic for Crawler Lambda
    crawlTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: cdk.Duration.seconds(5),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // Add error handling for crawler failures
    const crawlFailed = new stepfunctions.Pass(this, 'CrawlFailed', {result: stepfunctions.Result.fromObject({ status: 'failed' }),});

    crawlTask.addCatch(crawlFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // 5. CrawlCitations Map State (parallel crawling with concurrency limit).
    // A page takes ~24 s, so 20 pages at 3 at a time was ~163 s per keyword.
    // 10 per keyword x 20 keywords is 200 browser sessions at most, against
    // AgentCore's 1,000 concurrent sessions and 30 StartBrowserSession/s; the
    // crawler has no reserved concurrency, so it shares the account's
    // unreserved Lambda pool. Override with `-c crawlConcurrency=N`.
    const crawlCitationsMap = new stepfunctions.Map(this, 'CrawlCitations', {
      maxConcurrency: readPositiveIntegerContext(this, 'crawlConcurrency', 10),
      itemsPath: '$.deduplicated_citations',
      resultPath: '$.crawled_results',
      itemSelector: {
        'citation.$': '$$.Map.Item.Value',
        'keyword.$': '$.keyword',
      },
    }).itemProcessor(crawlTask);

    // 6. SummarizeKeywordResult: each ProcessKeywords child ends with a
    // compact record. The citation and crawl arrays (~8.5 KB per keyword) are
    // what made the old inline Map output overflow the 256 KiB state at ~31
    // keywords; GenerateSummary only needs their counts. `total_citations_found`
    // comes from the deduplication Lambda because no intrinsic function sums;
    // the filter-in-ArrayLength form was proven with `aws stepfunctions test-state`.
    const summarizeKeywordResult = new stepfunctions.Pass(this, 'SummarizeKeywordResult', {
      parameters: {
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'status.$': '$.status',
        'provider_summary.$': '$.provider_summary',
        'unique_citations.$': 'States.ArrayLength($.deduplicated_citations)',
        'total_citations_found.$': '$.total_citations_found',
        'pages_crawled.$': "States.ArrayLength($.crawled_results[?(@.status == 'success')])",
      },
    });

    // 7. Chain Search -> Deduplication -> Crawl -> compact result
    const processKeywordChain = searchAllProviders
      .next(deduplicationTask)
      .next(crawlCitationsMap)
      .next(summarizeKeywordResult);

    // 8. ProcessKeywords Distributed Map (parallel keyword processing).
    //
    // Distributed rather than inline because an inline Map keeps every
    // iteration in the parent execution: its results in the 256 KiB state
    // (~31 keywords) and ~160 history events per keyword against the 25,000
    // cap (~155 keywords). Here each keyword is its own child execution, the
    // items come from the manifest ParseKeywords wrote to S3, and the results
    // go back to S3 through the ResultWriter, so the parent's state and
    // history stay constant in the keyword count. STANDARD children because a
    // search task can run 15 minutes (Express children are capped at 5).
    //
    // maxConcurrency is the throughput knob; override per deployment with
    // `-c processKeywordsConcurrency=N`. 20 (was 3) is safe because provider
    // calls no longer scale with it: each provider's reserved concurrency caps
    // its calls in flight however many keywords run, and a keyword over a cap
    // waits for a slot. What does scale with it is the crawl (x crawlConcurrency
    // browser sessions) and Lambda concurrency from the unreserved pool.
    const processKeywordsMap = new stepfunctions.DistributedMap(this, 'ProcessKeywords', {
      maxConcurrency: readPositiveIntegerContext(this, 'processKeywordsConcurrency', 20),
      mapExecutionType: stepfunctions.StateMachineType.STANDARD,
      itemReader: new stepfunctions.S3JsonItemReader({
        bucket: keywordsBucket,
        key: stepfunctions.JsonPath.stringAt('$.keywords_manifest.key'),
      }),
      resultWriterV2: new stepfunctions.ResultWriterV2({
        bucket: keywordsBucket,
        prefix: `${WORKFLOW_RUNS_PREFIX}map-results`,
      }),
      toleratedFailurePercentage: PROCESS_KEYWORDS_TOLERATED_FAILURE_PERCENTAGE,
      // Keeps the ParseKeywords fields (keyword_count, timestamp, ...) and adds
      // {MapRunArn, ResultWriterDetails: {Bucket, Key}}.
      resultPath: '$.map_run',
      itemSelector: {
        'keyword.$': '$$.Map.Item.Value.keyword',
        'timestamp.$': '$$.Map.Item.Value.timestamp',
        // query_prompts comes from the ParseKeywords output (this state's
        // input), NOT the raw execution input: scheduled runs don't carry
        // prompts in their input, so ParseKeywords resolves them and always
        // emits the key. Referencing $$.Execution.Input.query_prompts here
        // would raise States.Runtime for scheduled executions.
        'query_prompts.$': '$.query_prompts',
        // The keyword's market (`Market.to_json()`, or null for a global
        // keyword); ParseKeywords writes the key on every manifest entry.
        'market.$': '$$.Map.Item.Value.market',
      },
    }).itemProcessor(processKeywordChain);

    // 9. GenerateSummary Task: reads the per-keyword results from S3 and
    // returns a compact report (the full one is stored in S3).
    const generateSummaryTask = lambdaStep(this, 'GenerateSummary', generateSummaryFunction, stepfunctions.TaskInput.fromObject({
      'execution_id.$': '$$.Execution.Name',
      'map_run.$': '$.map_run',
      'keyword_count.$': '$.keyword_count',
      'timestamp.$': '$.timestamp',
      'summary_bucket': keywordsBucket.bucketName,
    }));

    // 10. Evaluate exact-run KPI alerts without replacing the generated report.
    const kpiAlertsTask = new tasks.LambdaInvoke(this, 'KpiAlerts', {
      lambdaFunction: kpiAlertsFunction,
      payload: stepfunctions.TaskInput.fromObject({
        'execution_id.$': '$$.Execution.Name',
        'execution_input.$': '$$.Execution.Input',
        'report.$': '$',
      }),
      payloadResponseOnly: true,
      resultPath: '$.alerts',
      retryOnServiceExceptions: true,
    });

    const kpiAlertsFailed = new stepfunctions.Pass(this, 'KpiAlertsFailed', {
      result: stepfunctions.Result.fromObject({
        status: 'failed',
        message: 'KPI alert evaluation failed; the analysis report is preserved.',
      }),
      resultPath: '$.alerts',
    });

    kpiAlertsTask.addCatch(kpiAlertsFailed, {
      errors: ['States.ALL'],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    // 11. Write each fully covered group's narrative from KpiAlerts' result
    // (`snapshot_scopes`, `run_timestamp`): one ReportInsights invocation per
    // (group, market), four at a time, so every group gets the whole Lambda
    // timeout for its history read and Bedrock call and one slow group cannot
    // lose the others. A failed KpiAlerts step names no group, so nothing is
    // written. Like KpiAlerts, a failure here keeps the report.
    const generateGroupInsightTask = new tasks.LambdaInvoke(this, 'GenerateGroupInsight', {
      lambdaFunction: reportInsightsFunction,
      payloadResponseOnly: true,
      retryOnServiceExceptions: true,
    });
    generateGroupInsightTask.addCatch(new stepfunctions.Pass(this, 'GenerateGroupInsightFailed', {
      result: stepfunctions.Result.fromObject({ status: 'failed' }),
    }), { errors: ['States.ALL'] });

    const generateInsightsMap = new stepfunctions.Map(this, 'GenerateInsights', {
      itemsPath: '$.alerts.snapshot_scopes',
      itemSelector: {
        'group_id.$': '$$.Map.Item.Value.group_id',
        'market_id.$': '$$.Map.Item.Value.market_id',
        'run_timestamp.$': '$.alerts.run_timestamp',
      },
      maxConcurrency: 4,
      resultSelector: { status: 'completed', 'groups.$': 'States.ArrayLength($)' },
      resultPath: '$.narratives',
    });
    generateInsightsMap.itemProcessor(generateGroupInsightTask);

    const generateInsightsFailed = new stepfunctions.Pass(this, 'GenerateInsightsFailed', {
      result: stepfunctions.Result.fromObject({
        status: 'failed',
        message: 'Narrative generation failed; the analysis report is preserved.',
      }),
      resultPath: '$.narratives',
    });

    generateInsightsMap.addCatch(generateInsightsFailed, {
      errors: ['States.ALL'],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    const noInsightsToGenerate = new stepfunctions.Pass(this, 'NoInsightsToGenerate', {
      result: stepfunctions.Result.fromObject({ status: 'skipped', reason: 'no_complete_groups', groups: 0 }),
      resultPath: '$.narratives',
    });
    const insightsChoice = new stepfunctions.Choice(this, 'HasCompleteGroups')
      .when(stepfunctions.Condition.isPresent('$.alerts.snapshot_scopes'), generateInsightsMap)
      .otherwise(noInsightsToGenerate);

    // 12. Rebuild the citation rollup GET /api/citations serves (per-scope
    // totals and pages, shared/citation_rollup.py) from the Citations rows
    // this run wrote. Last, after KpiAlerts read `$` as its report. A failed
    // build keeps the report and the previous rollup (the API reads live and
    // asks for a rebuild when a scope is stale).
    const buildCitationRollupTask = new tasks.LambdaInvoke(this, 'BuildCitationRollup', {
      lambdaFunction: generateSummaryFunction,
      payload: stepfunctions.TaskInput.fromObject({
        action: 'build_citation_rollup',
        'execution_id.$': '$$.Execution.Name',
      }),
      payloadResponseOnly: true,
      resultPath: '$.citation_rollup',
      retryOnServiceExceptions: true,
    });
    buildCitationRollupTask.addCatch(new stepfunctions.Pass(this, 'BuildCitationRollupFailed', {
      result: stepfunctions.Result.fromObject({
        status: 'failed',
        message: 'Citation rollup build failed; the analysis report is preserved.',
      }),
      resultPath: '$.citation_rollup',
    }), { errors: ['States.ALL'], resultPath: stepfunctions.JsonPath.DISCARD });

    // 12b. Build the scope snapshots (design 2.45.0, shared/scope_snapshot_build.py)
    // from the KeywordLatest objects this run's Deduplication steps wrote:
    // after KpiAlerts read `$` as its report, before GenerateInsights, which
    // reads a large group's facts from the fresh build. A failed build keeps
    // the report and the previous build (readers see it as stale and ask for
    // a rebuild).
    const buildScopeSnapshotsTask = new tasks.LambdaInvoke(this, 'BuildScopeSnapshots', {
      lambdaFunction: generateSummaryFunction,
      payload: stepfunctions.TaskInput.fromObject({
        action: 'build_scope_snapshots',
        'execution_id.$': '$$.Execution.Name',
      }),
      payloadResponseOnly: true,
      resultPath: '$.scope_snapshots',
      retryOnServiceExceptions: true,
    });
    buildScopeSnapshotsTask.addCatch(new stepfunctions.Pass(this, 'BuildScopeSnapshotsFailed', {
      result: stepfunctions.Result.fromObject({
        status: 'failed',
        message: 'Scope snapshot build failed; the analysis report is preserved.',
      }),
      resultPath: '$.scope_snapshots',
    }).next(insightsChoice), { errors: ['States.ALL'], resultPath: stepfunctions.JsonPath.DISCARD });

    // 13. Define the complete workflow. Both alert branches retain every
    // GenerateSummary field and add only the top-level alerts block; the
    // snapshot step adds only `scope_snapshots`, the insights step only
    // `narratives`, the rollup step `citation_rollup`.
    const definition = parseKeywordsTask
      .next(processKeywordsMap)
      .next(generateSummaryTask)
      .next(kpiAlertsTask);
    kpiAlertsFailed.next(buildScopeSnapshotsTask);
    kpiAlertsTask.next(buildScopeSnapshotsTask);
    buildScopeSnapshotsTask.next(insightsChoice);
    generateInsightsMap.next(buildCitationRollupTask);
    generateInsightsFailed.next(buildCitationRollupTask);
    noInsightsToGenerate.next(buildCitationRollupTask);

    // 14. Create the State Machine (log group and logging rationale at
    // `loggedStateMachine`).
    const stateMachine = loggedStateMachine(this, 'CitationAnalysisStateMachine', {
      logGroupId: 'StateMachineLogGroup',
      stateMachineName: WORKFLOW_STATE_MACHINE_NAME,
      definition,
      role: stepFunctionsRole,
      timeout: cdk.Duration.days(WORKFLOW_TIMEOUT_DAYS),
    });

    // ProcessKeywords runs each keyword as a child execution of this same
    // state machine. CDK grants the ItemReader's s3:GetObject, the
    // ResultWriter's s3:PutObject/GetObject/ListMultipartUploadParts/
    // AbortMultipartUpload, and (in its DistributedMapPolicy) StartExecution
    // plus Describe/StopExecution on `execution:<name>:*` — which matches the
    // parent only. Child executions are named `execution:<name>/<map run
    // label>:<id>`, so describing and stopping them needs the `/*` form. The
    // ARN is formatted from the name: `stateMachine.stateMachineArn` in the
    // role's own default policy would be a circular dependency.
    allow(stepFunctionsRole, ['states:DescribeExecution', 'states:StopExecution'], [
      `arn:aws:states:${this.region}:${this.account}:execution:${WORKFLOW_STATE_MACHINE_NAME}/*`,
    ]);

    // ========================================
    // Keyword Research State Machine
    // ========================================
    //
    // One execution per research job (keyword expansion, competitor URL
    // analysis or the research agent). Every step checkpoints its own result
    // into the job row the moment it finishes, so a provider that times out
    // costs its own step, not the job, and the API can show partial results
    // while the rest are still running.
    //
    //   Plan -> Map(ExecuteResearchStep | FailResearchStep) -> Evaluate -> continue?
    //     ^                                                                 | yes
    //     +-----------------------------------------------------------------+
    //                                                                       | no
    //                                                                       v
    //                                                                    Finalize
    //                                            any crash -> FailResearchJob
    //
    // Expansion and competitor jobs run one step per configured provider and
    // Evaluate answers `stop` immediately. Agent jobs (2.5.0) run one step per
    // model-planned query; Evaluate asks a model whether another round is
    // worth it, bounded by the job's max_rounds (hard cap 3 in the worker).
    //
    // This replaced the KeywordMgmt Lambda invoking itself asynchronously
    // (2.2.0): that path ran every provider sequentially inside one 120s
    // Lambda, a SIGKILL at the timeout left rows at `processing` forever, and
    // a failed dispatch fell back to running the LLM calls on the API request.

    const researchWorkerFunction = workerFunction(this, 'ResearchWorker', {
      functionName: 'CitationAnalysis-ResearchWorker',
      code: lambdaSourceCode('research-worker'),
      layers: [sharedLayer],
      // Invoked by Step Functions, not API Gateway. One step is one provider
      // call: at most two HTTP attempts of up to 120s each plus backoff.
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      description: 'Keyword research steps: plan, one web-search provider call per step, evaluate, finalize',
      environment: {
        DYNAMODB_TABLE_KEYWORD_RESEARCH: keywordResearchTable.tableName,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
        ...bedrockTierEnv,
      },
    });
    keywordResearchTable.grantReadWriteData(researchWorkerFunction);
    // Research uses the OpenAI / Gemini model chosen in Settings › AI Providers.
    providerConfigTable.grantReadData(researchWorkerFunction);
    perplexitySecret.grantRead(researchWorkerFunction);
    openaiSecret.grantRead(researchWorkerFunction);
    geminiSecret.grantRead(researchWorkerFunction);
    // The agent's Google signals step (related searches, People Also Ask,
    // autocomplete) runs only when a SerpAPI key is configured.
    serpapiSecret.grantRead(researchWorkerFunction);
    // The agent's plan / evaluate / select calls (shared/models.py roles
    // RESEARCH_PLANNING and RESEARCH_EVALUATION).
    researchWorkerFunction.addToRolePolicy(claudeInvokeModelStatement(this));

    // Every worker call carries the job's fencing envelope: the attempt and
    // round it belongs to, and the execution that issued it.
    const researchEnvelope = {
      'attempt.$': '$.attempt',
      'expected_round.$': '$.expected_round',
      'execution_arn.$': '$$.Execution.Id',
      'execution_id.$': '$$.Execution.Name',
    };
    const researchStep = (id: string, payload?: Record<string, unknown>): tasks.LambdaInvoke => lambdaStep(
      this,
      id,
      researchWorkerFunction,
      payload === undefined ? undefined : stepfunctions.TaskInput.fromObject(payload)
    );

    const planResearchTask = researchStep('PlanResearch', {
      action: 'plan',
      'job_id.$': '$.job_id',
      'retry.$': '$.retry',
      ...researchEnvelope,
    });

    const executeResearchStepTask = researchStep('ExecuteResearchStep');
    // Provider errors are recorded by the worker and never raised, so the only
    // failures reaching Step Functions are the worker itself dying: a function
    // timeout or out-of-memory surfaces as Lambda.Unknown. One more attempt.
    executeResearchStepTask.addRetry({
      errors: ['Lambda.Unknown'],
      interval: cdk.Duration.seconds(5),
      maxAttempts: 1,
    });

    // A step the worker could not finish is still accounted for: without this
    // the job would wait for a step that nothing will ever write.
    const failResearchStepTask = researchStep('FailResearchStep', {
      action: 'fail_step',
      'job_id.$': '$.job_id',
      'step_id.$': '$.step_id',
      'provider.$': '$.provider',
      ...researchEnvelope,
      'error.$': '$.error',
    });
    executeResearchStepTask.addCatch(failResearchStepTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const executeResearchStepsMap = new stepfunctions.Map(this, 'ExecuteResearchSteps', {
      maxConcurrency: RESEARCH_STEP_CONCURRENCY,
      itemsPath: '$.steps',
      resultPath: '$.step_results',
      itemSelector: {
        action: 'execute_step',
        'job_id.$': '$.job_id',
        'step_id.$': '$$.Map.Item.Value.step_id',
        'provider.$': '$$.Map.Item.Value.provider',
        ...researchEnvelope,
      },
    }).itemProcessor(executeResearchStepTask);

    const finalizeResearchTask = researchStep('FinalizeResearch', {
      action: 'finalize',
      'job_id.$': '$.job_id',
      ...researchEnvelope,
      // Finalize closes the round the job reached; overriding keeps the key's
      // place in the envelope.
      'expected_round.$': '$.round',
    });

    // After every round the worker decides whether to plan another one. Its
    // output preserves the attempt/execution envelope and advances
    // `expected_round` only for `continue`, so a looped Plan remains fenced.
    const evaluateResearchTask = researchStep('EvaluateResearch', {
      action: 'evaluate',
      'job_id.$': '$.job_id',
      ...researchEnvelope,
    });

    // Anything that escapes Plan, the Map, Evaluate or Finalize marks the job
    // failed so the UI never polls a job whose execution is gone.
    const failResearchJobTask = researchStep('FailResearchJob', {
      action: 'fail',
      'job_id.$': '$.job_id',
      ...researchEnvelope,
      'error.$': '$.error',
    });
    failResearchJobTask.next(new stepfunctions.Fail(this, 'ResearchJobFailed', {
      error: 'ResearchJobFailed',
      cause: 'The research job could not be completed; see the job row for details.',
    }));
    for (const state of [planResearchTask, executeResearchStepsMap, evaluateResearchTask, finalizeResearchTask]) {
      state.addCatch(failResearchJobTask, { errors: ['States.ALL'], resultPath: '$.error' });
    }

    // The loop is bounded by the worker (max_rounds, hard cap 3): Evaluate
    // answers `stop` at the cap, so the Choice can never spin.
    const researchContinueChoice = new stepfunctions.Choice(this, 'ResearchContinue')
      .when(stepfunctions.Condition.stringEquals('$.decision', 'continue'), planResearchTask)
      .otherwise(finalizeResearchTask);

    const researchDefinition = planResearchTask
      .next(executeResearchStepsMap)
      .next(evaluateResearchTask)
      .next(researchContinueChoice);

    // Same logging as the workflow: on a Map, the per-iteration input is the
    // evidence worth having after a failed run.
    const researchStateMachine = loggedStateMachine(this, 'KeywordResearchStateMachine', {
      logGroupId: 'ResearchStateMachineLogGroup',
      stateMachineName: 'CitationAnalysis-KeywordResearch',
      definition: researchDefinition,
      role: stepFunctionsRole,
      timeout: cdk.Duration.minutes(RESEARCH_STATE_MACHINE_TIMEOUT_MINUTES),
    });

    // ========================================
    // Outputs
    // ========================================

    // Export table names for use by Lambda functions
    exportedOutput(this, 'SearchResultsTableName', searchResultsTable.tableName, 'DynamoDB table for search results');
    exportedOutput(this, 'CitationsTableName', citationsTable.tableName, 'DynamoDB table for deduplicated citations');
    exportedOutput(this, 'CrawledContentTableName', crawledContentTable.tableName, 'DynamoDB table for crawled content');
    exportedOutput(this, 'QueryPromptsTableName', queryPromptsTable.tableName, 'DynamoDB table for query prompt templates');

    // Export secret ARNs
    exportedOutput(this, 'OpenAISecretArn', openaiSecret.secretArn, 'ARN of OpenAI API key secret');
    exportedOutput(this, 'PerplexitySecretArn', perplexitySecret.secretArn, 'ARN of Perplexity API key secret');
    exportedOutput(this, 'GeminiSecretArn', geminiSecret.secretArn, 'ARN of Gemini API key secret');
    exportedOutput(this, 'ClaudeSecretArn', claudeSecret.secretArn, 'ARN of Claude API key secret');

    // Export IAM role ARNs
    exportedOutput(this, 'SearchLambdaRoleArn', searchLambdaRole.roleArn, 'ARN of Search Lambda IAM role');
    exportedOutput(this, 'DeduplicationLambdaRoleArn', deduplicationLambdaRole.roleArn, 'ARN of Deduplication Lambda IAM role');
    exportedOutput(this, 'CrawlerLambdaRoleArn', crawlerLambdaRole.roleArn, 'ARN of Crawler Lambda IAM role');
    exportedOutput(this, 'StepFunctionsRoleArn', stepFunctionsRole.roleArn, 'ARN of Step Functions IAM role');

    // Export Lambda Layer ARNs
    exportedOutput(this, 'SharedLayerArn', sharedLayer.layerVersionArn, 'ARN of shared Lambda Layer');
    exportedOutput(this, 'CrawlerLayerArn', crawlerLayer.layerVersionArn, 'ARN of Crawler Lambda Layer (browser tools)');

    // Export S3 bucket names
    exportedOutput(this, 'KeywordsBucketName', keywordsBucket.bucketName, 'S3 bucket for keywords files');
    exportedOutput(this, 'ScreenshotsBucketName', screenshotsBucket.bucketName, 'S3 bucket for page screenshots');
    exportedOutput(this, 'RawResponsesBucketName', rawResponsesBucket.bucketName, 'S3 bucket for raw API responses');

    // Export Lambda function ARNs
    exportedOutput(this, 'ParseKeywordsFunctionArn', parseKeywordsFunction.functionArn, 'ARN of ParseKeywords Lambda function');
    exportedOutput(this, 'DeduplicationFunctionArn', deduplicationFunction.functionArn, 'ARN of Deduplication Lambda function');
    exportedOutput(this, 'CrawlerFunctionArn', crawlerFunction.functionArn, 'ARN of Crawler Lambda function');
    exportedOutput(this, 'GenerateSummaryFunctionArn', generateSummaryFunction.functionArn, 'ARN of GenerateSummary Lambda function');

    // Export Step Functions state machine ARN
    exportedOutput(this, 'StateMachineArn', stateMachine.stateMachineArn, 'ARN of Step Functions state machine');

    // ========================================
    // Visualization Dashboard - API Gateway + Lambda
    // ========================================

    // API Lambda Functions
    
    // Health Check Lambda - No authentication required. It imports
    // `shared.api_response` for the CORS headers, so it needs the shared
    // layer like every other API function (it shipped without it once and
    // answered 502 to every monitor).
    const healthCheckFunction = apiFunction(this, 'HealthCheck', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES.health,
      handlerFiles: ['health.py'],
      timeout: cdk.Duration.seconds(5),
      // Python + the shared layer idle at ~95 MB; at 128 MB the function ran at
      // 74% of its memory (14-day CloudWatch REPORT peak, 2026-09-18).
      memorySize: 512,
      description: 'API: Health check endpoint for monitoring',
    });
    

    // Consolidated Stats & Insights Lambda
    // Replaces 6 individual Lambdas: get-stats, get-visibility-metrics, get-prompt-insights,
    // get-citation-gaps, get-recommendations, get-historical-trends
    // Routes requests based on API Gateway resource path
    const statsInsightsFunction = apiFunction(this, 'StatsInsights', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['stats-insights'],
      handlerFiles: [
        'stats-insights.py',
        'get-stats.py',
        'get-visibility-metrics.py',
        'get-sentiment-examples.py',
        'get-prompt-insights.py',
        'get-citation-gaps.py',
        'get-recommendations.py',
        'get-historical-trends.py',
        'get-reports-overview.py',
        'recommendation-status.py',
        'get-reports-competitor.py',
        'get-group-kpi-history.py',
        'get-reports-insights.py',
        'regenerate-report-insights.py',
      ],
      // Every route here is read-only bar a millisecond-scale put_item on
      // POST /recommendations/{id}/status, and recommendations are regenerated
      // per call rather than persisted — so nothing is lost by capping at the
      // gateway ceiling. Sized for CPU (see TUNED_READ_MEMORY_MB): Power
      // Tuning chose 1024 MB for /visibility and 768 MB for /trends; one vCPU
      // keeps margin for live scopes, and the window row cap
      // (shared/scoped_reports.py) scales with this size.
      memorySize: TUNED_READ_MEMORY_MB,
      description: 'API: Consolidated stats, visibility, insights, gaps, recommendations, and trends',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        ...bedrockTierEnv,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        // recommendation status (read for left-join, write for the
        // POST /recommendations/{id}/status route)
        DYNAMODB_TABLE_RECOMMENDATION_STATUS: recommendationStatusTable.tableName,
        // Stored narratives, read by GET /reports/insights; the worker that
        // POST /reports/insights/regenerate (Admin) starts asynchronously.
        DYNAMODB_TABLE_REPORT_INSIGHTS: reportInsightsTable.tableName,
        REPORT_INSIGHTS_FUNCTION_NAME: reportInsightsFunction.functionName,
      },
    });

    // Consolidated Citations & Content Lambda
    // Replaces 5 individual Lambdas: get-citations, get-url-breakdown, get-searches,
    // get-crawled-content, browse-raw-responses
    const citationsContentFunction = apiFunction(this, 'CitationsContent', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['citations-content'],
      handlerFiles: [
        'citations-content.py',
        'get-citations.py',
        'get-url-breakdown.py',
        'get-searches.py',
        'get-crawled-content.py',
        'browse-raw-responses.py',
      ],
      // Sized for CPU, not memory: at 512 MB an unscoped /citations Scan of
      // 71k rows used 224 MB and still timed out at 29 s on CPU (a customer
      // log, 2026-11-04). Power Tuning chose 1280 MB for /citations and
      // /searches; one vCPU keeps margin (see TUNED_READ_MEMORY_MB).
      memorySize: TUNED_READ_MEMORY_MB,
      description: 'API: Consolidated citations, URL breakdown, searches, crawled content, and raw responses',
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        // /citations resolves group_id / keyword_ids scopes against the keywords table.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
        // /citations serves scope pages from the rollup GenerateSummary builds
        // and asks that function for a rebuild when a scope is stale.
        CITATION_ROLLUP_BUCKET: keywordsBucket.bucketName,
        CITATION_ROLLUP_FUNCTION_NAME: generateSummaryFunction.functionName,
      },
    });
    keywordsBucket.grantRead(citationsContentFunction, `${CITATION_ROLLUP_PREFIX}*`);
    keywordsBucket.grantPut(citationsContentFunction, `${CITATION_ROLLUP_PREFIX}rebuild-requested.json`);
    generateSummaryFunction.grantInvoke(citationsContentFunction);


    const getBrandMentionsFunction = apiFunction(this, 'GetBrandMentions', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['brand-mentions'],
      handlerFiles: ['get-brand-mentions.py'],
      // CPU-bound: up to 100 keywords' latest runs deserialized per request;
      // 256 MB (0.14 vCPU) took 5.6 s for 16 keywords. Power Tuning chose
      // 1280 MB; one vCPU keeps margin (see TUNED_READ_MEMORY_MB).
      memorySize: TUNED_READ_MEMORY_MB,
      description: 'API: Get brand mentions from search results',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        // group_id / keyword_ids scopes resolve against the keywords table.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
      },
    });

    const manageBrandConfigFunction = apiFunction(this, 'ManageBrandConfig', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['brand-config'],
      handlerFiles: ['manage-brand-config.py'],
      // 2.45.0: a 26 s invocation at 256 MB (0.14 vCPU) came 3 s from the
      // gateway's 29 s limit; 1024 MB (owner decision 2026-11-07) quadruples
      // its CPU share.
      memorySize: 1024,
      description: 'API: Manage brand tracking configuration',
      environment: {
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        ...bedrockTierEnv,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
      },
    });

    // Consolidated Keyword Management Lambda (get-keywords + manage-keywords + keyword-research)
    const keywordMgmtFunction = apiFunction(this, 'KeywordMgmt', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['keyword-mgmt'],
      handlerFiles: [
        'keyword-mgmt.py',
        'get-keywords.py',
        'manage-keywords.py',
        'manage-keyword-groups.py',
        'keyword-research.py',
        'promote-keywords.py',
      ],
      // Keyword research runs in its own state machine since 2.2.0; this
      // function only starts executions and reads rows, so the gateway
      // ceiling applies like any other API function. 1024 MB: group deletes,
      // membership edits and promotions write 10 rows at a time, CPU-bound at
      // 256 MB (0.14 vCPU, ~5 s cold starts measured live).
      memorySize: 1024,
      description: 'API: Consolidated keyword get/create/update/delete, keyword groups and keyword research',
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_RESEARCH: keywordResearchTable.tableName,
        DYNAMODB_TABLE_RESEARCH_TEMPLATES: researchTemplatesTable.tableName,
        RESEARCH_STATE_MACHINE_ARN: researchStateMachine.stateMachineArn,
        // Keyword create/update checks a keyword's market_id against the markets.
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });

    // Consolidated Config Management Lambda (query-prompts, schedules, providers, KPI alerts, custom reports and markets)
    const configMgmtFunction = apiFunction(this, 'ConfigMgmt', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['config-mgmt'],
      handlerFiles: [
        'config-mgmt.py',
        'manage-query-prompts.py',
        'manage-schedule.py',
        'manage-providers.py',
        'manage-bedrock-models.py',
        'manage-alerts.py',
        'manage-custom-reports.py',
        'manage-markets.py',
      ],
      // Provider and model checks, market proposals and schedule pages run
      // under the request deadline and are I/O-bound. 2.45.0: Power Tuning
      // chose 256 MB for /query-prompts and the 30-day REPORT audit peaked at
      // 48% of 256 MB; 1024 MB (owner decision 2026-11-07) for the 2.8 s
      // cold starts measured live at 256 MB.
      memorySize: 1024,
      description: 'API: Consolidated query prompts, schedules, providers, KPI alerts, custom reports and markets',
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        // An Admin's change to the daily limit of paid DataForSEO calls is audited there (D4; by name).
        DYNAMODB_TABLE_MCP_STATE: MCP_STATE_TABLE_NAME,
        ...webSearchEnv,
        DYNAMODB_TABLE_KPI_ALERTS: kpiAlertsTable.tableName,
        DYNAMODB_TABLE_ALERT_SETTINGS: alertSettingsTable.tableName,
        DYNAMODB_TABLE_CONTENT_CHANGES: contentChangesTable.tableName,
        DYNAMODB_TABLE_CUSTOM_REPORTS: customReportsTable.tableName,
        KPI_ALERTS_TOPIC_ARN: kpiAlertsTopic.topicArn,
        // Schedules and content-change markers validate group ids.
        DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
        // /api/markets stores the market list (BrandConfig item `markets`) and
        // refuses to drop a market that keywords still use.
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        // POST /api/markets asks Bedrock for each market's local keyword.
        ...bedrockTierEnv,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        // Schedule kinds of the SEO stack's paid snapshot runs (by name: the SEO stack depends on this one).
        SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN: seoStateMachineArn(this, SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE),
        SEO_BACKLINK_SNAPSHOTS_STATE_MACHINE_ARN: seoStateMachineArn(this, BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME),
        SCHEDULE_ROLE_ARN: schedulerRole.roleArn,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });

    // Consolidated Execution Management Lambda (trigger-analysis + trigger-keyword-analysis + get-execution-status)
    const executionMgmtFunction = apiFunction(this, 'ExecutionMgmt', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['execution-mgmt'],
      handlerFiles: [
        'execution-mgmt.py',
        'trigger-analysis.py',
        'trigger-keyword-analysis.py',
        'get-execution-status.py',
      ],
      // Run triggers resolve their scope from every active keyword: I/O-bound
      // (2.45.0 30-day REPORT audit: 41% of memory at 256 MB); 1024 MB (owner
      // decision 2026-11-07) for short cold starts.
      memorySize: 1024,
      description: 'API: Consolidated trigger analysis and execution status',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        // Audit #12 canonical names.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
      },
    });

    // Grant consolidated stats-insights function access to all required tables
    searchResultsTable.grantReadData(statsInsightsFunction);
    citationsTable.grantReadData(statsInsightsFunction);
    // Trends, overview, group KPIs and insights sum the per-run KPI counts.
    statsInsightsFunction.addEnvironment('DYNAMODB_TABLE_KEYWORD_RUN_KPIS', keywordRunKpisTable.tableName);
    keywordRunKpisTable.grant(statsInsightsFunction, 'dynamodb:Query');
    crawledContentTable.grantReadData(statsInsightsFunction);
    keywordsTable.grantReadData(statsInsightsFunction);
    brandConfigTable.grantReadData(statsInsightsFunction);
    // The same Lambda serves both GET /recommendations (read-only join)
    // and POST /recommendations/{id}/status (write upsert), so it
    // needs read-write on the status table.
    recommendationStatusTable.grantReadWriteData(statsInsightsFunction);
    // Grant Bedrock access for LLM-enhanced recommendations (get-recommendations.py)
    statsInsightsFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    allowSavedBedrockModels(statsInsightsFunction, providerConfigTable);
    allow(statsInsightsFunction, ['dynamodb:GetItem'], [reportInsightsTable.tableArn]);
    reportInsightsFunction.grantInvoke(statsInsightsFunction);
    // Grant consolidated citations-content function access to all required tables and buckets
    citationsTable.grantReadData(citationsContentFunction);
    searchResultsTable.grantReadData(citationsContentFunction);
    brandConfigTable.grantReadData(citationsContentFunction);
    crawledContentTable.grantReadData(citationsContentFunction);
    keywordsTable.grantReadData(citationsContentFunction);
    screenshotsBucket.grantRead(citationsContentFunction);
    rawResponsesBucket.grantRead(citationsContentFunction);

    // Grant keyword management function access
    keywordsTable.grantReadWriteData(keywordMgmtFunction);
    keywordGroupsTable.grantReadWriteData(keywordMgmtFunction);
    keywordResearchTable.grantReadWriteData(keywordMgmtFunction);
    researchTemplatesTable.grantReadWriteData(keywordMgmtFunction);
    // Secrets are read only to answer "is any provider configured?" before a
    // job is created; the worker reads them again to make the calls.
    perplexitySecret.grantRead(keywordMgmtFunction);
    openaiSecret.grantRead(keywordMgmtFunction);
    geminiSecret.grantRead(keywordMgmtFunction);
    researchStateMachine.grantStartExecution(keywordMgmtFunction);
    // A keyword's market_id must name a configured market.
    brandConfigTable.grantReadData(keywordMgmtFunction);

    // Grant config management function access
    queryPromptsTable.grantReadWriteData(configMgmtFunction);
    providerConfigTable.grantReadWriteData(configMgmtFunction);
    keywordGroupsTable.grantReadData(configMgmtFunction);
    kpiAlertsTable.grantReadWriteData(configMgmtFunction);
    alertSettingsTable.grantReadWriteData(configMgmtFunction);
    contentChangesTable.grantReadWriteData(configMgmtFunction);
    customReportsTable.grantReadWriteData(configMgmtFunction);
    // /api/markets: the market list lives in BrandConfig; the in-use check scans Keywords.
    brandConfigTable.grantReadWriteData(configMgmtFunction);
    keywordsTable.grantReadData(configMgmtFunction);
    grantAuditPut(this, configMgmtFunction);
    allow(configMgmtFunction, ['sns:ListSubscriptionsByTopic', 'sns:Publish', 'sns:Subscribe'], [kpiAlertsTopic.topicArn]);
    allow(configMgmtFunction, ['sns:Unsubscribe'], [`${kpiAlertsTopic.topicArn}:*`]);
    kpiAlertsKey.grantEncryptDecrypt(configMgmtFunction);
    // Settings › Bedrock models (manage-bedrock-models.py): list the global
    // Claude inference profiles, read their quotas, and test a model with a
    // live Converse call before it is saved. Listing and quota reads take no
    // resource-level permissions, hence `*`.
    configMgmtFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    configMgmtFunction.addToRolePolicy(webSearchPolicyStatement(this.account, webSearchRegion));
    allow(configMgmtFunction, ['bedrock:ListInferenceProfiles', 'bedrock:GetInferenceProfile'], ['*']);
    allow(configMgmtFunction, ['servicequotas:ListServiceQuotas', 'servicequotas:GetServiceQuota'], ['*']);
    // POST /api/schedules/{id}/run starts an analysis with the schedule's scope.
    stateMachine.grantStartExecution(configMgmtFunction);
    openaiSecret.grantRead(configMgmtFunction);
    openaiSecret.grantWrite(configMgmtFunction);
    perplexitySecret.grantRead(configMgmtFunction);
    perplexitySecret.grantWrite(configMgmtFunction);
    geminiSecret.grantRead(configMgmtFunction);
    geminiSecret.grantWrite(configMgmtFunction);
    claudeSecret.grantRead(configMgmtFunction);
    claudeSecret.grantWrite(configMgmtFunction);
    allow(
      configMgmtFunction,
      ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:GetSecretValue'],
      [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:citation-analysis/*`]
    );
    allow(
      configMgmtFunction,
      ['scheduler:CreateSchedule', 'scheduler:GetSchedule', 'scheduler:DeleteSchedule', 'scheduler:UpdateSchedule'],
      [`arn:aws:scheduler:${this.region}:${this.account}:schedule/citation-analysis-schedules/*`]
    );
    allow(configMgmtFunction, ['scheduler:ListSchedules'], ['*']);
    // The rank trackers' own schedules (SEO stack), listed read-only on the Schedule page.
    allow(configMgmtFunction, ['scheduler:GetSchedule'], [
      `arn:aws:scheduler:${this.region}:${this.account}:schedule/${RANK_TRACKER_SCHEDULE_GROUP}/*`,
    ]);
    // "Run now" of a snapshot schedule, and the timed runs of one.
    const seoSnapshotMachines = [SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE, BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME]
      .map((name) => seoStateMachineArn(this, name));
    // DescribeStateMachine: a snapshot kind is refused (400) while the SEO stack is not deployed.
    allow(configMgmtFunction, ['states:DescribeStateMachine', 'states:StartExecution'], seoSnapshotMachines);
    allow(schedulerRole, ['states:StartExecution'], seoSnapshotMachines);
    allow(
      configMgmtFunction,
      ['scheduler:CreateScheduleGroup', 'scheduler:GetScheduleGroup'],
      [`arn:aws:scheduler:${this.region}:${this.account}:schedule-group/citation-analysis-schedules`]
    );
    allow(configMgmtFunction, ['iam:PassRole'], [schedulerRole.roleArn]);

    // Grant execution management function access
    keywordsTable.grantReadData(executionMgmtFunction);
    keywordGroupsTable.grantReadData(executionMgmtFunction);
    queryPromptsTable.grantReadData(executionMgmtFunction);
    allow(executionMgmtFunction, ['states:StartExecution'], [stateMachine.stateMachineArn]);
    const workflowExecutionArns = `arn:aws:states:${this.region}:${this.account}:execution:${WORKFLOW_STATE_MACHINE_NAME}:*`;
    allow(executionMgmtFunction, ['states:DescribeExecution', 'states:GetExecutionHistory'], [workflowExecutionArns]);
    allow(executionMgmtFunction, ['states:ListExecutions'], [stateMachine.stateMachineArn]);
    // Keyword progress of a running execution comes from its ProcessKeywords
    // map run (item counts). DescribeMapRun is authorized on the map run ARN,
    // ListMapRuns on the parent execution ARN.
    allow(
      executionMgmtFunction,
      ['states:DescribeMapRun'],
      [`arn:aws:states:${this.region}:${this.account}:mapRun:${WORKFLOW_STATE_MACHINE_NAME}/*`]
    );
    allow(executionMgmtFunction, ['states:ListMapRuns'], [workflowExecutionArns]);

    searchResultsTable.grantReadData(getBrandMentionsFunction);
    brandConfigTable.grantReadData(getBrandMentionsFunction);
    keywordsTable.grantReadData(getBrandMentionsFunction);

    // ========================================
    // Persona Rankings API
    // ========================================

    const getPersonaRankingsFunction = apiFunction(this, 'GetPersonaRankings', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['persona-rankings'],
      handlerFiles: ['get-persona-rankings.py'],
      // 2.45.0: Power Tuning (balanced, 10 invocations per power) chose
      // 512 MB; 1024 MB (owner decision 2026-11-07) for short cold starts.
      memorySize: 1024,
      description: 'API: Get per-persona brand ranking breakdowns',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getPersonaRankingsFunction);
    queryPromptsTable.grantReadData(getPersonaRankingsFunction);

    // ========================================
    // Self-Reflection API
    // ========================================

    const selfReflectionFunction = apiFunction(this, 'SelfReflection', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['self-reflection'],
      handlerFiles: ['self-reflection.py'],
      // Deliberately ABOVE the 29s gateway ceiling — do not "fix" this to 29.
      //
      // POST answers at once (200 from cache, or 202 with a pending job row)
      // and invokes this function asynchronously for the Bedrock job, which
      // runs under a 56 s budget, stores the result and clears the job row.
      // That background invocation has no gateway in front of it and needs
      // the 60 s; the request path itself never waits on Bedrock.
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      description: 'API: LLM self-reflection analysis for brand rankings',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_SELF_REFLECTION: selfReflectionTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        // NOTE: `shared/models.py` resolves the analysis model from
        // BEDROCK_TIER_<ROLE> (see `bedrockTierEnv`), which this function does
        // not spread, so ModelRole.ANALYSIS falls through to its hardcoded
        // BALANCED default: Sonnet 5.5 with medium adaptive-thinking effort.
        // Moving it to Haiku is a product decision (analysis quality and
        // cost) — do it by spreading `bedrockTierEnv` and setting
        // BEDROCK_TIER_ANALYSIS, not by adding an env var nothing reads.
      },
    });
    searchResultsTable.grantReadData(selfReflectionFunction);
    brandConfigTable.grantReadData(selfReflectionFunction);
    queryPromptsTable.grantReadData(selfReflectionFunction);
    selfReflectionTable.grantReadWriteData(selfReflectionFunction);
    selfReflectionFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    allowSavedBedrockModels(selfReflectionFunction, providerConfigTable);
    // POST /self-reflection runs its Bedrock job by invoking itself
    // asynchronously. Named by ARN, not `grantInvoke(selfReflectionFunction)`,
    // which would make the function's role policy depend on the function.
    allow(selfReflectionFunction, ['lambda:InvokeFunction'], [cdk.Stack.of(this).formatArn({
      service: 'lambda',
      resource: 'function',
      resourceName: 'CitationAnalysis-API-SelfReflection',
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    })]);

    brandConfigTable.grantReadWriteData(manageBrandConfigFunction);
    
    // Grant Bedrock access for brand expansion feature
    manageBrandConfigFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    allowSavedBedrockModels(manageBrandConfigFunction, providerConfigTable);
    


    // Grant scheduler role permission to start executions
    stateMachine.grantStartExecution(schedulerRole);

    // Cognito: created before the distribution, callback URLs updated after it.
    // The REST API in front of the API Lambdas is `CitationAnalysisApiStack`.
    const auth = new Auth(this, 'Auth', {urls: ['http://localhost:5173'], // Temporary - updated below after CloudFront creation
    });

    // ========================================
    // Content Studio API
    // ========================================

    const contentStudioEnvironment = {
      DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
      DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
      DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
      DYNAMODB_TABLE_CONTENT_STUDIO: contentStudioTable.tableName,
      DYNAMODB_TABLE_CONTENT_BRIEF_BATCHES: contentBriefBatchesTable.tableName,
      DYNAMODB_TABLE_CONTENT_BRIEF_TEMPLATES: contentBriefTemplatesTable.tableName,
      DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
      DYNAMODB_TABLE_KEYWORD_GROUPS: keywordGroupsTable.tableName,
      CONTENT_STUDIO_WORKER_FUNCTION_NAME: CONTENT_STUDIO_WORKER_FUNCTION_NAME,
      GENERATION_TIMEOUT_SECONDS: '360',
      ...bedrockTierEnv,
      DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
    };
    const contentStudioStatusIndexArn = `${contentStudioTable.tableArn}/index/StatusCreatedIndex`;
    const keywordsStatusIndexArn = `${keywordsTable.tableArn}/index/StatusIndex`;

    // Requests only persist stream-owned rows; generation runs in the worker.
    const contentStudioFunction = apiFunction(this, 'ContentStudio', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES['content-studio'],
      handlerFiles: ['content-studio.py'],
      memorySize: 512,
      description: 'API: Content Studio - ideas and durable content queues',
      environment: contentStudioEnvironment,
    });
    allow(contentStudioFunction, ['dynamodb:Query', 'dynamodb:Scan'], [searchResultsTable.tableArn]);
    allow(contentStudioFunction, ['dynamodb:GetItem'], [brandConfigTable.tableArn, keywordGroupsTable.tableArn]);
    allow(contentStudioFunction, [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ], [contentStudioTable.tableArn]);
    allow(contentStudioFunction, ['dynamodb:Query'], [contentStudioStatusIndexArn]);
    allow(contentStudioFunction, ['dynamodb:GetItem', 'dynamodb:PutItem'], [contentBriefBatchesTable.tableArn]);
    allow(contentStudioFunction, [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
    ], [contentBriefTemplatesTable.tableArn]);
    allow(contentStudioFunction, ['dynamodb:Scan'], [keywordsTable.tableArn]);
    allow(contentStudioFunction, ['dynamodb:Query'], [keywordsStatusIndexArn]);
    allowSavedBedrockModels(contentStudioFunction, providerConfigTable);

    // 2.45.0: every function serving a scoped view (or writing what changes
    // one) reads the scope snapshots, requests rebuilds and starts view jobs.
    const scopeSnapshotInputs = { bucket: keywordsBucket, builder: generateSummaryFunction, queryPrompts: queryPromptsTable };
    for (const reader of [
      statsInsightsFunction, citationsContentFunction, getBrandMentionsFunction, configMgmtFunction,
      keywordMgmtFunction, contentStudioFunction, reportInsightsFunction,
    ]) {
      grantScopeSnapshotReader(reader, scopeSnapshotInputs);
    }
    // Distributed scope snapshot + citation rollup build (2.45.0 wave 6)
    scopeSnapshotBuild(this, {
      sharedLayer,
      bucket: keywordsBucket,
      generateSummary: generateSummaryFunction,
      backfill: deduplicationFunction,
      tables: {
        keywords: keywordsTable, brandConfig: brandConfigTable, queryPrompts: queryPromptsTable,
        keywordRunKpis: keywordRunKpisTable, keywordRunBrands: keywordRunBrandsTable,
        searchResults: searchResultsTable, citations: citationsTable,
      },
    });
    // Brand-config saves and persona writes start the KeywordLatest backfill
    // (`latest`, chained) on the Deduplication Lambda.
    for (const writer of [manageBrandConfigFunction, configMgmtFunction]) {
      writer.addEnvironment('KEYWORD_LATEST_BACKFILL_FUNCTION', deduplicationFunction.functionName);
      allow(writer, ['lambda:InvokeFunction'], [deduplicationFunction.functionArn]);
    }

    const contentStudioWorkerFunction = workerFunction(this, 'ContentStudioWorker', {
      functionName: CONTENT_STUDIO_WORKER_FUNCTION_NAME,
      handler: 'content-studio.handler',
      code: apiLambdaCode(['content-studio.py']),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      reservedConcurrentExecutions: CONTENT_STUDIO_WORKER_CONCURRENCY,
      description: 'Worker: stream-backed Content Studio generation and recovery',
      environment: contentStudioEnvironment,
    });
    allow(contentStudioWorkerFunction, ['dynamodb:GetItem', 'dynamodb:UpdateItem'], [contentStudioTable.tableArn]);
    allow(contentStudioWorkerFunction, ['dynamodb:Query'], [contentStudioStatusIndexArn]);
    allow(contentStudioWorkerFunction, ['dynamodb:GetItem'], [brandConfigTable.tableArn]);
    allow(contentStudioWorkerFunction, ['dynamodb:Query'], [crawledContentTable.tableArn]);
    contentStudioWorkerFunction.addToRolePolicy(claudeInvokeModelStatement(this));
    allowSavedBedrockModels(contentStudioWorkerFunction, providerConfigTable);

    // Reconciliation re-dispatches recovered rows to the worker itself. The
    // API never invokes a Lambda: generation starts from the table stream.
    const contentStudioWorkerFunctionArn = cdk.Stack.of(this).formatArn({
      service: 'lambda',
      resource: 'function',
      resourceName: CONTENT_STUDIO_WORKER_FUNCTION_NAME,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    allow(contentStudioWorkerFunction, ['lambda:InvokeFunction'], [contentStudioWorkerFunctionArn]);

    const contentStudioStreamDlq = new sqs.Queue(this, 'ContentStudioStreamDlq', {
      queueName: 'CitationAnalysis-ContentStudioStreamDLQ',
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    contentStudioWorkerFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(contentStudioTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 1,
        retryAttempts: CONTENT_STUDIO_STREAM_RETRY_ATTEMPTS,
        maxRecordAge: cdk.Duration.minutes(CONTENT_STUDIO_STREAM_MAX_RECORD_AGE_MINUTES),
        onFailure: new lambdaEventSources.SqsDlq(contentStudioStreamDlq),
        filters: [{
          pattern: JSON.stringify({
            eventName: ['INSERT'],
            dynamodb: {
              NewImage: {
                generation_transport: { S: ['dynamodb_stream_v1'] },
                status: { S: ['pending'] },
              },
            },
          }),
        }],
      })
    );

    const contentStudioReconcileRule = new events.Rule(this, 'ContentStudioReconcileRule', {
      ruleName: 'CitationAnalysis-ContentStudioReconcile',
      schedule: events.Schedule.rate(
        cdk.Duration.minutes(CONTENT_STUDIO_RECONCILE_INTERVAL_MINUTES)
      ),
    });
    contentStudioReconcileRule.addTarget(new eventTargets.LambdaFunction(
      contentStudioWorkerFunction,
      { event: events.RuleTargetInput.fromObject({ action: 'reconcile' }) }
    ));

    // ========================================
    // User Management API
    // ========================================

    // User Management Lambda
    const manageUsersFunction = apiFunction(this, 'ManageUsers', sharedLayer, {
      functionName: DASHBOARD_API_FUNCTION_NAMES.users,
      handlerFiles: ['manage-users.py'],
      memorySize: 512,
      description: 'API: Manage Cognito users',
      environment: {
        USER_POOL_ID: auth.userPool.userPoolId,
      },
    });

    // Grant Cognito permissions for user management
    allow(manageUsersFunction, [
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminResetUserPassword',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:ListGroups',
    ], [auth.userPool.userPoolArn]);

    // ========================================
    // Export service (2.45.0)
    // ========================================

    const exportsFunction = exportService(this, {
      sharedLayer,
      bucket: keywordsBucket,
      userPool: auth.userPool,
      routers: {
        'stats-insights': statsInsightsFunction,
        'citations-content': citationsContentFunction,
        'keyword-mgmt': keywordMgmtFunction,
        'config-mgmt': configMgmtFunction,
        'brand-mentions': getBrandMentionsFunction,
        'persona-rankings': getPersonaRankingsFunction,
        'content-studio': contentStudioFunction,
        users: manageUsersFunction,
        // The SEO stack's router, by its fixed name: the SEO stack deploys after
        // this one, so a reference would be a cycle. An SEO export fails with a
        // clear error while the SEO stack is not deployed.
        seo: lambda.Function.fromFunctionName(this, 'SeoRouterForExports', SEO_ROUTER_FUNCTION_NAME),
      },
    });

    // ========================================
    // Visualization Dashboard - S3 + CloudFront
    // ========================================

    // S3 Bucket for Web Hosting
    // Security: Block all public access, use CloudFront OAC for access
    const webBucket = citationAnalysisBucket(this, 'WebBucket', { name: 'web', accessLogsBucket });

    // Build the React app (npm run build must be run before deployment)
    // The build output will be in web/dist folder
    // The API URL is not built in: the dashboard reads it at startup from
    // `config.json`, which CitationAnalysisApiStack writes into this bucket.
    const webPath = path.join(__dirname, '../web');
    const distPath = path.join(webPath, 'dist');
    
    // Require web build before deployment - fail fast for better developer experience
    if (!fs.existsSync(distPath)) {
      throw new WebBuildRequiredError();
    }

    // Deploy web assets to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(distPath)],
      destinationBucket: webBucket,
      prune: false,
      // Owned by CitationAnalysisApiStack: never uploaded from web/dist,
      // never pruned, so a dashboard deploy keeps the API URL.
      exclude: [RUNTIME_CONFIG_OBJECT_KEY],
      // The default 128 MB deployment handler peaked at 100% of its memory
      // and took ~60s per deploy unzipping the dashboard bundle.
      memoryLimit: 512,
    });

    // ========================================
    // No WAF (pay-per-use by design)
    // ========================================
    //
    // Neither CloudFront nor API Gateway nor the user pool has a web ACL: a
    // web ACL bills per month whether or not the demo is used. What protects
    // the app instead:
    //   - CloudFront: HTTPS only, origin access control, the security headers below
    //   - API Gateway (CitationAnalysisApiStack): the Cognito authorizer on every route except GET
    //     /api/health, the stage throttle (100 rps / 200 burst) and the usage
    //     plan quota, and input validation in the handlers
    // To add one, create a CLOUDFRONT-scope web ACL in us-east-1 and pass its
    // ARN as the distribution's `webAclId`.

    // Create response headers policy for security headers
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: 'CitationAnalysis-SecurityHeaders-v3',
      comment: 'Security headers for Citation Analysis Dashboard',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none';",
          override: true,
        },
        contentTypeOptions: {override: true,},
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31536000), // 1 year
          includeSubdomains: true,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // ========================================
    // Configure CORS with CloudFront Domain
    // ========================================
    
    // The dashboard origin: the Lambdas' CORS origin (SSM below), the Cognito
    // callback URLs and the API stack's gateway responses.
    const cloudFrontOrigin = `https://${distribution.distributionDomainName}`;

    this.mcpInputs = {
      userPool: auth.userPool,
      apiFunctions: {
        'keyword-mgmt': keywordMgmtFunction,
        'config-mgmt': configMgmtFunction,
        'execution-mgmt': executionMgmtFunction,
        'stats-insights': statsInsightsFunction,
        'citations-content': citationsContentFunction,
        'brand-config': manageBrandConfigFunction,
        'brand-mentions': getBrandMentionsFunction,
        'persona-rankings': getPersonaRankingsFunction,
        'content-studio': contentStudioFunction,
      },
    };

    this.seoInputs = { userPool: auth.userPool };
    const apiFunctions: DashboardApiFunctions = {
      health: healthCheckFunction,
      'stats-insights': statsInsightsFunction,
      'citations-content': citationsContentFunction,
      'keyword-mgmt': keywordMgmtFunction,
      'config-mgmt': configMgmtFunction,
      'execution-mgmt': executionMgmtFunction,
      'brand-mentions': getBrandMentionsFunction,
      'brand-config': manageBrandConfigFunction,
      'content-studio': contentStudioFunction,
      users: manageUsersFunction,
      'persona-rankings': getPersonaRankingsFunction,
      'self-reflection': selfReflectionFunction,
      exports: exportsFunction,
    };
    retainLegacyApiStackExports(this, [
      ...Object.values(apiFunctions).map((fn) => fn.functionArn),
      auth.userPool.userPoolArn,
      webBucket.bucketName,
      distribution.distributionId,
      distribution.distributionDomainName,
    ]);
    // What the API stack reads instead (see `CitationAnalysisApiStack`); the
    // CORS origin parameter below is the third.
    new cdk.aws_ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: DASHBOARD_API_PARAMETERS.userPoolId,
      stringValue: auth.userPool.userPoolId,
      description: 'Cognito user pool id, read by the dashboard API stack',
    });
    new cdk.aws_ssm.StringParameter(this, 'WebDistributionIdParam', {
      parameterName: DASHBOARD_API_PARAMETERS.webDistributionId,
      stringValue: distribution.distributionId,
      description: 'Dashboard CloudFront distribution id, read by the dashboard API stack (config.json invalidation)',
    });

    // Update Cognito User Pool Client callback URLs with CloudFront domain
    const cfnUserPoolClient = auth.userPoolClient.node.defaultChild as cdk.aws_cognito.CfnUserPoolClient;
    cfnUserPoolClient.callbackUrLs = [cloudFrontOrigin, 'http://localhost:5173'];
    cfnUserPoolClient.logoutUrLs = [cloudFrontOrigin, 'http://localhost:5173'];
    
    // Update Cognito email templates with actual CloudFront URL
    auth.updateEmailTemplatesWithUrl(cloudFrontOrigin);
    
    // Store CloudFront origin in SSM Parameter for Lambda functions to use
    const corsOriginParam = new cdk.aws_ssm.StringParameter(this, 'CorsOriginParam', {
      parameterName: DASHBOARD_API_PARAMETERS.corsOrigin,
      stringValue: cloudFrontOrigin,
      description: 'Allowed CORS origin for API responses',
    });
    
    // Grant all API Lambda functions read access to the CORS parameter
    const apiLambdaFunctions = [
      healthCheckFunction,
      statsInsightsFunction, citationsContentFunction,
      keywordMgmtFunction, configMgmtFunction, executionMgmtFunction,
      getBrandMentionsFunction, manageBrandConfigFunction,
      contentStudioFunction, manageUsersFunction,
      getPersonaRankingsFunction, selfReflectionFunction,
      exportsFunction,
    ];
    
    for (const fn of apiLambdaFunctions) {
      corsOriginParam.grantRead(fn);
      fn.addEnvironment('CORS_ORIGIN_PARAM', corsOriginParam.parameterName);
      if (devMode) {
        fn.addEnvironment('ALLOW_LOCALHOST', 'true');
      }
      // Responses too large for Lambda's 6 MiB cap are spilled here
      // (lambda/shared/response_spill.py); the handler presigns the GET.
      fn.addEnvironment('API_RESPONSE_BUCKET', keywordsBucket.bucketName);
      allow(fn, ['s3:PutObject', 's3:GetObject'], [keywordsBucket.arnForObjects(`${API_RESPONSE_SPILL_PREFIX}*`)]);
    }

    // The dashboard downloads spilled responses from their presigned URLs
    // with fetch(), which needs CORS on the bucket. Only GET from the
    // dashboard's own origin; the URL itself is the (short-lived) credential.
    keywordsBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET],
      allowedOrigins: devMode ? [cloudFrontOrigin, 'http://localhost:5173'] : [cloudFrontOrigin],
      allowedHeaders: [],
      maxAge: 3600,
    });

    // ========================================
    // Outputs
    // ========================================

    exportedOutput(this, 'DashboardUrl', cloudFrontOrigin, 'Citation Analysis Dashboard URL');
    exportedOutput(
      this,
      'CloudFrontDistributionId',
      distribution.distributionId,
      'CloudFront Distribution ID (for cache invalidation)'
    );
    exportedOutput(this, 'WebBucketName', webBucket.bucketName, 'S3 bucket for web dashboard');
    exportedOutput(this, 'CorsOrigin', cloudFrontOrigin, 'Allowed CORS origin (CloudFront domain)');
    exportedOutput(this, 'UserPoolId', auth.userPool.userPoolId, 'Cognito User Pool ID');
    exportedOutput(this, 'UserPoolClientId', auth.userPoolClient.userPoolClientId, 'Cognito User Pool Client ID');
    exportedOutput(this, 'IdentityPoolId', auth.identityPool.identityPoolId, 'Cognito Identity Pool ID');

    // S3 Website URL removed - bucket no longer has public access
    // Access is now exclusively through CloudFront with OAC

    // Deployment instructions
    new cdk.CfnOutput(this, 'DeploymentInstructions', {
      value: 'Open the dashboard, go to Settings > AI Providers to configure API keys, then add keywords and run analysis',
      description: 'Next steps after deployment',
    });
  }
}
