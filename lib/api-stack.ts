import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import {
  DASHBOARD_API_FUNCTION_KEYS,
  DashboardRestApi,
  WILDCARD_PERMISSION_FUNCTION_KEYS,
  type DashboardApiFunctions,
} from './constructs/rest-api';

/**
 * The object the dashboard reads at startup (`web/src/infrastructure/config`)
 * to find the API: `{ "apiUrl": "<stage url>/api" }`. The main stack's web
 * deployment excludes it, so a dashboard deploy never overwrites or prunes it.
 */
export const RUNTIME_CONFIG_OBJECT_KEY = 'config.json';

/** What the API stack takes from the main stack: values that never change for the lifetime of their resource. */
export interface DashboardApiInputs {
  /** The API Lambdas. Each has a fixed function name, so its ARN is stable. */
  readonly functions: DashboardApiFunctions;
  readonly userPool: cognito.IUserPool;
  /** The dashboard bucket (fixed name `citation-analysis-web-<account>`); receives `config.json`. */
  readonly webBucket: s3.IBucket;
  /** The dashboard distribution: its domain is the CORS origin, its id the `/config.json` invalidation target. */
  readonly distribution: cloudfront.IDistribution;
}

export interface CitationAnalysisApiStackProps extends cdk.StackProps {
  /** The main stack's `apiInputs`. */
  readonly inputs: DashboardApiInputs;
}

/**
 * The dashboard REST API, out of the main stack, which had reached
 * CloudFormation's 500-resource limit (2.42.0: 497, of them ~310 API
 * Gateway resources and permissions). The API is stateless, so it can live in
 * a stack of its own; the tables, buckets, functions, user pool and
 * distribution it fronts stay in the main stack (fixed names and RETAIN).
 *
 * Cross-stack references are CloudFormation exports of the main stack, so
 * only values that never change are imported: function ARNs (fixed names),
 * the user pool ARN, the web bucket name and the distribution id and domain.
 * The functions are imported here so their invoke permissions are created in
 * this stack: the main stack references nothing of this one, so there is no
 * cycle and `cdk deploy --all` deploys the main stack first.
 *
 * The API URL changes with the API (once, at the move), so the dashboard
 * does not bake it in: this stack writes `config.json` into the web bucket
 * and invalidates it on the distribution.
 */
export class CitationAnalysisApiStack extends cdk.Stack {
  public readonly restApi: DashboardRestApi;

  constructor(scope: Construct, id: string, props: CitationAnalysisApiStackProps) {
    super(scope, id, props);
    const { inputs } = props;
    const dashboardOrigin = `https://${inputs.distribution.distributionDomainName}`;

    this.restApi = new DashboardRestApi(this, 'DashboardApi', {
      functions: importFunctions(this, inputs.functions),
      userPool: cognito.UserPool.fromUserPoolArn(this, 'UserPool', inputs.userPool.userPoolArn),
      dashboardOrigin,
      // `cdk deploy --context dev=true`: gateway responses allow every origin (localhost:5173).
      devMode: this.node.tryGetContext('dev') === 'true',
    });
    const apiUrl = `${this.restApi.api.url}api`;

    // `prune: false` and `retainOnDelete: true`: the destination is the
    // whole dashboard bucket, so a prune or a delete-on-remove would take the
    // dashboard's own files with it.
    new s3deploy.BucketDeployment(this, 'DeployRuntimeConfig', {
      sources: [s3deploy.Source.jsonData(RUNTIME_CONFIG_OBJECT_KEY, { apiUrl })],
      destinationBucket: s3.Bucket.fromBucketName(this, 'WebBucket', inputs.webBucket.bucketName),
      prune: false,
      retainOnDelete: true,
      contentType: 'application/json',
      // Revalidated on every load, so a moved API is picked up at once.
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution: cloudfront.Distribution.fromDistributionAttributes(this, 'WebDistribution', {
        distributionId: inputs.distribution.distributionId,
        domainName: inputs.distribution.distributionDomainName,
      }),
      distributionPaths: [`/${RUNTIME_CONFIG_OBJECT_KEY}`],
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.restApi.api.url,
      description: 'API Gateway URL',
      exportName: 'CitationAnalysis-ApiGatewayUrl',
    });
    new cdk.CfnOutput(this, 'DashboardApiUrl', {
      value: apiUrl,
      description: 'Base URL the dashboard calls, as written to config.json',
    });
  }
}

/**
 * Each API Lambda as a function of this stack's environment, imported by ARN.
 * `sameEnvironment` lets CDK add the per-method invoke permissions here; the
 * routers with one wildcard permission (`DashboardRestApi`) are imported
 * without it and with `skipPermissions`, so CDK adds none for them.
 */
function importFunctions(scope: Construct, functions: DashboardApiFunctions): DashboardApiFunctions {
  const imported = DASHBOARD_API_FUNCTION_KEYS.map((key) => {
    const wildcard = WILDCARD_PERMISSION_FUNCTION_KEYS.includes(key);
    return [key, lambda.Function.fromFunctionAttributes(scope, `${key}-Function`, {
      functionArn: functions[key].functionArn,
      sameEnvironment: !wildcard,
      skipPermissions: wildcard,
    })] as const;
  });
  return Object.fromEntries(imported) as DashboardApiFunctions;
}
