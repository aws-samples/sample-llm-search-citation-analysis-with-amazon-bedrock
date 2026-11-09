import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { loggedStateMachine } from './logged-state-machine';
import type { SeoRoutes } from './seo-api';
import { citationAnalysisTable } from './tables';

/** The SEO jobs function's name (state machines and the rank tracker schedules invoke it). */
export const SEO_JOBS_FUNCTION_NAME = 'CitationAnalysis-SeoJobs';

/**
 * What a SEO feature construct (`lib/constructs/seo-<feature>.ts`) builds on.
 *
 * A feature adds its own tables and state machines, grants the two shared
 * functions what they need on them, sets their environment variables with
 * `addEnvironment`, and declares its API routes (`SeoFeatureConstruct.serve`);
 * the stack serves them with `SeoApi.addRoutes`. Paid DataForSEO work longer
 * than the API's 29-second limit runs as a job: a state machine whose tasks
 * invoke `jobs` with `{"step": "<feature>.<name>", ...}`
 * (`lambda/seo-jobs/seo-jobs.py`).
 */
export interface SeoFeatureProps {
  /** `CitationAnalysis-SeoRouter`: every `/api/seo/...` route (29 s timeout). */
  readonly router: lambda.Function;
  /** `CitationAnalysis-SeoJobs`: the steps of every SEO state machine (15 min timeout). */
  readonly jobs: lambda.Function;
  /** The SEO stack's shared layer, for any extra function a feature needs (e.g. a high-memory one). */
  readonly sharedLayer: lambda.ILayerVersion;
  /** Environment both shared functions already carry; give any extra function the same. */
  readonly environment: Readonly<Record<string, string>>;
  /** The SEO bucket (`citation-analysis-seo-<account>`), already readable and writable by both functions. */
  readonly seoBucket: s3.IBucket;
  /** Main-stack tables by name, for read grants. */
  readonly mainTables: Readonly<Record<'searchResults' | 'keywords' | 'brandConfig' | 'citations', dynamodb.ITable>>;
}

/** A feature construct's contribution to the SEO API. */
export interface SeoFeature {
  readonly routes: SeoRoutes;
}

/** A string key attribute (every SEO table key is a string). */
export function stringKey(name: string): dynamodb.Attribute {
  return { name, type: dynamodb.AttributeType.STRING };
}

/** One feature state machine: its name, first state and execution timeout. */
interface SeoStateMachineSpec {
  readonly stateMachineName: string;
  readonly definition: stepfunctions.IChainable;
  readonly timeout: cdk.Duration;
  /** Construct ids of the state machine and its log group (they fix the logical ids). */
  readonly id?: string;
  readonly logGroupId?: string;
  /** An explicit execution role; CDK creates one when omitted. */
  readonly role?: iam.IRole;
}

/** How a jobs task hands on the step's answer and retries, and when it times out. */
type JobsTaskOptions = Omit<tasks.LambdaInvokeProps, 'lambdaFunction' | 'payload' | 'taskTimeout'> & {
  /** At most the jobs function's own 15 minutes. */
  readonly timeout: cdk.Duration;
};

/**
 * A SEO feature: a construct whose `build` adds the feature's resources and
 * grants on the shared functions (`props`) and declares its API routes with
 * `serve`.
 *
 * The constructor runs `build` before any subclass field initializer, so a
 * feature keeps what it creates in locals, not in instance fields.
 */
/** What a feature's code does to its table beyond reading, putting and updating items. */
export interface SharedTableAccess {
  /** It writes through a batch writer (`BatchWriteItem`; IAM cannot tell a batched put from a batched delete). */
  readonly batchWrites?: boolean;
  /** It deletes items (`DeleteItem`): name what in the feature's docs. */
  readonly deletes?: boolean;
}

