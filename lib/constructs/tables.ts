import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/** A global secondary index of a stack table. ALL remains the default projection. */
export type CitationAnalysisIndexSpec = Pick<
  dynamodb.GlobalSecondaryIndexProps,
  'indexName' | 'partitionKey' | 'sortKey' | 'projectionType' | 'nonKeyAttributes'
>;

/** The schema of one stack table; everything else is fixed by `citationAnalysisTable`. */
interface CitationAnalysisTableSpec {
  tableName: string;
  partitionKey: dynamodb.Attribute;
  sortKey?: dynamodb.Attribute;
  /** Epoch-seconds attribute after which DynamoDB expires the item. Omitted for tables that keep every row. */
  timeToLiveAttribute?: string;
  /** Optional stream image used by durable event-driven workers. */
  stream?: dynamodb.StreamViewType;
  /**
   * Added in the order listed. The order is load-bearing: it fixes the order of
   * the template's AttributeDefinitions, and a reorder is a table diff on deploy.
   */
  globalSecondaryIndexes?: CitationAnalysisIndexSpec[];
}

/** A string key attribute named `name`. */
export function stringKey(name: string): dynamodb.Attribute {
  return { name, type: dynamodb.AttributeType.STRING };
}

/**
 * One DynamoDB table with the settings every Citation Analysis table shares:
 * on-demand billing, AWS-managed encryption, point-in-time recovery and
 * `RETAIN`, so tearing a stack down can never delete data. Only the
 * schema varies between tables, and that is all a spec states.
 */
export function citationAnalysisTable(scope: Construct, id: string, spec: CitationAnalysisTableSpec): dynamodb.Table {
  const table = new dynamodb.Table(scope, id, {
    tableName: spec.tableName,
    partitionKey: spec.partitionKey,
    sortKey: spec.sortKey,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    timeToLiveAttribute: spec.timeToLiveAttribute,
    stream: spec.stream,
  });

  for (const index of spec.globalSecondaryIndexes ?? []) {
    table.addGlobalSecondaryIndex({
      ...index,
      projectionType: index.projectionType ?? dynamodb.ProjectionType.ALL,
    });
  }

  return table;
}
