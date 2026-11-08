import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { claudeInvokeModelStatement } from './constructs/bedrock-invoke';
import { allow, apiKeySecret, lambdaServiceRole } from './constructs/permissions';
import {
  GOOGLE_AI_OVERVIEW_PROVIDER, providerSearchEnvironment, providerSearchFunction, type ProviderSearchResourceNames
} from './constructs/provider-search';
import { lambdaSourceCode, pythonLayer } from './constructs/python-layer';
import { SeoApi } from './constructs/seo-api';
import { type SeoFeatureProps, sharedTableActions } from './constructs/seo-feature';
import { seoFeatures } from './seo-features';
import { pythonFunction } from './constructs/api-functions';

/** The SEO jobs function's name (state machines invoke it). */
export const SEO_JOBS_FUNCTION_NAME = 'CitationAnalysis-SeoJobs';
import { citationAnalysisTable } from './constructs/tables';

/**
 * Main-stack resources the SEO functions use, by their constant names: a
 * cross-stack export would lock each value forever, and these names never
 * change for the life of the resource.
 */
const MAIN_TABLES = {
  searchResults: 'CitationAnalysis-SearchResults',
  keywords: 'CitationAnalysis-Keywords',
  brandConfig: 'CitationAnalysis-BrandConfig',
  providerConfig: 'CitationAnalysis-ProviderConfig',
  citations: 'CitationAnalysis-Citations',
} as const;
const CORS_ORIGIN_PARAMETER = '/citation-analysis/cors-origin';
/** The main stack's `CorsOrigin` export (the CloudFront origin): stable for the life of the distribution. */
const CORS_ORIGIN_EXPORT = 'CitationAnalysis-CorsOrigin';
/** Raw-responses bucket prefix the SEO router reads and writes (oversized cache payloads, `seo/cache/`). */
const SEO_OBJECT_PREFIX = 'seo/*';

type MainTables = Record<keyof typeof MAIN_TABLES, dynamodb.ITable>;

/** The main-stack tables by name; `grantIndexPermissions` makes every read grant cover the table's GSIs too. */
function importMainTables(scope: Construct): MainTables {
  const imported = (key: keyof typeof MAIN_TABLES): dynamodb.ITable => dynamodb.Table.fromTableAttributes(
    scope, `${key}Table`, { tableName: MAIN_TABLES[key], grantIndexPermissions: true }
  );
  return {
    searchResults: imported('searchResults'),
    keywords: imported('keywords'),
    brandConfig: imported('brandConfig'),
    providerConfig: imported('providerConfig'),
    citations: imported('citations'),
  };
}

/** What the SEO stack builds on from the main stack; only the user pool (its id and ARN never change). */
export interface SeoStackInputs {
  readonly userPool: cognito.IUserPool;
}

export interface CitationAnalysisSeoStackProps extends cdk.StackProps {
  /** The main stack's `seoInputs`. */
  readonly inputs: SeoStackInputs;
}

/**
 * A sibling of `CitationAnalysisStack` for the SEO features (DataForSEO keyword
 * data, SERPs, SEO vs GEO) and the Google AI Overviews engine. Separate because
 * the main stack sits at CloudFormation's 500-resource limit.
 *
 * It builds its own shared layer version (a cross-stack layer reference would
 * block every main-stack deploy that rebuilds the layer, see `python-layer.ts`)
 * and imports only the user pool and the `CitationAnalysis-CorsOrigin` export;
 * every other main-stack resource is named by constant.
 *
 * The AI Overviews function is called by name from the main workflow once
 * `-c seoEngine=true` adds its branch there, so deploy this stack first.
 */