/** The item actions of a feature table: reads, puts and updates, plus the batch writes and deletes `access` names. */
export function sharedTableActions(access: SharedTableAccess): string[] {
  return [
    'dynamodb:BatchGetItem', 'dynamodb:ConditionCheckItem', 'dynamodb:DescribeTable', 'dynamodb:GetItem',
    'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem',
    ...(access.batchWrites === true ? ['dynamodb:BatchWriteItem'] : []),
    ...(access.deletes === true ? ['dynamodb:DeleteItem'] : []),
  ].sort((a, b) => a.localeCompare(b));
}

export abstract class SeoFeatureConstruct extends Construct implements SeoFeature {
  public readonly routes: SeoRoutes;
  protected readonly props: SeoFeatureProps;
  private readonly served: SeoRoutes[number][] = [];

  constructor(scope: Construct, id: string, props: SeoFeatureProps) {
    super(scope, id);
    this.props = props;
    this.routes = this.served;
    this.build();
  }

  protected abstract build(): void;

  /** Routes of the feature (paths below `/api/seo`), served by the router. */
  protected serve(...routes: SeoRoutes): void {
    this.served.push(...routes);
  }

  /**
   * A feature table both shared functions read and write, its name given to them as `environmentVariable`.
   * Granted per action (TENETS.md, tenet 6 and D5): item reads, puts and updates; `BatchWriteItem` only for a
   * feature that batches its writes, and `DeleteItem` only for one whose code deletes (`access`).
   */
  protected sharedTable(
    id: string,
    environmentVariable: string,
    spec: Parameters<typeof citationAnalysisTable>[2],
    access: SharedTableAccess = {},
  ): dynamodb.Table {
    const table = citationAnalysisTable(this, id, spec);
    const actions = sharedTableActions(access);
    for (const fn of [this.props.router, this.props.jobs]) {
      table.grant(fn, ...actions);
      fn.addEnvironment(environmentVariable, table.tableName);
    }
    return table;
  }

  /** A task invoking the jobs function with `payload` (`{"step": "<feature>.<name>", ...}`). */
  protected jobsTask(id: string, payload: Record<string, unknown>, options: JobsTaskOptions): tasks.LambdaInvoke {
    const { timeout, ...invokeOptions } = options;
    return new tasks.LambdaInvoke(this, id, {
      ...invokeOptions,
      lambdaFunction: this.props.jobs,
      payload: stepfunctions.TaskInput.fromObject(payload),
      taskTimeout: stepfunctions.Timeout.duration(timeout),
    });
  }

  /**
   * A `waitForTaskToken` jobs task that posts DataForSEO tasks behind a
   * callback gate (`shared/dataforseo_callbacks.py`): the step receives the
   * token as `task_token` and the state machine resumes when DataForSEO has
   * called back for every task. Never retried (the post is billed). When the
   * wait outlives `timeout`, `onTimeout` runs with the task's input.
   */
  protected callbackTask(
    id: string, payload: Record<string, unknown>, timeout: cdk.Duration, onTimeout: stepfunctions.IChainable,
  ): tasks.LambdaInvoke {
    const task = this.jobsTask(id, { ...payload, task_token: stepfunctions.JsonPath.taskToken }, {
      integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      retryOnServiceExceptions: false,
      timeout,
    });
    task.addCatch(onTimeout, { errors: ['States.Timeout'], resultPath: stepfunctions.JsonPath.DISCARD });
    return task;
  }

  /**
   * A `loggedStateMachine`: full execution logs (one-month
   * `/aws/vendedlogs/states/<name>` log group, removed with the stack) and
   * X-Ray traces, as every state machine of the app has.
   */
  protected stateMachine(spec: SeoStateMachineSpec): stepfunctions.StateMachine {
    return loggedStateMachine(this, spec.id ?? 'StateMachine', {
      logGroupId: spec.logGroupId ?? 'StateMachineLogGroup',
      stateMachineName: spec.stateMachineName,
      definition: spec.definition,
      role: spec.role,
      timeout: spec.timeout,
    });
  }
}
