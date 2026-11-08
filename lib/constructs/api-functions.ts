import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { lambdaHandlerFilesCode } from './python-layer';

/**
 * API Gateway's REST API integration timeout: a hard 29 seconds, not raisable.
 *
 * A Lambda behind API Gateway with a longer timeout does not get more time to
 * answer — the client has already received a 504 at 29s. It gets more time to
 * keep burning: billing compute, calling paid models, and writing to DynamoDB
 * for a response nobody will ever receive (AUDIT-2026-08-19 §2.9).
 *
 * So every function whose ONLY invoker is API Gateway is capped here. The
 * failure then surfaces as a Lambda timeout — visible in the function's own
 * Duration/Errors metrics — instead of only as an opaque gateway 504.
 *
 * One deliberate exception is documented at its definition:
 *   - `selfReflectionFunction` also runs its own Bedrock job when it invokes
 *     itself asynchronously (POST answers 202 at once), and that job needs
 *     longer than 29 s.
 *
 * Inside the 29 s, every API request carries a deadline
 * (`lambda/shared/request_deadline.py`, started by `@api_handler`) that its
 * reads, fan-outs and model calls stop at, answering partial data that says
 * so instead of running into the 504.
 *
 * Functions invoked by streams or Step Functions are not subject to this.
 */
export const API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS = 29;

/** A 30-day CloudWatch log group; the removal policy is the only setting that differs between groups. */
export function monthLogGroup(
  scope: Construct,
  id: string,
  logGroupName: string,
  removalPolicy: cdk.RemovalPolicy
): logs.LogGroup {
  return new logs.LogGroup(scope, id, {
    logGroupName,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy,
  });
}

/** Props of one stack Lambda; the Python runtime and the log group are fixed by `pythonFunction`. */
export type PythonFunctionProps = Omit<lambda.FunctionProps, 'runtime' | 'logGroup' | 'functionName'> & {
  functionName: string;
};

/**
 * `<name>Function` on Python 3.12, logging to its own explicit 30-day
 * `<name>LogGroup` at `/aws/lambda/<functionName>` instead of the
 * never-expiring group the Lambda service would create on first invocation.
 */
export function pythonFunction(
  scope: Construct,
  name: string,
  props: PythonFunctionProps,
  logRemovalPolicy: cdk.RemovalPolicy
): lambda.Function {
  const logGroup = monthLogGroup(scope, `${name}LogGroup`, `/aws/lambda/${props.functionName}`, logRemovalPolicy);
  return new lambda.Function(scope, `${name}Function`, {
    ...props,
    runtime: lambda.Runtime.PYTHON_3_12,
    logGroup,
  });
}

/** Props of an API Lambda: the bundled handler files replace `code` and `handler`. */
type ApiFunctionProps = Omit<PythonFunctionProps, 'code' | 'handler' | 'layers' | 'timeout'> & {
  /** Handler files to bundle from `lambda/api/`; the first is the entry point (`<file>.handler`). */
  handlerFiles: [string, ...string[]];
  /** Defaults to the API Gateway integration ceiling; exceeding it needs a documented reason. */
  timeout?: cdk.Duration;
};

/**
 * Lambda code bundle containing only the given handler files from
 * `lambda/api/`: one file for a single-route function, the router plus its
 * handlers for a consolidated one. Shared code (including Decimal helpers in
 * shared/dynamo_decimal.py) ships via the Lambda layer, which keeps each
 * package small compared to bundling all API handlers together.
 *
 * The files ship with their CPython 3.12 bytecode, compiled at bundling time
 * by a local 3.12 (Docker as fallback), so a cold start does not recompile
 * them. The asset hash covers only these files: editing another API handler
 * no longer redeploys (and cold-starts) every API Lambda.
 */
export function apiLambdaCode(handlerFileNames: string[]): lambda.Code {
  return lambdaHandlerFilesCode('api', handlerFileNames);
}

/**
 * One API Lambda: the shared layer, only its own handler files, and an
 * explicit 30-day log group (`<name>LogGroup`).
 *
 * A Lambda with no log group in the template still gets one: the Lambda
 * service auto-creates `/aws/lambda/<functionName>` on first invocation, with
 * retention set to "Never expire". 39 of this account's 45 log groups were in
 * exactly that state, holding 70 MB that only grows and that nobody reads
 * past the first week of an incident (AUDIT-2026-08-19 §2.7).
 *
 * This mirrors the five Step Functions workers, which have carried explicit
 * `logs.LogGroup` constructs from the start. It is deliberately NOT
 * `logRetention:` on `lambda.Function`: that prop is deprecated in
 * aws-cdk-lib 2.x in favour of `logGroup`, and it works by deploying a
 * singleton custom-resource Lambda that calls PutRetentionPolicy after the
 * fact — an extra moving part to own for something the log group resource
 * states directly.
 *
 * WHY `RETAIN` HERE WHEN THE WORKERS USE `DESTROY` — read before deploying:
 *
 * All twelve of these groups ALREADY EXIST in the deployed account. The Lambda
 * service created them, so CloudFormation has never known about them, and
 * CloudFormation cannot Create a log group whose name is already taken. The
 * first `cdk deploy` carrying this change therefore fails with
 * "already exists" unless each group is first brought under stack management
 * (`cdk import`) or deleted so CloudFormation can recreate it.
 *
 * `RETAIN` is what keeps the import route open at all: CloudFormation's import
 * operation requires a DeletionPolicy on every resource being imported. It
 * also means that removing or renaming one of these constructs later abandons
 * the group rather than deleting production logs — which for the workers'
 * short-lived debug output did not matter, and here does.
 */
export function apiFunction(
  scope: Construct,
  name: string,
  sharedLayer: lambda.ILayerVersion,
  props: ApiFunctionProps
): lambda.Function {
  const { handlerFiles, timeout, ...functionProps } = props;
  return pythonFunction(scope, name, {
    ...functionProps,
    handler: `${path.parse(handlerFiles[0]).name}.handler`,
    code: apiLambdaCode(handlerFiles),
    layers: [sharedLayer],
    timeout: timeout ?? cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
  }, cdk.RemovalPolicy.RETAIN);
}