export class CitationAnalysisSeoStack extends cdk.Stack {
  public readonly seoApi: SeoApi;
  public readonly aiOverviewFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: CitationAnalysisSeoStackProps) {
    super(scope, id, props);
    const devMode = this.node.tryGetContext('dev') === 'true';

    const sharedLayer = pythonLayer(this, 'SharedLayer', {
      directory: 'layer',
      label: 'Shared',
      layerVersionName: 'CitationAnalysis-SeoSharedLayer',
      description: 'Shared Python code and dependencies for the Citation Analysis SEO stack',
    });

    const keywordMetricsTable = citationAnalysisTable(this, 'SeoKeywordMetricsTable', {
      tableName: 'CitationAnalysis-SeoKeywordMetrics',
      partitionKey: { name: 'keyword_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'market_id', type: dynamodb.AttributeType.STRING },
    });
    const cacheTable = citationAnalysisTable(this, 'SeoCacheTable', {
      tableName: 'CitationAnalysis-SeoCache',
      partitionKey: { name: 'cache_key', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    const mainTables = importMainTables(this);
    const rawResponsesBucket = s3.Bucket.fromBucketName(
      this, 'RawResponsesBucket', `citation-analysis-raw-responses-${this.account}`
    );
    const dataForSeoSecret = apiKeySecret(this, 'DataForSeoSecret', 'dataforseo');

    const environment: Record<string, string> = {
      DYNAMODB_TABLE_SEO_KEYWORD_METRICS: keywordMetricsTable.tableName,
      DYNAMODB_TABLE_SEO_CACHE: cacheTable.tableName,
      DYNAMODB_TABLE_SEARCH_RESULTS: MAIN_TABLES.searchResults,
      DYNAMODB_TABLE_KEYWORDS: MAIN_TABLES.keywords,
      DYNAMODB_TABLE_BRAND_CONFIG: MAIN_TABLES.brandConfig,
      RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
      SECRETS_PREFIX: 'citation-analysis/',
      CORS_ORIGIN_PARAM: CORS_ORIGIN_PARAMETER,
      ...(devMode ? { ALLOW_LOCALHOST: 'true' } : {}),
    };

    this.seoApi = new SeoApi(this, 'SeoApi', {
      userPool: props.inputs.userPool,
      sharedLayer,
      environment,
      allowOrigin: devMode ? '*' : cdk.Fn.importValue(CORS_ORIGIN_EXPORT),
    });
    const router = this.seoApi.routerFunction;
    const jobs = this.jobsFunction(sharedLayer, environment);
    for (const fn of [router, jobs]) {
      // Per action, no delete (TENETS.md, tenet 6 and D5): stored keyword metrics are batch-written; the cache is
      // read and put (a conditional put never replaces a fresh non-empty answer), never deleted from.
      keywordMetricsTable.grant(fn, ...sharedTableActions({ batchWrites: true }));
      cacheTable.grant(fn, ...sharedTableActions({}));
      // Only the main-stack tables the handlers read; ProviderConfig is the AI Overviews function's.
      for (const table of [mainTables.searchResults, mainTables.keywords, mainTables.brandConfig]) {
        table.grantReadData(fn);
      }
      dataForSeoSecret.grantRead(fn);
      allow(fn, ['s3:GetObject', 's3:PutObject'], [rawResponsesBucket.arnForObjects(SEO_OBJECT_PREFIX)]);
    }
    ssm.StringParameter.fromStringParameterName(this, 'CorsOriginParam', CORS_ORIGIN_PARAMETER).grantRead(router);

    const featureProps: SeoFeatureProps = {
      router, jobs, sharedLayer, environment, rawResponsesBucket, mainTables,
    };
    // SEO features: each adds its tables, jobs and grants, and its routes to the API.
    for (const feature of seoFeatures(this, featureProps)) {
      this.seoApi.addRoutes(feature.routes);
    }

    this.aiOverviewFunction = this.aiOverviewSearch(sharedLayer, {
      mainTables, rawResponsesBucket, dataForSeoSecret,
    });

    new cdk.CfnOutput(this, 'SeoApiUrl', {
      value: this.seoApi.api.url,
      description: 'SEO API Gateway URL (the dashboard calls <SeoApiUrl>api/seo/...)',
    }).overrideLogicalId('SeoApiUrl');
  }

  /**
   * `CitationAnalysis-SeoJobs`: every step of the SEO state machines (rank
   * checks, audits, snapshots). It carries the router's environment; each
   * feature construct grants it what its steps touch.
   */
  private jobsFunction(sharedLayer: lambda.ILayerVersion, environment: Record<string, string>): lambda.Function {
    return pythonFunction(this, 'Jobs', {
      functionName: SEO_JOBS_FUNCTION_NAME,
      description: 'SEO jobs: the steps of the SEO state machines (rank checks, audits, snapshots)',
      handler: 'seo-jobs.handler',
      code: lambdaSourceCode('seo-jobs'),
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment,
    }, cdk.RemovalPolicy.DESTROY);
  }

  /**
   * `CitationAnalysis-Search-google_ai_overview`: the main stack's provider
   * search function (same code, handler, environment keys) for Google AI
   * Overviews, with a role shaped like the main `SearchLambdaRole` for one
   * provider: put (and on a retry query) SearchResults and write raw responses, read BrandConfig,
   * get and update its ProviderConfig row (enablement, health, pacing, saved Bedrock models),
   * Claude for brand extraction, and only the DataForSEO secret.
   */
  private aiOverviewSearch(
    sharedLayer: lambda.ILayerVersion,
    resources: {
      mainTables: MainTables;
      rawResponsesBucket: s3.IBucket;
      dataForSeoSecret: secretsmanager.ISecret;
    },
  ): lambda.Function {
    const role = lambdaServiceRole(
      this,
      'SeoSearchLambdaRole',
      'CitationAnalysis-SeoSearchLambdaRole',
      'Role for the Google AI Overviews search Lambda to access Secrets Manager, DynamoDB, S3 and Bedrock'
    );
    resources.dataForSeoSecret.grantRead(role);
    // Per action, no delete (TENETS.md, tenet 6 and D5): the handler stores each answer (PutItem) and, on a
    // retried invocation, reads what an earlier attempt stored (Query); it reads and updates the provider's
    // config row (enablement, saved model, pacing and health).
    resources.mainTables.searchResults.grant(role, 'dynamodb:PutItem', 'dynamodb:Query');
    // Each raw answer is put once under raw-responses/ (Bronze, write-once): no delete, nothing outside the prefix.
    allow(role, ['s3:PutObject'], [resources.rawResponsesBucket.arnForObjects('raw-responses/*')]);
    resources.mainTables.brandConfig.grantReadData(role);
    resources.mainTables.providerConfig.grant(role, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    role.addToPolicy(claudeInvokeModelStatement(this));

    const names: ProviderSearchResourceNames = {
      searchResultsTable: MAIN_TABLES.searchResults,
      brandConfigTable: MAIN_TABLES.brandConfig,
      providerConfigTable: MAIN_TABLES.providerConfig,
      rawResponsesBucket: resources.rawResponsesBucket.bucketName,
    };
    return providerSearchFunction(this, GOOGLE_AI_OVERVIEW_PROVIDER, {
      code: lambdaSourceCode('search'),
      role,
      layers: [sharedLayer],
      environment: providerSearchEnvironment(this, names),
    }, { cap: GOOGLE_AI_OVERVIEW_PROVIDER.defaultConcurrency, interval: 0 }, 'GoogleAiOverviewSearch');
  }
}
