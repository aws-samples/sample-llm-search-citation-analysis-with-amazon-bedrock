import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { weekLogGroup } from './api-functions';

/** The deploy-time handler behind an `inlineCustomResourceProvider`. */
export interface InlineCustomResourceHandlerProps {
  readonly functionName: string;
  readonly description: string;
  /** Python source of the handler module, deployed as `index.py` (entry point `index.handler`). */
  readonly code: string;
  readonly timeout: cdk.Duration;
  /** The handler role's statements, added in this order. */
  readonly statements: iam.PolicyStatement[];
}

/**
 * `<prefix>Handler`, an inline Python 3.12 function (256 MB, one-week
 * `<prefix>HandlerLogs`), behind `<prefix>Provider` (one-week
 * `<prefix>ProviderLogs`): the `serviceToken` of a deploy-time
 * `cdk.CustomResource`. Every construct is created in `scope` under those ids,
 * so they fix the logical ids.
 */
export function inlineCustomResourceProvider(
  scope: Construct,
  prefix: string,
  props: InlineCustomResourceHandlerProps
): cr.Provider {
  const onEventHandler = new lambda.Function(scope, `${prefix}Handler`, {
    functionName: props.functionName,
    description: props.description,
    runtime: lambda.Runtime.PYTHON_3_12,
    handler: 'index.handler',
    code: lambda.Code.fromInline(props.code),
    timeout: props.timeout,
    memorySize: 256,
    logGroup: weekLogGroup(scope, `${prefix}HandlerLogs`),
  });
  for (const statement of props.statements) {
    onEventHandler.addToRolePolicy(statement);
  }
  return new cr.Provider(scope, `${prefix}Provider`, {
    onEventHandler,
    logGroup: weekLogGroup(scope, `${prefix}ProviderLogs`),
  });
}
