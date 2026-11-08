import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

/** The parts of a stack data bucket that differ between buckets; `citationAnalysisBucket` fixes the rest. */
export interface CitationAnalysisBucketSpec {
  /** Names the bucket `citation-analysis-<name>-<account>` and its access-log prefix `<name>/`. */
  name: string;
  accessLogsBucket: s3.IBucket;
  lifecycleRules?: s3.LifecycleRule[];
}

/**
 * One S3 data bucket with the settings every data bucket of the app shares:
 * AWS-managed encryption, no versioning, all public access blocked, SSL-only,
 * `RETAIN` so tearing the stack down can never delete data, and server access
 * logs written to the shared access-logs bucket under the bucket's own prefix.
 */
export function citationAnalysisBucket(stack: cdk.Stack, id: string, spec: CitationAnalysisBucketSpec): s3.Bucket {
  return new s3.Bucket(stack, id, {
    bucketName: `citation-analysis-${spec.name}-${stack.account}`,
    encryption: s3.BucketEncryption.S3_MANAGED,
    versioned: false,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    enforceSSL: true,
    serverAccessLogsBucket: spec.accessLogsBucket,
    serverAccessLogsPrefix: `${spec.name}/`,
    lifecycleRules: spec.lifecycleRules,
  });
}
