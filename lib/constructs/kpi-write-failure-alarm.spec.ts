import {
  describe, expect, it
} from 'vitest';
import {
  KPI_WRITE_FAILURE_METRIC,
  KPI_WRITE_FAILURE_NAMESPACE,
  KPI_WRITE_FAILURE_STAGES,
} from './kpi-write-failure-alarm';
import { synthesizeKpiWriteFailureAlarm } from './kpi-write-failure-alarm-fixtures';

/**
 * 2.45.0 review F3: a failed KeywordRunKpis / KeywordLatest write was only a
 * `KeywordRunKpisWriteFailure` count that nothing watched.
 */
const snapshot = synthesizeKpiWriteFailureAlarm();
const stageMetrics = snapshot.metrics.filter((metric) => metric.expression === '');

describe('KPI write-failure alarm metrics', () => {
  it('reads the metric under every stage the Lambdas emit it with', () => {
    expect(stageMetrics.map((metric) => metric.stage)).toStrictEqual([...KPI_WRITE_FAILURE_STAGES]);
  });

  it('reads the KeywordRunKpisWriteFailure count of the KPI rollup namespace, summed per 5 minutes', () => {
    expect([...new Set(stageMetrics.map((metric) => `${metric.namespace}/${metric.metricName}/${metric.stat}/${String(metric.period)}`))])
      .toStrictEqual([`${KPI_WRITE_FAILURE_NAMESPACE}/${KPI_WRITE_FAILURE_METRIC}/Sum/300`]);
  });

  it('alarms on the sum of the stages, a missing stage counting as zero', () => {
    expect(snapshot.metrics.filter((metric) => metric.returnData !== false).map((metric) => metric.expression))
      .toStrictEqual(['FILL(m0, 0) + FILL(m1, 0) + FILL(m2, 0) + FILL(m3, 0)']);
  });
});

describe('KPI write-failure alarm threshold', () => {
  it('is one alarm, named for the metric', () => {
    expect(snapshot.alarmLogicalIds).toHaveLength(1);
  });

  it('goes to ALARM on the first failed write in a 5-minute period', () => {
    expect([snapshot.threshold, snapshot.comparisonOperator, snapshot.evaluationPeriods])
      .toStrictEqual([1, 'GreaterThanOrEqualToThreshold', 1]);
  });

  it('stays OK while no write fails, when the metric has no data', () => {
    expect(snapshot.treatMissingData).toBe('notBreaching');
  });
});

/**
 * The topic is encrypted with `alias/aws/sns`, which CloudWatch alarms cannot
 * publish to, so the alarm's action is the relay Lambda, not the topic.
 */
describe('KPI write-failure alarm action', () => {
  it('invokes the relay Lambda, and only on ALARM', () => {
    expect(snapshot.alarmActions).toStrictEqual([JSON.stringify({ 'Fn::GetAtt': [snapshot.relayLogicalId, 'Arn'] })]);
    expect(snapshot.okActions).toBeUndefined();
  });

  it('never lists the aws/sns-encrypted topic as an alarm action', () => {
    expect(snapshot.alarmActions.filter((action) => action.includes(snapshot.topicLogicalId))).toStrictEqual([]);
  });

  it('lets only this alarm invoke the relay', () => {
    expect(snapshot.relayInvokers).toStrictEqual([{
      principal: 'lambda.alarms.cloudwatch.amazonaws.com',
      sourceArn: JSON.stringify({ 'Fn::GetAtt': [snapshot.alarmLogicalIds[0], 'Arn'] }),
    }]);
  });
});

describe('KPI write-failure relay', () => {
  it('publishes to the KPI alerts topic and may do nothing else', () => {
    expect(snapshot.relayEnvironment).toStrictEqual({ KPI_ALERTS_TOPIC_ARN: { Ref: snapshot.topicLogicalId } });
    expect(snapshot.relayActions).toStrictEqual(['sns:Publish']);
  });

  it('runs Python 3.12 and publishes only for the ALARM state', () => {
    expect(snapshot.relayRuntime).toBe('python3.12');
    expect(snapshot.relayCode).toContain("if state.get('value') != 'ALARM':");
    expect(snapshot.relayCode).toContain("TopicArn=os.environ['KPI_ALERTS_TOPIC_ARN']");
  });

  it('logs to its own log group, kept for a month', () => {
    expect(snapshot.relayLogGroupNames).toStrictEqual(['/aws/lambda/CitationAnalysis-KpiWriteFailureRelay']);
  });
});
