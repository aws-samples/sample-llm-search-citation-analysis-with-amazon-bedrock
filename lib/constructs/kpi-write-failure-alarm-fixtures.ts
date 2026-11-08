import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';

import {
  allowStatementsOfRole,
  extractLambdaEnvVars,
  findFunctionRoleLogicalId,
  resolvePath,
  resolveString,
  statementActions,
} from '../citation-analysis-stack-fixtures';
import { KPI_WRITE_FAILURE_ALARM_NAME, KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME, KpiWriteFailureAlarm } from './kpi-write-failure-alarm';

/** One metric of the alarm's math: the stage it reads, or the expression. */
export interface AlarmMetricSnapshot {
  id: string;
  expression: string;
  namespace: string;
  metricName: string;
  stage: string;
  stat: string;
  period: unknown;
  returnData: unknown;
}

export interface KpiWriteFailureAlarmSnapshot {
  /** Logical ids of the alarms named `CitationAnalysis-KeywordRunKpisWriteFailure`. */
  alarmLogicalIds: string[];
  metrics: AlarmMetricSnapshot[];
  threshold: unknown;
  comparisonOperator: string;
  evaluationPeriods: unknown;
  treatMissingData: string;
  /** Each alarm action as JSON, so its target can be matched as text. */
  alarmActions: string[];
  okActions: unknown;
  relayLogicalId: string;
  relayEnvironment: Record<string, unknown>;
  relayActions: string[];
  relayRuntime: string;
  relayCode: string;
  /** Principal and source ARN (JSON) of each permission to invoke the relay. */
  relayInvokers: { principal: string; sourceArn: string }[];
  relayLogGroupNames: string[];
  topicLogicalId: string;
}

function metricSnapshot(metric: unknown): AlarmMetricSnapshot {
  const stat = resolvePath(metric, ['MetricStat']);
  const dimensions = resolvePath(stat, ['Metric', 'Dimensions']);
  const stageDimension: unknown = (Array.isArray(dimensions) ? dimensions as unknown[] : [])
    .find((dimension) => resolveString(dimension, ['Name']) === 'Stage');
  return {
    id: resolveString(metric, ['Id']),
    expression: resolveString(metric, ['Expression']),
    namespace: resolveString(stat, ['Metric', 'Namespace']),
    metricName: resolveString(stat, ['Metric', 'MetricName']),
    stage: resolveString(stageDimension, ['Value']),
    stat: resolveString(stat, ['Stat']),
    period: resolvePath(metric, ['Period']) ?? resolvePath(stat, ['Period']),
    returnData: resolvePath(metric, ['ReturnData']),
  };
}

/** The alarm on a stack holding only a KPI alerts topic encrypted like the main stack's (`alias/aws/sns`). */
export function synthesizeKpiWriteFailureAlarm(): KpiWriteFailureAlarmSnapshot {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'KpiWriteFailureAlarmTest', { env: { account: '123456789012', region: 'eu-west-1' } });
  const topic = new sns.Topic(stack, 'KpiAlertsTopic', {
    topicName: 'CitationAnalysis-KpiAlerts',
    masterKey: kms.Alias.fromAliasName(stack, 'SnsKey', 'alias/aws/sns'),
  });
  new KpiWriteFailureAlarm(stack, 'KpiWriteFailureAlarm', { topic });
  const template = Template.fromStack(stack);

  const alarms = template.findResources('AWS::CloudWatch::Alarm', { Properties: { AlarmName: KPI_WRITE_FAILURE_ALARM_NAME } });
  const alarm = resolvePath(Object.values(alarms)[0], ['Properties']);
  const metrics = resolvePath(alarm, ['Metrics']);
  const alarmActions = resolvePath(alarm, ['AlarmActions']);
  const relayFunctions = template.findResources('AWS::Lambda::Function', { Properties: { FunctionName: KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME } });
  const [relayLogicalId] = Object.keys(relayFunctions);
  const relay = resolvePath(relayFunctions[relayLogicalId ?? ''], ['Properties']);
  return {
    alarmLogicalIds: Object.keys(alarms),
    metrics: (Array.isArray(metrics) ? metrics : []).map(metricSnapshot),
    threshold: resolvePath(alarm, ['Threshold']),
    comparisonOperator: resolveString(alarm, ['ComparisonOperator']),
    evaluationPeriods: resolvePath(alarm, ['EvaluationPeriods']),
    treatMissingData: resolveString(alarm, ['TreatMissingData']),
    alarmActions: (Array.isArray(alarmActions) ? alarmActions : []).map((action) => JSON.stringify(action)),
    okActions: resolvePath(alarm, ['OKActions']),
    relayLogicalId: relayLogicalId ?? '',
    relayEnvironment: extractLambdaEnvVars(template, KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME),
    relayActions: allowStatementsOfRole(template, findFunctionRoleLogicalId(template, KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME))
      .flatMap(statementActions).sort((left, right) => left.localeCompare(right)),
    relayRuntime: resolveString(relay, ['Runtime']),
    relayCode: resolveString(relay, ['Code', 'ZipFile']),
    relayInvokers: Object.values(template.findResources('AWS::Lambda::Permission')).map((permission) => ({
      principal: resolveString(permission, ['Properties', 'Principal']),
      sourceArn: JSON.stringify(resolvePath(permission, ['Properties', 'SourceArn'])) ?? '',
    })),
    relayLogGroupNames: Object.values(template.findResources('AWS::Logs::LogGroup'))
      .map((logGroup) => resolveString(logGroup, ['Properties', 'LogGroupName'])),
    topicLogicalId: Object.keys(template.findResources('AWS::SNS::Topic'))[0] ?? '',
  };
}
