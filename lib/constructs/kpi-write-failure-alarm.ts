import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/** Where `shared/keyword_run_kpis.emit_write_failure_metric` counts a failed write (EMF). */
export const KPI_WRITE_FAILURE_NAMESPACE = 'CitationAnalysis/KpiRollup';
export const KPI_WRITE_FAILURE_METRIC = 'KeywordRunKpisWriteFailure';

/**
 * Every `Stage` the metric is emitted under: the workflow's KeywordRunKpis
 * row and KeywordLatest object (DeduplicateCitations), and the same two
 * writes in the backfill. The metric has no dimensionless aggregate, so the
 * alarm adds them up.
 */
export const KPI_WRITE_FAILURE_STAGES = ['workflow', 'keyword_latest', 'backfill', 'keyword_latest_backfill'] as const;

export const KPI_WRITE_FAILURE_ALARM_NAME = 'CitationAnalysis-KeywordRunKpisWriteFailure';
export const KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME = 'CitationAnalysis-KpiWriteFailureRelay';

export interface KpiWriteFailureAlarmProps {
  /** The KPI alerts topic; its subscribers (Settings > Alerts) get the alarm. */
  readonly topic: sns.ITopic;
}

/**
 * Raises an alarm when a keyword run's KPI row or KeywordLatest object could
 * not be written (2.45.0 review F3). The write is best effort, so without the
 * alarm a missed write is only a log line, and the snapshot-served views lack
 * that keyword's run until the KPI backfill rewrites it.
 *
 * The alarm does not publish to the topic itself: the topic is encrypted with
 * the AWS-managed `alias/aws/sns` key, whose key policy (which cannot be
 * changed) does not let CloudWatch use it, so a direct SNS alarm action would
 * fail on every transition. A customer-managed key would fix that at a
 * monthly charge; instead the alarm invokes a small relay Lambda (alarm
 * Lambda actions), which publishes through SNS like the KPI alerts worker.
 */
export class KpiWriteFailureAlarm extends Construct {
  public readonly alarm: cloudwatch.Alarm;
  public readonly relay: lambda.Function;

  constructor(scope: Construct, id: string, props: KpiWriteFailureAlarmProps) {
    super(scope, id);

    this.relay = new lambda.Function(this, 'Relay', {
      functionName: KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(relayHandlerCode()),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Relays the KPI write-failure alarm to the KPI alerts topic',
      environment: { KPI_ALERTS_TOPIC_ARN: props.topic.topicArn },
      logGroup: new logs.LogGroup(this, 'RelayLogs', {
        logGroupName: `/aws/lambda/${KPI_WRITE_FAILURE_RELAY_FUNCTION_NAME}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    props.topic.grantPublish(this.relay);

    const usingMetrics = Object.fromEntries(KPI_WRITE_FAILURE_STAGES.map((stage, index) => [
      `m${index}`,
      new cloudwatch.Metric({
        namespace: KPI_WRITE_FAILURE_NAMESPACE,
        metricName: KPI_WRITE_FAILURE_METRIC,
        dimensionsMap: { Stage: stage },
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.minutes(5),
      }),
    ]));
    const failures = new cloudwatch.MathExpression({
      expression: Object.keys(usingMetrics).map((key) => `FILL(${key}, 0)`).join(' + '),
      usingMetrics,
      label: 'KPI row and KeywordLatest write failures',
      period: cdk.Duration.minutes(5),
    });

    this.alarm = failures.createAlarm(this, 'Alarm', {
      alarmName: KPI_WRITE_FAILURE_ALARM_NAME,
      alarmDescription:
        'A keyword run\'s KeywordRunKpis row or KeywordLatest object could not be written. Views served from ' +
        'snapshots lack that run until the KPI backfill rewrites it (README, KPI backfill).',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    this.alarm.addAlarmAction(new cloudwatchActions.LambdaAction(this.relay));
  }
}

/** The relay: one SNS message per transition into ALARM (the only state it is the action of). */
function relayHandlerCode(): string {
  return `
import os

import boto3

sns = boto3.client('sns')


def handler(event, context):
    data = event.get('alarmData') or {}
    state = data.get('state') or {}
    if state.get('value') != 'ALARM':
        return {'status': 'ignored'}
    name = data.get('alarmName', '')
    description = (data.get('configuration') or {}).get('description', '')
    sns.publish(
        TopicArn=os.environ['KPI_ALERTS_TOPIC_ARN'],
        Subject=f'Citation Analysis: alarm {name}'[:100],
        Message=f"{description}\\n\\nReason: {state.get('reason', '')}\\nAt: {state.get('timestamp', '')}",
    )
    return {'status': 'published'}
`;
}
