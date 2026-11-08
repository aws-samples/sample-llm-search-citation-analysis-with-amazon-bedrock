import * as cdk from 'aws-cdk-lib';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal, type IRole } from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  DASHBOARD_API_FUNCTION_KEYS,
  DASHBOARD_API_FUNCTION_NAMES,
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

/**
 * SSM parameters the main stack writes and the API stack reads at deploy
 * time. Each holds a value that never changes for the lifetime of its
 * resource (the user pool id, the distribution id, the dashboard origin).
 */
export const DASHBOARD_API_PARAMETERS = {
  /** `https://<distribution domain>`: also what the API Lambdas allow as CORS origin. */
  corsOrigin: '/citation-analysis/cors-origin',
  userPoolId: '/citation-analysis/user-pool-id',
  webDistributionId: '/citation-analysis/web-distribution-id',
} as const;

/**
 * The dashboard REST API, out of the main stack, which had reached
 * CloudFormation's 500-resource limit (2.42.0: 497, of them ~310 API
 * Gateway resources and permissions). The API is stateless, so it can live in
 * a stack of its own; the tables, buckets, functions, user pool and
 * distribution it fronts stay in the main stack (fixed names and RETAIN).
 *
 * It takes nothing from the main stack by cross-stack reference (2.45.0
 * review F11). A reference is a CloudFormation export, and an export another
 * stack imports can be neither changed nor removed, so renaming or replacing
 * any of those resources would block the main stack's deploys. Instead:
 * - the API Lambdas' ARNs are built from their fixed names
 *   (`DASHBOARD_API_FUNCTION_NAMES`, which the main stack names them from);
 * - the web bucket name is fixed per account (`citation-analysis-web-<account>`);
 * - the user pool id, the distribution id and the dashboard origin are read
 *   from SSM parameters the main stack writes (`DASHBOARD_API_PARAMETERS`),
 *   resolved when this stack deploys.
 * The functions are imported here so their invoke permissions are created in
 * this stack. Nothing orders the two stacks implicitly any more, so `bin/`
 * declares the dependency: `cdk deploy --all` deploys the main stack first.
 *
 * The API URL changes with the API (once, at the move), so the dashboard
 * does not bake it in: this stack writes `config.json` into the web bucket
 * and invalidates it on the distribution.
 */
export class CitationAnalysisApiStack extends cdk.Stack {
  public readonly restApi: DashboardRestApi;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);
    const dashboardOrigin = ssm.StringParameter.valueForStringParameter(this, DASHBOARD_API_PARAMETERS.corsOrigin);
    const userPoolId = ssm.StringParameter.valueForStringParameter(this, DASHBOARD_API_PARAMETERS.userPoolId);
    const distributionId = ssm.StringParameter.valueForStringParameter(this, DASHBOARD_API_PARAMETERS.webDistributionId);

    this.restApi = new DashboardRestApi(this, 'DashboardApi', {
      functions: importFunctions(this),
      userPool: cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId),
      dashboardOrigin,
      // `cdk deploy --context dev=true`: gateway responses allow every origin (localhost:5173).
      devMode: this.node.tryGetContext('dev') === 'true',
    });
    const apiUrl = `${this.restApi.api.url}api`;

    // `prune: false` and `retainOnDelete: true`: the destination is the
    // whole dashboard bucket, so a prune or a delete-on-remove would take the
    // dashboard's own files with it.
    const webBucket = s3.Bucket.fromBucketName(this, 'WebBucket', `citation-analysis-web-${this.account}`);
    new s3deploy.BucketDeployment(this, 'DeployRuntimeConfig', {
      sources: [s3deploy.Source.jsonData(RUNTIME_CONFIG_OBJECT_KEY, { apiUrl })],
      destinationBucket: webBucket,
      role: this.runtimeConfigRole(webBucket, distributionId),
      prune: false,
      retainOnDelete: true,
      contentType: 'application/json',
      // Revalidated on every load, so a moved API is picked up at once.
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution: cloudfront.Distribution.fromDistributionAttributes(this, 'WebDistribution', {
        distributionId,
        // `https://<domain>` -> `<domain>`; the invalidation itself needs only the id.
        domainName: cdk.Fn.select(2, cdk.Fn.split('/', dashboardOrigin)),
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

  /**
   * The role of the `config.json` deployment, instead of CDK's default
   * (`s3:DeleteObject*` on the whole web bucket, `cloudfront:CreateInvalidation`
   * on `*`): read the CDK asset it copies, list the web bucket (the copy is an
   * `s3 sync`), write `config.json` only, and invalidate this distribution only.
   * Passed without policy updates, so CDK adds nothing to it.
   */
  private runtimeConfigRole(webBucket: s3.IBucket, distributionId: string): IRole {
    const role = new Role(this, 'RuntimeConfigDeploymentRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Writes config.json to the web bucket and invalidates it on the dashboard distribution',
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    const assets = `arn:${this.partition}:s3:::cdk-*-assets-${this.account}-${this.region}`;
    role.addToPolicy(new PolicyStatement({ actions: ['s3:GetObject'], resources: [`${assets}/*`] }));
    role.addToPolicy(new PolicyStatement({ actions: ['s3:ListBucket'], resources: [webBucket.bucketArn, assets] }));
    role.addToPolicy(new PolicyStatement({
      actions: ['s3:PutObject'], resources: [webBucket.arnForObjects(RUNTIME_CONFIG_OBJECT_KEY)],
    }));
    role.addToPolicy(new PolicyStatement({
      actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
      resources: [`arn:${this.partition}:cloudfront::${this.account}:distribution/${distributionId}`],
    }));
    return role.withoutPolicyUpdates();
  }
}

/**
 * Each API Lambda, imported by the ARN its fixed name gives in this stack's
 * account and region. `sameEnvironment` lets CDK add the per-method invoke
 * permissions here; the routers with one wildcard permission
 * (`DashboardRestApi`) are imported without it and with `skipPermissions`,
 * so CDK adds none for them.
 */
function importFunctions(scope: cdk.Stack): DashboardApiFunctions {
  const imported = DASHBOARD_API_FUNCTION_KEYS.map((key) => {
    const wildcard = WILDCARD_PERMISSION_FUNCTION_KEYS.includes(key);
    return [key, lambda.Function.fromFunctionAttributes(scope, `${key}-Function`, {
      functionArn: scope.formatArn({
        service: 'lambda',
        resource: 'function',
        resourceName: DASHBOARD_API_FUNCTION_NAMES[key],
        arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
      }),
      sameEnvironment: !wildcard,
      skipPermissions: wildcard,
    })] as const;
  });
  return Object.fromEntries(imported) as DashboardApiFunctions;
}
