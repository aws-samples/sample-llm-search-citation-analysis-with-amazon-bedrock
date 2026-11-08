import { ArnFormat, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { pythonFunction } from './api-functions';
import { lambdaHandlerFilesCode } from './python-layer';
import { RANK_CHECK_STATE_MACHINE_NAME } from './seo-rank-tracking';
import { SEO_LOCAL_JOB_STATE_MACHINE_NAME } from './seo-local';

export const SEO_CALLBACKS_FUNCTION_NAME = 'CitationAnalysis-SeoCallbacks';
/** The state machines whose post step waits on a callback gate (`shared/dataforseo_callbacks.py`). */
export const GATED_STATE_MACHINE_NAMES = [RANK_CHECK_STATE_MACHINE_NAME, SEO_LOCAL_JOB_STATE_MACHINE_NAME];
/** Partition key prefix of the gate items in `CitationAnalysis-SeoCache`. */
export const GATE_KEY_PREFIX = 'callback#';

export interface SeoCallbacksProps {
  readonly sharedLayer: lambda.ILayerVersion;
  /** `CitationAnalysis-SeoCache`, which holds the gates. */
  readonly cacheTable: ITable;
  /** The jobs function: it opens gates, posts with their URL and resumes at once when nothing is left to wait for. */
  readonly jobs: lambda.Function;
}

/**
 * `CitationAnalysis-SeoCallbacks`: the public endpoint DataForSEO calls when
 * a queued task is ready (its `pingback_url`), a Lambda function URL. Each
 * call counts the task on its gate; the call that empties the gate resumes the
 * waiting state machine (`SendTaskSuccess`). The state machines no longer poll
 * the DataForSEO queue.
 *
 * The URL takes no sign-in (DataForSEO cannot sign in), so the function can
 * do almost nothing: update `callback#` items of the cache table and send task
 * success to the two gated state machines. It holds no DataForSEO credentials.
 * Reaching a gate takes its 32-byte random id.
 */
export class SeoCallbacks extends Construct {
  /** The function URL; the jobs function sends it as each queued task's `pingback_url`. */
  public readonly url: string;

  constructor(scope: Construct, id: string, props: SeoCallbacksProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const fn = pythonFunction(this, 'Callbacks', {
      functionName: SEO_CALLBACKS_FUNCTION_NAME,
      description: 'DataForSEO pingbacks: count a ready task on its gate and resume the waiting state machine',
      handler: 'seo-callbacks.handler',
      code: lambdaHandlerFilesCode('seo-callbacks', ['seo-callbacks.py']),
      layers: [props.sharedLayer],
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: { DYNAMODB_TABLE_SEO_CACHE: props.cacheTable.tableName },
    }, RemovalPolicy.DESTROY);
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    fn.addToRolePolicy(new PolicyStatement({
      actions: ['dynamodb:UpdateItem'],
      resources: [props.cacheTable.tableArn],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': [`${GATE_KEY_PREFIX}*`] } },
    }));
    // Built from the names: the state machines' definitions name the jobs function, which names this URL.
    const gated = GATED_STATE_MACHINE_NAMES.map((name) => stack.formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: name,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    }));
    for (const grantee of [fn, props.jobs]) {
      grantee.addToRolePolicy(new PolicyStatement({ actions: ['states:SendTaskSuccess'], resources: gated }));
    }
    this.url = url.url;
  }
}
