import * as cdk from 'aws-cdk-lib';
import type * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';
import { monthLogGroup } from './api-functions';

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
export function loggedStateMachine(
  scope: Construct,
  id: string,
  spec: {
    logGroupId: string;
    stateMachineName: string;
    definition: stepfunctions.IChainable;
    /** An explicit execution role; CDK creates one when omitted. */
    role?: iam.IRole;
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
