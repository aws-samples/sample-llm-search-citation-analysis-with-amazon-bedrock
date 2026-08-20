import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
// No aws-wafv2 import: the only L1 WAF construct in this stack was the
// unassociated REGIONAL ACL deleted on 2026-08-19. The CloudFront Web ACL is
// built through a us-east-1 custom resource (boto3 wafv2), not this module.
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as path from 'path';
import * as fs from 'fs';
import { Auth } from './constructs/auth';

/**
 * Bedrock model tier defaults per task role.
 *
 * Tiers map to model families in lambda/shared/models.py:
 *   fast     -> Haiku
 *   balanced -> Sonnet
 *   deep     -> Opus
 *
 * Lambdas read BEDROCK_TIER_<ROLE> and resolve the model ID via
 * shared.models.get_model_id(). To pin a specific model ID in an incident,
 * set BEDROCK_MODEL_<ROLE> (takes precedence over the tier).
 */
const bedrockTierEnv = {
  BEDROCK_TIER_SUMMARIZATION: 'fast',
  BEDROCK_TIER_EXTRACTION:    'fast',
  BEDROCK_TIER_GENERATION:    'fast',
  BEDROCK_TIER_ANALYSIS:      'balanced',
} as const;

/**
 * Concurrency ceiling for the functions that invoke themselves asynchronously.
 *
 * `contentStudioFunction` and `keywordMgmtFunction` both re-invoke themselves
 * via `shared/self_invoke.py` to run long work in the background. Async Lambda
 * invocations are retried twice by default, so without a ceiling a bug in a
 * self-invoke guard becomes an invocation storm: it consumes the account's
 * entire concurrency pool — starving every other function in the stack,
 * including `manage-users` — while billing an LLM call per invocation
 * (AUDIT-2026-08-19 §2.4).
 *
 * 10 is deliberately generous for the expected load (a marketing team, not
 * public traffic) while bounding a runaway loop to 10 concurrent executions
 * instead of the account default of ~1000. Note this also *reserves* the
 * capacity, guaranteeing these two can always run.
 *
 * If legitimate users start seeing 429s on content generation or keyword
 * research, raise this — do not remove it.
 */
const SELF_INVOKING_FUNCTION_CONCURRENCY = 10;

/**
 * API Gateway's REST API integration timeout: a hard 29 seconds, not raisable.
 *
 * A Lambda behind API Gateway with a longer timeout does not get more time to
 * answer — the client has already received a 504 at 29s. It gets more time to
 * keep burning: billing compute, calling paid models, and writing to DynamoDB
 * for a response nobody will ever receive (AUDIT-2026-08-19 §2.9).
 *
 * So every function whose ONLY invoker is API Gateway is capped here. The
 * failure then surfaces as a Lambda timeout — visible in the function's own
 * Duration/Errors metrics — instead of only as an opaque gateway 504.
 *
 * Two deliberate exceptions, both documented at their definitions:
 *   - `contentStudioFunction` and `keywordMgmtFunction` also run as their own
 *     async workers via `shared/self_invoke.py`. That path is NOT behind API
 *     Gateway and legitimately needs minutes.
 *   - `selfReflectionFunction` persists its result as the last step of a
 *     synchronous Bedrock call, so a 504 today is still recoverable from the
 *     cache it writes. Capping it at 29s would turn a slow request into
 *     permanent loss.
 *
 * Functions invoked by Step Functions (parse-keywords, search, deduplication,
 * crawler, generate-summary) are not subject to this at all.
 */
const API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS = 29;

/**
 * Thrown at synth time when a Lambda layer's local build output is missing.
 * Layers must be built (scripts/deploy.sh or the per-layer build-layer.sh)
 * before `cdk synth`/`cdk deploy`.
 */
class LayerNotBuiltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerNotBuiltError';
  }
}

/**
 * Fail synth when the built layer is missing shared modules that exist in
 * source.
 *
 * `lambda/layer/python/` is gitignored build output, and the existence check
 * alone passes against a *stale* build. Every handler imports `shared.*` from
 * this layer, so a module added to `lambda/shared/` without rebuilding
 * deploys cleanly and then ModuleNotFoundErrors on the first invocation of
 * every affected function — with nothing in the CDK output hinting why.
 *
 * This bit for real: `auth.py`, `safe_fetch.py` and `stale_jobs.py` were all
 * added to source while the built layer still held the previous set.
 */
function assertLayerContainsAllSharedModules(builtSharedPath: string): void {
  const sourceSharedPath = path.join(__dirname, '../lambda/shared');
  if (!fs.existsSync(sourceSharedPath)) return;

  const expected = fs
    .readdirSync(sourceSharedPath)
    .filter((name) => name.endsWith('.py') && !name.startsWith('test_'));

  const built = fs.existsSync(builtSharedPath) ? fs.readdirSync(builtSharedPath) : [];
  const missing = expected.filter((name) => !built.includes(name));

  if (missing.length > 0) {
    throw new LayerNotBuiltError(
      `Shared layer is stale — missing ${missing.join(', ')}.\n` +
      'Every Lambda imports these from the layer, so deploying now would fail ' +
      'at import time.\n' +
      'Run: bash lambda/layer/build-layer.sh\n' +
      'Or use scripts/deploy.sh which builds all layers automatically.'
    );
  }
}

/**
 * Explicit 30-day CloudWatch log group for one of the API Lambda functions.
 *
 * A Lambda with no log group in the template still gets one: the Lambda
 * service auto-creates `/aws/lambda/<functionName>` on first invocation, with
 * retention set to "Never expire". 39 of this account's 45 log groups were in
 * exactly that state, holding 70 MB that only grows and that nobody reads
 * past the first week of an incident (AUDIT-2026-08-19 §2.7).
 *
 * This mirrors the five Step Functions workers, which have carried explicit
 * `logs.LogGroup` constructs from the start. It is deliberately NOT
 * `logRetention:` on `lambda.Function`: that prop is deprecated in
 * aws-cdk-lib 2.x in favour of `logGroup`, and it works by deploying a
 * singleton custom-resource Lambda that calls PutRetentionPolicy after the
 * fact — an extra moving part to own for something the log group resource
 * states directly.
 *
 * WHY `RETAIN` HERE WHEN THE WORKERS USE `DESTROY` — read before deploying:
 *
 * All twelve of these groups ALREADY EXIST in the deployed account. The Lambda
 * service created them, so CloudFormation has never known about them, and
 * CloudFormation cannot Create a log group whose name is already taken. The
 * first `cdk deploy` carrying this change therefore fails with
 * "already exists" unless each group is first brought under stack management
 * (`cdk import`) or deleted so CloudFormation can recreate it.
 *
 * `RETAIN` is what keeps the import route open at all: CloudFormation's import
 * operation requires a DeletionPolicy on every resource being imported. It
 * also means that removing or renaming one of these constructs later abandons
 * the group rather than deleting production logs — which for the workers'
 * short-lived debug output did not matter, and here does.
 */
function apiLambdaLogGroup(scope: Construct, id: string, functionName: string): logs.LogGroup {
  return new logs.LogGroup(scope, id, {
    logGroupName: `/aws/lambda/${functionName}`,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });
}

/**
 * Creates optimized Lambda code bundle containing only the specific handler
 * file. Shared code (including Decimal helpers, now in
 * shared/dynamo_decimal.py) ships via the Lambda layer. This reduces
 * deployment package size and improves cold start times compared to bundling
 * all API handlers together.
 * 
 * Uses local bundling (no Docker required) with Docker as fallback.
 * 
 * @param handlerFileName - The Python handler file name (e.g., 'get-stats.py')
 * @returns Lambda Code asset with only the required files
 */
// Python bytecode caches are volatile local artifacts: running pytest rewrites
// them inside the lambda/ source trees, which would otherwise change every
// asset hash and trigger spurious redeploys of unchanged functions.
const PYTHON_ASSET_EXCLUDES = ['**/__pycache__', '**/*.pyc'];

function createApiLambdaCode(handlerFileName: string): lambda.Code {
  const apiPath = path.join(__dirname, '../lambda/api');
  
  return lambda.Code.fromAsset(apiPath, {
    exclude: PYTHON_ASSET_EXCLUDES,
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: [
        'bash', '-c',
        `mkdir -p /asset-output && ` +
        `cp /asset-input/${handlerFileName} /asset-output/`
      ],
      local: {
        tryBundle(outputDir: string): boolean {
          try {
            // Copy the specific handler file
            const handlerSrc = path.join(apiPath, handlerFileName);
            const handlerDest = path.join(outputDir, handlerFileName);
            fs.copyFileSync(handlerSrc, handlerDest);
            
            return true;
          } catch {
            return false;
          }
        },
      },
    },
  });
}

/**
 * Creates a Lambda code bundle containing multiple handler files.
 * Used for consolidated Lambda functions that route between multiple handlers.
 * 
 * @param handlerFileNames - Array of Python file names to include in the bundle
 * @returns Lambda Code asset with all specified files
 */
function createConsolidatedApiLambdaCode(handlerFileNames: string[]): lambda.Code {
  const apiPath = path.join(__dirname, '../lambda/api');
  const cpCommands = handlerFileNames.map(f => `cp /asset-input/${f} /asset-output/`).join(' && ');
  
  return lambda.Code.fromAsset(apiPath, {
    exclude: PYTHON_ASSET_EXCLUDES,
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: [
        'bash', '-c',
        `mkdir -p /asset-output && ${cpCommands}`
      ],
      local: {
        tryBundle(outputDir: string): boolean {
          try {
            for (const fileName of handlerFileNames) {
              const src = path.join(apiPath, fileName);
              const dest = path.join(outputDir, fileName);
              fs.copyFileSync(src, dest);
            }
            return true;
          } catch {
            return false;
          }
        },
      },
    },
  });
}

class WebBuildRequiredError extends Error {
  constructor() {
    super('Web dashboard not built. Run "./scripts/deploy.sh" for full deployment, or "cd web && npm install && npm run build" before "cdk deploy".');
    this.name = 'WebBuildRequiredError';
  }
}

export class CitationAnalysisStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Dev mode: `cdk deploy --context dev=true` adds http://localhost:5173 as allowed CORS origin
    const devMode = this.node.tryGetContext('dev') === 'true';

    // DynamoDB Table: SearchResults
    // Stores raw search results from each AI provider
    const searchResultsTable = new dynamodb.Table(this, 'SearchResultsTable', {
      tableName: 'CitationAnalysis-SearchResults',
      partitionKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp_provider',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: ProviderIndex - Query all results by provider
    searchResultsTable.addGlobalSecondaryIndex({
      indexName: 'ProviderIndex',
      partitionKey: {
        name: 'provider',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: Citations
    // Stores deduplicated citations with metadata
    const citationsTable = new dynamodb.Table(this, 'CitationsTable', {
      tableName: 'CitationAnalysis-Citations',
      partitionKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'normalized_url',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: CitationCountIndex - Query citations by popularity
    citationsTable.addGlobalSecondaryIndex({
      indexName: 'CitationCountIndex',
      partitionKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'citation_count',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: UrlIndex - Inverse index for "which keywords cite this URL?"
    //
    // The base table is keyed by (keyword, normalized_url) which makes the
    // forward lookup ("citations for keyword X") cheap, but the reverse
    // ("keywords that cite URL X") requires a full table scan. The
    // get-url-breakdown handler used to scan SearchResults up to 5000 items
    // to answer this. With this GSI, the same query is a bounded
    // ``Query(normalized_url=X)`` against deduplicated rows.
    //
    // Projection is ALL because the breakdown endpoint needs
    // citing_providers, citation_count, and last_updated alongside keyword.
    citationsTable.addGlobalSecondaryIndex({
      indexName: 'UrlIndex',
      partitionKey: {
        name: 'normalized_url',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: CrawledContent
    // Stores crawled page content and summaries
    const crawledContentTable = new dynamodb.Table(this, 'CrawledContentTable', {
      tableName: 'CitationAnalysis-CrawledContent',
      partitionKey: {
        name: 'normalized_url',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'crawled_at',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: KeywordIndex - Query all crawled content for a keyword
    crawledContentTable.addGlobalSecondaryIndex({
      indexName: 'KeywordIndex',
      partitionKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'crawled_at',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: Keywords
    // Stores user-managed keywords for searches
    const keywordsTable = new dynamodb.Table(this, 'KeywordsTable', {
      tableName: 'CitationAnalysis-Keywords',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: StatusIndex - Query keywords by status (active/inactive)
    // Enables efficient querying of active keywords without full table scan
    keywordsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'keyword',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: BrandConfig
    // Stores brand tracking configuration (industry, tracked brands, etc.)
    const brandConfigTable = new dynamodb.Table(this, 'BrandConfigTable', {
      tableName: 'CitationAnalysis-BrandConfig',
      partitionKey: {
        name: 'config_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: KeywordResearch
    // Stores keyword expansion and competitor analysis results
    const keywordResearchTable = new dynamodb.Table(this, 'KeywordResearchTable', {
      tableName: 'CitationAnalysis-KeywordResearch',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: ContentStudio
    // Stores generated content ideas and content
    const contentStudioTable = new dynamodb.Table(this, 'ContentStudioTable', {
      tableName: 'CitationAnalysis-ContentStudio',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: ProviderConfig
    // Stores AI provider enable/disable configuration
    const providerConfigTable = new dynamodb.Table(this, 'ProviderConfigTable', {
      tableName: 'CitationAnalysis-ProviderConfig',
      partitionKey: {
        name: 'provider_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: QueryPrompts
    // Stores user-defined query prompt templates with persona modifiers
    const queryPromptsTable = new dynamodb.Table(this, 'QueryPromptsTable', {
      tableName: 'CitationAnalysis-QueryPrompts',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying enabled prompts efficiently
    queryPromptsTable.addGlobalSecondaryIndex({
      indexName: 'EnabledIndex',
      partitionKey: {
        name: 'enabled',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: SelfReflection
    // Stores LLM self-reflection analysis results with 24-hour TTL caching
    const selfReflectionTable = new dynamodb.Table(this, 'SelfReflectionTable', {
      tableName: 'CitationAnalysis-SelfReflection',
      partitionKey: {
        name: 'keyword_brand',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'persona_timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // DynamoDB Table: RecommendationStatus
    // Tracks the action-tracking lifecycle (new -> in_progress -> done /
    // wontfix) for individual recommendations produced by
    // get-recommendations.py. The recommendations themselves aren't
    // persisted -- they're regenerated on every API call -- so this
    // table is the only durable record of which items have been worked
    // on. PK is a deterministic SHA-1 hash of the recommendation's
    // type + title + sorted keywords (see shared.utils.recommendation_id).
    // 90-day TTL evicts abandoned items so the table doesn't grow
    // unbounded for one-off recommendations that never get triaged.
    const recommendationStatusTable = new dynamodb.Table(this, 'RecommendationStatusTable', {
      tableName: 'CitationAnalysis-RecommendationStatus',
      partitionKey: {
        name: 'recommendation_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // ========================================
    // Secrets Manager - API Keys
    // ========================================

    // Import existing secrets (created via setup-secrets.sh script)
    // OpenAI API Key Secret
    const openaiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'OpenAISecret',
      'citation-analysis/openai-key'
    );

    // Perplexity API Key Secret (may not exist, handle gracefully)
    const perplexitySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'PerplexitySecret',
      'citation-analysis/perplexity-key'
    );

    // Gemini API Key Secret
    const geminiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GeminiSecret',
      'citation-analysis/gemini-key'
    );

    // Claude API Key Secret
    const claudeSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ClaudeSecret',
      'citation-analysis/claude-key'
    );

    // Search Provider API Key Secrets
    const braveSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'BraveSecret',
      'citation-analysis/brave-key'
    );

    const tavilySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TavilySecret',
      'citation-analysis/tavily-key'
    );

    const exaSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ExaSecret',
      'citation-analysis/exa-key'
    );

    const serpapiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'SerpAPISecret',
      'citation-analysis/serpapi-key'
    );

    const firecrawlSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'FirecrawlSecret',
      'citation-analysis/firecrawl-key'
    );

    // Nova Act API Key Secret (for intelligent browser navigation with verification handling)
    // Note: Not currently used by crawler code - kept for future use
    secretsmanager.Secret.fromSecretNameV2(
      this,
      'NovaActSecret',
      'citation-analysis/nova-act-key'
    );

    // ========================================
    // S3 Buckets
    // ========================================

    // Access Logs Bucket - stores S3 access logs for audit trail
    // Note: versioned=false is intentional for access logs (high volume, short retention)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `citation-analysis-access-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      versioned: false, // NOSONAR: Access logs are ephemeral, versioning adds unnecessary cost
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          enabled: true,
        },
      ],
    });

    // Keywords Bucket
    const keywordsBucket = new s3.Bucket(this, 'KeywordsBucket', {
      bucketName: `citation-analysis-keywords-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'keywords/',
    });

    // Screenshots Bucket
    const screenshotsBucket = new s3.Bucket(this, 'ScreenshotsBucket', {
      bucketName: `citation-analysis-screenshots-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'screenshots/',
      // Transition to Infrequent Access at 90 days — NOT expiration.
      //
      // This rule used to be `expiration: 90 days`, which silently deleted
      // every crawl screenshot older than a quarter. Screenshots are the only
      // evidence of what a cited page looked like at crawl time, and pages get
      // rewritten, so a deleted screenshot is not regenerable — re-crawling
      // captures today's page, not the one that was cited
      // (AUDIT-2026-08-19 §2.5).
      //
      // Screenshots are read when a citation is first reviewed and rarely
      // again, which is exactly the STANDARD_IA access pattern: same
      // durability and availability SLA, roughly 45% cheaper per GB, at the
      // cost of a per-GB retrieval fee on the infrequent reads. At the current
      // 3.3 GB / 2,055 objects that is small either way; the point is that it
      // stays small as the bucket grows without anything being destroyed.
      //
      // 90 days is kept from the previous rule deliberately: it is comfortably
      // past the 30-day minimum STANDARD_IA billing duration, so an object
      // transitioned here is never charged for storage it did not use.
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Raw Responses Bucket - stores full API responses from AI providers
    // Structure: raw-responses/{date}/{keyword}/{provider}/{timestamp}.json
    const rawResponsesBucket = new s3.Bucket(this, 'RawResponsesBucket', {
      bucketName: `citation-analysis-raw-responses-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'raw-responses/',
    });

    // ========================================
    // IAM Roles
    // ========================================

    // IAM Role for Search Lambda
    // Permissions: Read secrets, write to SearchResults table
    const searchLambdaRole = new iam.Role(this, 'SearchLambdaRole', {
      roleName: 'CitationAnalysis-SearchLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for Search Lambda to access Secrets Manager and DynamoDB',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant Search Lambda read access to all API key secrets
    openaiSecret.grantRead(searchLambdaRole);
    perplexitySecret.grantRead(searchLambdaRole);
    geminiSecret.grantRead(searchLambdaRole);
    claudeSecret.grantRead(searchLambdaRole);

    // Grant Search Lambda read access to search provider secrets
    braveSecret.grantRead(searchLambdaRole);
    tavilySecret.grantRead(searchLambdaRole);
    exaSecret.grantRead(searchLambdaRole);
    serpapiSecret.grantRead(searchLambdaRole);
    firecrawlSecret.grantRead(searchLambdaRole);

    // Grant Search Lambda write access to SearchResults table
    searchResultsTable.grantWriteData(searchLambdaRole);

    // Grant Search Lambda write access to Raw Responses bucket
    rawResponsesBucket.grantWrite(searchLambdaRole);

    // Grant Search Lambda read access to BrandConfig table
    brandConfigTable.grantReadData(searchLambdaRole);

    // Grant Search Lambda access to Bedrock for brand extraction
    // Uses global.anthropic.claude-* inference profiles with Converse API
    // Note: Converse API requires bedrock:InvokeModel permission (not bedrock:Converse)
    // Global cross-region inference requires three ARN patterns per AWS docs
    searchLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`, // Regional inference profile
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`, // Regional foundation model
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`, // Global foundation model (no region/account)
      ],
    }));

    // IAM Role for Deduplication Lambda
    // Permissions: Read/write to Citations table, read from SearchResults table
    const deduplicationLambdaRole = new iam.Role(this, 'DeduplicationLambdaRole', {
      roleName: 'CitationAnalysis-DeduplicationLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for Deduplication Lambda to access DynamoDB',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant Deduplication Lambda read access to SearchResults table
    searchResultsTable.grantReadData(deduplicationLambdaRole);

    // Grant Deduplication Lambda read/write access to Citations table
    citationsTable.grantReadWriteData(deduplicationLambdaRole);

    // IAM Role for Crawler Lambda
    // Permissions: Write to CrawledContent table, invoke Bedrock models
    const crawlerLambdaRole = new iam.Role(this, 'CrawlerLambdaRole', {
      roleName: 'CitationAnalysis-CrawlerLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for Crawler Lambda to access DynamoDB and Bedrock',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant Crawler Lambda write access to CrawledContent table
    crawledContentTable.grantWriteData(crawlerLambdaRole);

    // Grant Crawler Lambda read access to Citations table (to get citation metadata)
    citationsTable.grantReadData(crawlerLambdaRole);

    // Grant Crawler Lambda access to Bedrock for AgentCore and LLM summarization
    // Uses global.anthropic.claude-* inference profiles with Converse API
    // Note: Converse API requires bedrock:InvokeModel permission (not bedrock:Converse)
    // Global cross-region inference requires three ARN patterns per AWS docs
    crawlerLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`, // Regional inference profile
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`, // Regional foundation model
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`, // Global foundation model (no region/account)
      ],
    }));

    // Grant Crawler Lambda access to Bedrock AgentCore browser capabilities
    crawlerLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
      ],
      resources: ['*'], // AgentCore requires wildcard for browser sessions
    }));

    // Grant Crawler Lambda full access to Bedrock AgentCore for browser automation
    // Using wildcard actions due to undocumented WebSocket stream permissions
    crawlerLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:*'],
      resources: ['*'],
    }));

    // Grant Crawler Lambda write access to Screenshots bucket
    screenshotsBucket.grantWrite(crawlerLambdaRole);

    // IAM Role for Step Functions State Machine
    // Permissions: Invoke all Lambda functions
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsRole', {
      roleName: 'CitationAnalysis-StepFunctionsRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'Role for Step Functions to invoke Lambda functions',
    });

    // IAM Role for EventBridge Scheduler
    // Permissions: Start Step Functions executions
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: 'CitationAnalysis-SchedulerRole',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to start Step Functions executions',
    });

    // Grant Step Functions permission to invoke Lambda functions
    // Note: Specific Lambda ARNs will be added when Lambda functions are created
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction',
      ],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:CitationAnalysis-*`,
      ],
    }));

    // ========================================
    // Lambda Layer for Shared Code
    // ========================================

    // Create Lambda Layer with shared Python code and dependencies
    // Note: Run lambda/layer/build-layer.sh before deploying to build the layer locally
    const sharedLayerPath = path.join(__dirname, '../lambda/layer');
    const sharedLayerPythonPath = path.join(sharedLayerPath, 'python');
    if (!fs.existsSync(sharedLayerPythonPath) || fs.readdirSync(sharedLayerPythonPath).length === 0) {
      throw new LayerNotBuiltError(
        'Shared layer not built. Run: bash lambda/layer/build-layer.sh\n' +
        'Or use scripts/deploy.sh which builds all layers automatically.'
      );
    }
    assertLayerContainsAllSharedModules(path.join(sharedLayerPythonPath, 'shared'));
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: 'CitationAnalysis-SharedLayer',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/layer'), { exclude: PYTHON_ASSET_EXCLUDES }),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared Python code and dependencies for Citation Analysis Lambda functions',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================
    // Lambda Functions
    // ========================================

    // ParseKeywords Lambda Function
    const parseKeywordsLogGroup = new logs.LogGroup(this, 'ParseKeywordsLogGroup', {
      logGroupName: '/aws/lambda/CitationAnalysis-ParseKeywords',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const parseKeywordsFunction = new lambda.Function(this, 'ParseKeywordsFunction', {
      functionName: 'CitationAnalysis-ParseKeywords',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/parse-keywords'), { exclude: PYTHON_ASSET_EXCLUDES }),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Parse keywords from S3 or direct input',
      logGroup: parseKeywordsLogGroup,
      environment: {
        // Audit #12 canonical name + legacy for in-flight rollouts.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        KEYWORDS_TABLE: keywordsTable.tableName,
        // Enabled query prompts are resolved here for executions whose input
        // does not carry them (EventBridge schedules).
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
      },
    });

    // Grant ParseKeywords Lambda read access to keywords bucket and tables
    keywordsBucket.grantRead(parseKeywordsFunction);
    keywordsTable.grantReadData(parseKeywordsFunction);
    queryPromptsTable.grantReadData(parseKeywordsFunction);

    // Search Lambda Function
    const searchLogGroup = new logs.LogGroup(this, 'SearchLogGroup', {
      logGroupName: '/aws/lambda/CitationAnalysis-Search',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const searchFunction = new lambda.Function(this, 'SearchFunction', {
      functionName: 'CitationAnalysis-Search',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/search'), { exclude: PYTHON_ASSET_EXCLUDES }),
      role: searchLambdaRole,
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(900), // 15 min max — invoked by Step Functions, not API Gateway
      memorySize: 512,
      description: 'Query all AI providers with web search',
      logGroup: searchLogGroup,
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        // Canonical name (audit #12). Legacy PROVIDER_CONFIG_TABLE kept for
        // in-flight deploys; can be dropped after one full rollout.
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
        RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
        ...bedrockTierEnv,
      },
    });

    // Grant Search Lambda read access to ProviderConfig table
    providerConfigTable.grantReadData(searchLambdaRole);

    // Deduplication Lambda Function
    const deduplicationLogGroup = new logs.LogGroup(this, 'DeduplicationLogGroup', {
      logGroupName: '/aws/lambda/CitationAnalysis-Deduplication',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const deduplicationFunction = new lambda.Function(this, 'DeduplicationFunction', {
      functionName: 'CitationAnalysis-Deduplication',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/deduplication'), { exclude: PYTHON_ASSET_EXCLUDES }),
      role: deduplicationLambdaRole,
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Deduplicate and prioritize citations',
      logGroup: deduplicationLogGroup,
      environment: {
        // Canonical name (audit #12). Legacy CITATIONS_TABLE_NAME kept for
        // in-flight deploys; can be dropped after one full rollout.
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        CITATIONS_TABLE_NAME: citationsTable.tableName,
      },
    });

    // Crawler Lambda Layer - Browser tools (Playwright + AgentCore)
    // Separate from shared layer to keep each under 250MB limit
    // NOTE: Run scripts/deploy.sh or lambda/crawler-layer/build-layer.sh before cdk deploy
    const crawlerLayerPath = path.join(__dirname, '../lambda/crawler-layer');
    const crawlerLayerPythonPath = path.join(crawlerLayerPath, 'python');
    if (!fs.existsSync(crawlerLayerPythonPath) || fs.readdirSync(crawlerLayerPythonPath).length === 0) {
      throw new LayerNotBuiltError(
        'Crawler layer not built. Run: bash lambda/crawler-layer/build-layer.sh\n' +
        'Or use scripts/deploy.sh which builds all layers automatically.'
      );
    }
    const crawlerLayer = new lambda.LayerVersion(this, 'CrawlerLayer', {
      layerVersionName: 'CitationAnalysis-CrawlerLayer',
      code: lambda.Code.fromAsset(crawlerLayerPath, { exclude: PYTHON_ASSET_EXCLUDES }),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Browser automation tools (Playwright + AgentCore) for Crawler Lambda',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================
    // Pre-Created Custom Browser with Web Bot Auth
    // ========================================
    // Using a pre-created browser instead of creating dynamically per crawl:
    // - Faster crawls (skip browser creation overhead ~10s per crawl)
    // - Consistent signing identity for Web Bot Auth
    // - Lower API costs
    // - Centralized configuration in CDK

    // IAM Role for Browser Signing (required for Web Bot Auth)
    const browserSigningRole = new iam.Role(this, 'BrowserSigningRole', {
      roleName: 'CitationAnalysis-BrowserSigningRole',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Role for Bedrock AgentCore Browser signing (Web Bot Auth)',
    });

    // Grant the browser signing role permission to sign requests
    browserSigningRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:*',
      ],
      resources: ['*'],
    }));

    const crawlerBrowser = new bedrockagentcore.CfnBrowserCustom(this, 'CrawlerBrowser', {
      name: 'citation_analysis_crawler',
      description: 'Pre-configured browser for citation crawling with Web Bot Auth',
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      browserSigning: {
        enabled: true, // Enables Web Bot Auth to reduce CAPTCHAs
      },
      executionRoleArn: browserSigningRole.roleArn,
    });

    // Crawler Lambda Function - Uses ZIP deployment with crawler layer
    const crawlerLogGroup = new logs.LogGroup(this, 'CrawlerLogGroup', {
      logGroupName: '/aws/lambda/CitationAnalysis-Crawler',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const crawlerFunction = new lambda.Function(this, 'CrawlerFunction', {
      functionName: 'CitationAnalysis-Crawler',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/crawler'), { exclude: PYTHON_ASSET_EXCLUDES }),
      role: crawlerLambdaRole,
      layers: [crawlerLayer], // Crawler layer includes shared modules (copied during build)
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024, // Increased for browser automation
      description: 'Crawl cited pages using Bedrock AgentCore with screenshots and SEO analysis',
      logGroup: crawlerLogGroup,
      environment: {
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
        BROWSER_ID: crawlerBrowser.attrBrowserId, // Pre-created browser with Web Bot Auth
        ...bedrockTierEnv,
      },
    });

    // GenerateSummary Lambda Function
    const generateSummaryLogGroup = new logs.LogGroup(this, 'GenerateSummaryLogGroup', {
      logGroupName: '/aws/lambda/CitationAnalysis-GenerateSummary',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const generateSummaryFunction = new lambda.Function(this, 'GenerateSummaryFunction', {
      functionName: 'CitationAnalysis-GenerateSummary',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/generate-summary'), { exclude: PYTHON_ASSET_EXCLUDES }),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'Generate execution summary and statistics',
      logGroup: generateSummaryLogGroup,
    });

    // Grant GenerateSummary Lambda write access to keywords bucket (for storing summaries)
    keywordsBucket.grantWrite(generateSummaryFunction);

    // ========================================
    // Step Functions State Machine
    // ========================================

    // Define the workflow states

    // 1. ParseKeywords Task
    const parseKeywordsTask = new tasks.LambdaInvoke(this, 'ParseKeywords', {
      lambdaFunction: parseKeywordsFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // 2. SearchAllProviders Task
    const searchTask = new tasks.LambdaInvoke(this, 'SearchAllProviders', {
      lambdaFunction: searchFunction,
      payload: stepfunctions.TaskInput.fromObject({
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'query_prompts.$': '$.query_prompts',
      }),
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Add retry logic for Search Lambda
    // Note: API clients now have their own exponential backoff (5 retries each)
    // Step Functions retry is for Lambda-level failures only
    searchTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: cdk.Duration.seconds(10),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // 3. DeduplicateCitations Task
    const deduplicationTask = new tasks.LambdaInvoke(this, 'DeduplicateCitations', {
      lambdaFunction: deduplicationFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // 4. CrawlSingleCitation Task
    const crawlTask = new tasks.LambdaInvoke(this, 'CrawlSingleCitation', {
      lambdaFunction: crawlerFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Add retry logic for Crawler Lambda
    crawlTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: cdk.Duration.seconds(5),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // Add error handling for crawler failures
    const crawlFailed = new stepfunctions.Pass(this, 'CrawlFailed', {result: stepfunctions.Result.fromObject({ status: 'failed' }),});

    crawlTask.addCatch(crawlFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // 5. CrawlCitations Map State (parallel crawling with concurrency limit)
    const crawlCitationsMap = new stepfunctions.Map(this, 'CrawlCitations', {
      maxConcurrency: 3,
      itemsPath: '$.deduplicated_citations',
      resultPath: '$.crawled_results',
      itemSelector: {
        'citation.$': '$$.Map.Item.Value',
        'keyword.$': '$.keyword',
      },
    }).itemProcessor(crawlTask);

    // 6. Chain Search -> Deduplication -> Crawl
    const processKeywordChain = searchTask
      .next(deduplicationTask)
      .next(crawlCitationsMap);

    // 7. ProcessKeywords Map State (parallel keyword processing)
    const processKeywordsMap = new stepfunctions.Map(this, 'ProcessKeywords', {
      maxConcurrency: 3, // Reduced from 5 to 3 to avoid API rate limits
      itemsPath: '$.keywords',
      resultPath: '$.keyword_results',
      itemSelector: {
        'keyword.$': '$$.Map.Item.Value.keyword',
        'timestamp.$': '$$.Map.Item.Value.timestamp',
        // query_prompts comes from the ParseKeywords output (this state's
        // input), NOT the raw execution input: scheduled runs don't carry
        // prompts in their input, so ParseKeywords resolves them and always
        // emits the key. Referencing $$.Execution.Input.query_prompts here
        // would raise States.Runtime for scheduled executions.
        'query_prompts.$': '$.query_prompts',
      },
    }).itemProcessor(processKeywordChain);

    // 8. GenerateSummary Task
    const generateSummaryTask = new tasks.LambdaInvoke(this, 'GenerateSummary', {
      lambdaFunction: generateSummaryFunction,
      payload: stepfunctions.TaskInput.fromObject({
        'execution_id.$': '$$.Execution.Name',
        'keyword_results.$': '$.keyword_results',
        'summary_bucket': keywordsBucket.bucketName,
      }),
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // 9. Define the complete workflow
    const definition = parseKeywordsTask
      .next(processKeywordsMap)
      .next(generateSummaryTask);

    // 10. Create the State Machine

    // Execution history log group for the workflow.
    //
    // This is a NEW group, unlike the Lambda ones above: the state machine ran
    // with `level: OFF` so nothing was ever written and there is no existing
    // group to collide with. Hence `DESTROY`, matching the workers.
    //
    // `/aws/vendedlogs/states/` is the documented prefix, not cosmetic.
    // Services that deliver logs on your behalf have to name each destination
    // group in a CloudWatch Logs resource policy, and those policies cap at
    // 5120 characters; the vendedlogs prefix is covered by a wildcard instead
    // of consuming budget per group. Exceeding the cap fails as an opaque
    // policy-length error at the moment logging is enabled, so the prefix is
    // worth keeping even though only one group needs it today.
    const stateMachineLogGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      logGroupName: '/aws/vendedlogs/states/CitationAnalysis-Workflow',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const stateMachine = new stepfunctions.StateMachine(this, 'CitationAnalysisStateMachine', {
      stateMachineName: 'CitationAnalysis-Workflow',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      role: stepFunctionsRole,
      timeout: cdk.Duration.hours(2),
      tracingEnabled: true,
      // Logging was `level: OFF` with `includeExecutionData: false`, so a
      // failed execution left nothing behind to debug: X-Ray tracing shows
      // that a state failed and how long it took, never the payload that
      // caused it. With ProcessKeywords and CrawlCitations both being Maps,
      // "which item failed, and on what input" is the only question worth
      // asking after a failed run — and it was the one question this
      // configuration could not answer (AUDIT-2026-08-19 §2.8).
      //
      // ALL rather than ERROR: on a Map, the interesting evidence is the
      // per-iteration state entry/exit either side of the failure, not just
      // the terminal error. The ingestion cost of that for a workflow that
      // runs on a schedule, capped at 30 days, is a rounding error next to the
      // Bedrock spend it orchestrates.
      //
      // `includeExecutionData` is what actually puts the failing item's input
      // in the log; without it this is only marginally better than OFF. It
      // does mean keyword and citation payloads land in CloudWatch, which is
      // why the group above expires them at 30 days.
      //
      // No explicit grant needed: CDK attaches the logs:*LogDelivery /
      // PutResourcePolicy statements to `stepFunctionsRole` when `logs` is
      // set. Do not add them by hand — they will just be duplicated.
      logs: {
        destination: stateMachineLogGroup,
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // ========================================
    // Outputs
    // ========================================

    // Export table names for use by Lambda functions
    new cdk.CfnOutput(this, 'SearchResultsTableName', {
      value: searchResultsTable.tableName,
      description: 'DynamoDB table for search results',
      exportName: 'CitationAnalysis-SearchResultsTableName',
    });

    new cdk.CfnOutput(this, 'CitationsTableName', {
      value: citationsTable.tableName,
      description: 'DynamoDB table for deduplicated citations',
      exportName: 'CitationAnalysis-CitationsTableName',
    });

    new cdk.CfnOutput(this, 'CrawledContentTableName', {
      value: crawledContentTable.tableName,
      description: 'DynamoDB table for crawled content',
      exportName: 'CitationAnalysis-CrawledContentTableName',
    });

    new cdk.CfnOutput(this, 'QueryPromptsTableName', {
      value: queryPromptsTable.tableName,
      description: 'DynamoDB table for query prompt templates',
      exportName: 'CitationAnalysis-QueryPromptsTableName',
    });

    // Export secret ARNs
    new cdk.CfnOutput(this, 'OpenAISecretArn', {
      value: openaiSecret.secretArn,
      description: 'ARN of OpenAI API key secret',
      exportName: 'CitationAnalysis-OpenAISecretArn',
    });

    new cdk.CfnOutput(this, 'PerplexitySecretArn', {
      value: perplexitySecret.secretArn,
      description: 'ARN of Perplexity API key secret',
      exportName: 'CitationAnalysis-PerplexitySecretArn',
    });

    new cdk.CfnOutput(this, 'GeminiSecretArn', {
      value: geminiSecret.secretArn,
      description: 'ARN of Gemini API key secret',
      exportName: 'CitationAnalysis-GeminiSecretArn',
    });

    new cdk.CfnOutput(this, 'ClaudeSecretArn', {
      value: claudeSecret.secretArn,
      description: 'ARN of Claude API key secret',
      exportName: 'CitationAnalysis-ClaudeSecretArn',
    });

    // Export IAM role ARNs
    new cdk.CfnOutput(this, 'SearchLambdaRoleArn', {
      value: searchLambdaRole.roleArn,
      description: 'ARN of Search Lambda IAM role',
      exportName: 'CitationAnalysis-SearchLambdaRoleArn',
    });

    new cdk.CfnOutput(this, 'DeduplicationLambdaRoleArn', {
      value: deduplicationLambdaRole.roleArn,
      description: 'ARN of Deduplication Lambda IAM role',
      exportName: 'CitationAnalysis-DeduplicationLambdaRoleArn',
    });

    new cdk.CfnOutput(this, 'CrawlerLambdaRoleArn', {
      value: crawlerLambdaRole.roleArn,
      description: 'ARN of Crawler Lambda IAM role',
      exportName: 'CitationAnalysis-CrawlerLambdaRoleArn',
    });

    new cdk.CfnOutput(this, 'StepFunctionsRoleArn', {
      value: stepFunctionsRole.roleArn,
      description: 'ARN of Step Functions IAM role',
      exportName: 'CitationAnalysis-StepFunctionsRoleArn',
    });

    // Export Lambda Layer ARN
    new cdk.CfnOutput(this, 'SharedLayerArn', {
      value: sharedLayer.layerVersionArn,
      description: 'ARN of shared Lambda Layer',
      exportName: 'CitationAnalysis-SharedLayerArn',
    });

    new cdk.CfnOutput(this, 'CrawlerLayerArn', {
      value: crawlerLayer.layerVersionArn,
      description: 'ARN of Crawler Lambda Layer (browser tools)',
      exportName: 'CitationAnalysis-CrawlerLayerArn',
    });

    // Export S3 bucket names
    new cdk.CfnOutput(this, 'KeywordsBucketName', {
      value: keywordsBucket.bucketName,
      description: 'S3 bucket for keywords files',
      exportName: 'CitationAnalysis-KeywordsBucketName',
    });

    new cdk.CfnOutput(this, 'ScreenshotsBucketName', {
      value: screenshotsBucket.bucketName,
      description: 'S3 bucket for page screenshots',
      exportName: 'CitationAnalysis-ScreenshotsBucketName',
    });

    new cdk.CfnOutput(this, 'RawResponsesBucketName', {
      value: rawResponsesBucket.bucketName,
      description: 'S3 bucket for raw API responses',
      exportName: 'CitationAnalysis-RawResponsesBucketName',
    });

    // Export Lambda function ARNs
    new cdk.CfnOutput(this, 'ParseKeywordsFunctionArn', {
      value: parseKeywordsFunction.functionArn,
      description: 'ARN of ParseKeywords Lambda function',
      exportName: 'CitationAnalysis-ParseKeywordsFunctionArn',
    });

    new cdk.CfnOutput(this, 'SearchFunctionArn', {
      value: searchFunction.functionArn,
      description: 'ARN of Search Lambda function',
      exportName: 'CitationAnalysis-SearchFunctionArn',
    });

    new cdk.CfnOutput(this, 'DeduplicationFunctionArn', {
      value: deduplicationFunction.functionArn,
      description: 'ARN of Deduplication Lambda function',
      exportName: 'CitationAnalysis-DeduplicationFunctionArn',
    });

    new cdk.CfnOutput(this, 'CrawlerFunctionArn', {
      value: crawlerFunction.functionArn,
      description: 'ARN of Crawler Lambda function',
      exportName: 'CitationAnalysis-CrawlerFunctionArn',
    });

    new cdk.CfnOutput(this, 'GenerateSummaryFunctionArn', {
      value: generateSummaryFunction.functionArn,
      description: 'ARN of GenerateSummary Lambda function',
      exportName: 'CitationAnalysis-GenerateSummaryFunctionArn',
    });

    // Export Step Functions state machine ARN
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'ARN of Step Functions state machine',
      exportName: 'CitationAnalysis-StateMachineArn',
    });

    // ========================================
    // Visualization Dashboard - API Gateway + Lambda
    // ========================================

    // API Lambda Functions
    
    // Health Check Lambda - No authentication required
    const healthCheckFunction = new lambda.Function(this, 'HealthCheckFunction', {
      functionName: 'CitationAnalysis-API-Health',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'health.handler',
      code: createApiLambdaCode('health.py'),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      description: 'API: Health check endpoint for monitoring',
      logGroup: apiLambdaLogGroup(this, 'HealthCheckLogGroup', 'CitationAnalysis-API-Health'),
    });
    

    // Consolidated Stats & Insights Lambda
    // Replaces 6 individual Lambdas: get-stats, get-visibility-metrics, get-prompt-insights,
    // get-citation-gaps, get-recommendations, get-historical-trends
    // Routes requests based on API Gateway resource path
    const statsInsightsFunction = new lambda.Function(this, 'StatsInsightsFunction', {
      functionName: 'CitationAnalysis-API-StatsInsights',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'stats-insights.handler',
      code: createConsolidatedApiLambdaCode([
        'stats-insights.py',
        'get-stats.py',
        'get-visibility-metrics.py',
        'get-prompt-insights.py',
        'get-citation-gaps.py',
        'get-recommendations.py',
        'get-historical-trends.py',
        'get-reports-overview.py',
        'recommendation-status.py',
        'get-reports-competitor.py',
      ]),
      layers: [sharedLayer],
      // Every route here is read-only bar a millisecond-scale put_item on
      // POST /recommendations/{id}/status, and recommendations are regenerated
      // per call rather than persisted — so nothing is lost by capping at the
      // gateway ceiling. The slow routes (/reports/competitor, /stats) already
      // 504 at 29s; the extra 31s only ever burned compute.
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 512,
      description: 'API: Consolidated stats, visibility, insights, gaps, recommendations, and trends',
      logGroup: apiLambdaLogGroup(this, 'StatsInsightsLogGroup', 'CitationAnalysis-API-StatsInsights'),
      environment: {
        // Audit #12: canonical DYNAMODB_TABLE_* names. Legacy names kept
        // for in-flight deploys; can be dropped after one full rollout.
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        // Legacy names (to be removed once rollout is verified):
        SEARCH_RESULTS_TABLE: searchResultsTable.tableName,
        CITATIONS_TABLE: citationsTable.tableName,
        CRAWLED_CONTENT_TABLE: crawledContentTable.tableName,
        KEYWORDS_TABLE: keywordsTable.tableName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
        ...bedrockTierEnv,
        // recommendation status (read for left-join, write for the
        // POST /recommendations/{id}/status route)
        RECOMMENDATION_STATUS_TABLE: recommendationStatusTable.tableName,
      },
    });

    // Consolidated Citations & Content Lambda
    // Replaces 5 individual Lambdas: get-citations, get-url-breakdown, get-searches,
    // get-crawled-content, browse-raw-responses
    const citationsContentFunction = new lambda.Function(this, 'CitationsContentFunction', {
      functionName: 'CitationAnalysis-API-CitationsContent',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'citations-content.handler',
      code: createConsolidatedApiLambdaCode([
        'citations-content.py',
        'get-citations.py',
        'get-url-breakdown.py',
        'get-searches.py',
        'get-crawled-content.py',
        'browse-raw-responses.py',
      ]),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Consolidated citations, URL breakdown, searches, crawled content, and raw responses',
      logGroup: apiLambdaLogGroup(this, 'CitationsContentLogGroup', 'CitationAnalysis-API-CitationsContent'),
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        // Legacy names, dropped once rollout verified.
        CITATIONS_TABLE: citationsTable.tableName,
        SEARCH_RESULTS_TABLE: searchResultsTable.tableName,
        CRAWLED_CONTENT_TABLE: crawledContentTable.tableName,
        RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
      },
    });


    const getBrandMentionsFunction = new lambda.Function(this, 'GetBrandMentionsFunction', {
      functionName: 'CitationAnalysis-API-GetBrandMentions',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-brand-mentions.handler',
      code: createApiLambdaCode('get-brand-mentions.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Get brand mentions from search results',
      logGroup: apiLambdaLogGroup(this, 'GetBrandMentionsLogGroup', 'CitationAnalysis-API-GetBrandMentions'),
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
      },
    });

    const manageBrandConfigFunction = new lambda.Function(this, 'ManageBrandConfigFunction', {
      functionName: 'CitationAnalysis-API-ManageBrandConfig',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-brand-config.handler',
      code: createApiLambdaCode('manage-brand-config.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Manage brand tracking configuration',
      logGroup: apiLambdaLogGroup(this, 'ManageBrandConfigLogGroup', 'CitationAnalysis-API-ManageBrandConfig'),
      environment: {DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName, ...bedrockTierEnv},
    });

    // Consolidated Keyword Management Lambda (get-keywords + manage-keywords + keyword-research)
    const keywordMgmtFunction = new lambda.Function(this, 'KeywordMgmtFunction', {
      functionName: 'CitationAnalysis-API-KeywordMgmt',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'keyword-mgmt.handler',
      code: createConsolidatedApiLambdaCode([
        'keyword-mgmt.py',
        'get-keywords.py',
        'manage-keywords.py',
        'keyword-research.py',
        'promote-keywords.py',
      ]),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(120),
      memorySize: 256,
      // Self-invokes for async keyword research — see the constant's comment.
      reservedConcurrentExecutions: SELF_INVOKING_FUNCTION_CONCURRENCY,
      description: 'API: Consolidated keyword get/create/update/delete and keyword research',
      logGroup: apiLambdaLogGroup(this, 'KeywordMgmtLogGroup', 'CitationAnalysis-API-KeywordMgmt'),
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_KEYWORD_RESEARCH: keywordResearchTable.tableName,
        // Legacy names, dropped once rollout verified.
        KEYWORDS_TABLE: keywordsTable.tableName,
        KEYWORD_RESEARCH_TABLE: keywordResearchTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });

    // Consolidated Config Management Lambda (query-prompts + schedules + providers)
    const configMgmtFunction = new lambda.Function(this, 'ConfigMgmtFunction', {
      functionName: 'CitationAnalysis-API-ConfigMgmt',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'config-mgmt.handler',
      code: createConsolidatedApiLambdaCode([
        'config-mgmt.py',
        'manage-query-prompts.py',
        'manage-schedule.py',
        'manage-providers.py',
      ]),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Consolidated query prompts, schedules, and provider config',
      logGroup: apiLambdaLogGroup(this, 'ConfigMgmtLogGroup', 'CitationAnalysis-API-ConfigMgmt'),
      environment: {
        // Audit #12 canonical names.
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        DYNAMODB_TABLE_PROVIDER_CONFIG: providerConfigTable.tableName,
        // Legacy names, dropped once rollout verified.
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        SCHEDULE_ROLE_ARN: schedulerRole.roleArn,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });

    // Consolidated Execution Management Lambda (trigger-analysis + trigger-keyword-analysis + get-execution-status)
    const executionMgmtFunction = new lambda.Function(this, 'ExecutionMgmtFunction', {
      functionName: 'CitationAnalysis-API-ExecutionMgmt',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'execution-mgmt.handler',
      code: createConsolidatedApiLambdaCode([
        'execution-mgmt.py',
        'trigger-analysis.py',
        'trigger-keyword-analysis.py',
        'get-execution-status.py',
      ]),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Consolidated trigger analysis and execution status',
      logGroup: apiLambdaLogGroup(this, 'ExecutionMgmtLogGroup', 'CitationAnalysis-API-ExecutionMgmt'),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        // Audit #12 canonical names.
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_QUERY_PROMPTS: queryPromptsTable.tableName,
        // Legacy names, dropped once rollout verified.
        KEYWORDS_TABLE: keywordsTable.tableName,
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
      },
    });

    // Grant consolidated stats-insights function access to all required tables
    searchResultsTable.grantReadData(statsInsightsFunction);
    citationsTable.grantReadData(statsInsightsFunction);
    crawledContentTable.grantReadData(statsInsightsFunction);
    keywordsTable.grantReadData(statsInsightsFunction);
    brandConfigTable.grantReadData(statsInsightsFunction);
    providerConfigTable.grantReadData(statsInsightsFunction);
    // The same Lambda serves both GET /recommendations (read-only join)
    // and POST /recommendations/{id}/status (write upsert), so it
    // needs read-write on the status table.
    recommendationStatusTable.grantReadWriteData(statsInsightsFunction);
    // Grant Bedrock access for LLM-enhanced recommendations (get-recommendations.py)
    statsInsightsFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`,
      ],
    }));
    // Grant consolidated citations-content function access to all required tables and buckets
    citationsTable.grantReadData(citationsContentFunction);
    searchResultsTable.grantReadData(citationsContentFunction);
    brandConfigTable.grantReadData(citationsContentFunction);
    crawledContentTable.grantReadData(citationsContentFunction);
    screenshotsBucket.grantRead(citationsContentFunction);
    rawResponsesBucket.grantRead(citationsContentFunction);

    // Grant keyword management function access
    keywordsTable.grantReadWriteData(keywordMgmtFunction);
    keywordResearchTable.grantReadWriteData(keywordMgmtFunction);
    perplexitySecret.grantRead(keywordMgmtFunction);
    openaiSecret.grantRead(keywordMgmtFunction);
    geminiSecret.grantRead(keywordMgmtFunction);
    keywordMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:CitationAnalysis-API-KeywordMgmt`],
    }));

    // Grant config management function access
    queryPromptsTable.grantReadWriteData(configMgmtFunction);
    providerConfigTable.grantReadWriteData(configMgmtFunction);
    openaiSecret.grantRead(configMgmtFunction);
    openaiSecret.grantWrite(configMgmtFunction);
    perplexitySecret.grantRead(configMgmtFunction);
    perplexitySecret.grantWrite(configMgmtFunction);
    geminiSecret.grantRead(configMgmtFunction);
    geminiSecret.grantWrite(configMgmtFunction);
    claudeSecret.grantRead(configMgmtFunction);
    claudeSecret.grantWrite(configMgmtFunction);
    configMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:citation-analysis/*`],
    }));
    configMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:CreateSchedule', 'scheduler:GetSchedule', 'scheduler:DeleteSchedule', 'scheduler:UpdateSchedule'],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/citation-analysis-schedules/*`],
    }));
    configMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:ListSchedules'],
      resources: ['*'],
    }));
    configMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:CreateScheduleGroup', 'scheduler:GetScheduleGroup'],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule-group/citation-analysis-schedules`],
    }));
    configMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));

    // Grant execution management function access
    keywordsTable.grantReadData(executionMgmtFunction);
    queryPromptsTable.grantReadData(executionMgmtFunction);
    executionMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:StartExecution'],
      resources: [stateMachine.stateMachineArn],
    }));
    executionMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:DescribeExecution', 'states:GetExecutionHistory'],
      resources: [`arn:aws:states:${this.region}:${this.account}:execution:CitationAnalysis-Workflow:*`],
    }));
    executionMgmtFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:ListExecutions'],
      resources: [stateMachine.stateMachineArn],
    }));

    searchResultsTable.grantReadData(getBrandMentionsFunction);
    brandConfigTable.grantReadData(getBrandMentionsFunction);

    // ========================================
    // Persona Rankings API
    // ========================================

    const getPersonaRankingsFunction = new lambda.Function(this, 'GetPersonaRankingsFunction', {
      functionName: 'CitationAnalysis-API-GetPersonaRankings',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-persona-rankings.handler',
      code: createApiLambdaCode('get-persona-rankings.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Get per-persona brand ranking breakdowns',
      logGroup: apiLambdaLogGroup(this, 'GetPersonaRankingsLogGroup', 'CitationAnalysis-API-GetPersonaRankings'),
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getPersonaRankingsFunction);
    queryPromptsTable.grantReadData(getPersonaRankingsFunction);

    // ========================================
    // Self-Reflection API
    // ========================================

    const selfReflectionFunction = new lambda.Function(this, 'SelfReflectionFunction', {
      functionName: 'CitationAnalysis-API-SelfReflection',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'self-reflection.handler',
      code: createApiLambdaCode('self-reflection.py'),
      layers: [sharedLayer],
      // Deliberately ABOVE the 29s gateway ceiling — do not "fix" this to 29.
      //
      // `post_self_reflection` calls Bedrock synchronously and then persists
      // the result as its very last step, and that row is what the 24h
      // `check_cache` reads. So a slow request today degrades gracefully: the
      // client sees a 504 at 29s, the function runs on, writes the row, and
      // the next request returns it from cache immediately.
      //
      // Capping at 29s would put the SIGKILL before that write every time:
      // Bedrock billed, nothing stored, and because only a completed run
      // populates the cache, a slow keyword/brand pair would be broken
      // permanently rather than intermittently (AUDIT-2026-08-19 §2.9).
      //
      // Making this async like Content Studio is the real fix; until then the
      // 60s is load-bearing.
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'API: LLM self-reflection analysis for brand rankings',
      logGroup: apiLambdaLogGroup(this, 'SelfReflectionLogGroup', 'CitationAnalysis-API-SelfReflection'),
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_SELF_REFLECTION: selfReflectionTable.tableName,
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
        // DEAD CONFIG: `shared/models.py` reads BEDROCK_MODEL_<ROLE> and
        // BEDROCK_TIER_<ROLE>, never BEDROCK_MODEL_ID. This function also does
        // not spread `bedrockTierEnv`, so ModelRole.ANALYSIS falls through to
        // its hardcoded BALANCED default: Sonnet 4.6 with a 2000-token
        // extended-thinking budget, NOT the Haiku named here. That is the root
        // cause of the latency this function's 60s timeout accommodates.
        // Left in place because switching to Haiku changes analysis quality
        // and cost — a product decision, not a cleanup.
        BEDROCK_MODEL_ID: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      },
    });
    searchResultsTable.grantReadData(selfReflectionFunction);
    brandConfigTable.grantReadData(selfReflectionFunction);
    queryPromptsTable.grantReadData(selfReflectionFunction);
    selfReflectionTable.grantReadWriteData(selfReflectionFunction);
    selfReflectionFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`,
      ],
    }));

    brandConfigTable.grantReadWriteData(manageBrandConfigFunction);
    
    // Grant Bedrock access for brand expansion feature
    // Uses global.anthropic.claude-* inference profiles with Converse API
    // Note: Converse API requires bedrock:InvokeModel permission (not bedrock:Converse)
    // Global cross-region inference requires three ARN patterns per AWS docs
    manageBrandConfigFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`, // Regional inference profile
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*', // Regional foundation model
        'arn:aws:bedrock:::foundation-model/anthropic.claude-*', // Global foundation model (no region/account)
      ],
    }));
    


    // Grant scheduler role permission to start executions
    stateMachine.grantStartExecution(schedulerRole);

    // ========================================
    // WAF Web ACL for API Gateway — REMOVED 2026-08-19
    // ========================================
    //
    // `CitationAnalysis-API-WAF` (REGIONAL, logical id `ApiWaf`) used to be
    // created here with four rules — the two AWS managed sets, SQLi, and a
    // 1000-per-5-min rate limit — and was never associated with anything. The
    // association below it had been commented out since it was written, and
    // `list-resources-for-web-acl` confirmed the empty set: it inspected zero
    // requests while billing for the ACL plus every rule group, every month
    // (AUDIT-2026-08-19 §2.1).
    //
    // Attaching it was the other option and was rejected: the rules it carried
    // target injection and volumetric attacks against a public surface, and
    // this API has no anonymous surface to speak of.
    //
    // What protects the API now:
    //   - the Cognito authorizer, on every route except GET /api/health
    //   - the stage throttle, 100 rps sustained / 200 burst
    //   - per-request origin validation and input validation in the handlers
    //
    // The CloudFront Web ACL is a DIFFERENT resource, further down, created in
    // us-east-1 via custom resource. It IS attached to the distribution and
    // must stay.

    // Create REST API Gateway
    // Note: Auth construct created early, callback URLs updated after CloudFront distribution
    const auth = new Auth(this, 'Auth', {urls: ['http://localhost:5173'], // Temporary - updated below after CloudFront creation
    });

    const api = new apigateway.RestApi(this, 'CitationAnalysisAPI', {
      restApiName: 'CitationAnalysis-API',
      description: 'API for Citation Analysis Dashboard - v2',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        // Per-method CloudWatch metrics (Count, 4XXError, 5XXError, Latency,
        // IntegrationLatency) for every route on the stage.
        //
        // Without this the account had aggregate stage metrics only, so
        // "the API is throwing 5XXs" could never be narrowed to *which*
        // endpoint, and a per-endpoint alarm was not expressible at all —
        // there was no metric to alarm on (AUDIT-2026-08-19 §2.6).
        metricsEnabled: true,
        // dataTraceEnabled is deliberately LEFT OFF. Do not turn it on
        // alongside metricsEnabled — they look like a pair and are not.
        //
        // It logs full request and response bodies to CloudWatch, which here
        // means Cognito-authenticated user payloads, brand configuration, and
        // whole LLM responses. That is a privacy exposure with no retention
        // story and a log-ingestion bill proportional to response size, in
        // exchange for detail that X-Ray and the functions' own structured
        // logging already provide. Enable it temporarily on a single
        // reproduction if you must, then turn it back off.
        dataTraceEnabled: false,
      },
      // CORS preflight: API Gateway handles OPTIONS with wildcard origins.
      // Actual CORS enforcement happens at Lambda level via SSM parameter containing CloudFront domain.
      // This two-layer approach is required because CloudFront is created after API Gateway.
      // Lambda functions read /citation-analysis/cors-origin from SSM and validate request origin.
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
        allowCredentials: false, // Must be false with wildcard origins
      },
    });

    // Add Gateway Responses to include CORS headers in error responses
    // This fixes the CORS issue when Cognito authorization fails (401/403)
    // NOTE: Gateway response CORS origins are set after CloudFront distribution
    // is created (see "Configure CORS with CloudFront Domain" section below)
    // to use the actual CloudFront domain instead of wildcard '*'.

    // Add Usage Plan for API throttling and quota management
    const usagePlan = api.addUsagePlan('CitationAnalysisUsagePlan', {
      name: 'CitationAnalysis-UsagePlan',
      description: 'Usage plan for Citation Analysis API with rate limiting',
      throttle: {
        rateLimit: 100,  // Requests per second
        burstLimit: 200, // Burst capacity
      },
      quota: {
        limit: 10000,    // 10,000 requests per day
        period: apigateway.Period.DAY,
      },
    });

    // Associate usage plan with API stage
    usagePlan.addApiStage({stage: api.deploymentStage,});

    // API Resources and Methods
    const apiResource = api.root.addResource('api');
    
    // Create Cognito User Pool Authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [auth.userPool],
      authorizerName: 'CitationAnalysis-CognitoAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });
    
    // Common integration options with CORS headers
    const integrationOptions: apigateway.LambdaIntegrationOptions = {proxy: true,};
    
    // Common method options with Cognito authorization
    const methodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    
    const statsResource = apiResource.addResource('stats');
    statsResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    // Health check endpoint - No authentication required
    // NOSONAR: Health check must be public for load balancer/monitoring probes
    const healthResource = apiResource.addResource('health');
    healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthCheckFunction, integrationOptions), {
      authorizationType: apigateway.AuthorizationType.NONE, // NOSONAR
    });

    const citationsResource = apiResource.addResource('citations');
    citationsResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);

    const urlBreakdownResource = apiResource.addResource('url-breakdown');
    urlBreakdownResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);

    const searchesResource = apiResource.addResource('searches');
    searchesResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);

    const keywordsResource = apiResource.addResource('keywords');
    keywordsResource.addMethod('GET', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    keywordsResource.addMethod('POST', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    
    // Static 'promote' segment is matched ahead of the '{id}' path parameter by API Gateway,
    // and it is POST-only while '{id}' is PUT/DELETE-only, so the two do not conflict.
    const keywordsPromoteResource = keywordsResource.addResource('promote');
    keywordsPromoteResource.addMethod('POST', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);

    const keywordIdResource = keywordsResource.addResource('{id}');
    keywordIdResource.addMethod('PUT', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    keywordIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);

    const queryPromptsResource = apiResource.addResource('query-prompts');
    queryPromptsResource.addMethod('GET', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    queryPromptsResource.addMethod('POST', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);

    const queryPromptIdResource = queryPromptsResource.addResource('{id}');
    queryPromptIdResource.addMethod('PUT', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    queryPromptIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    queryPromptIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);

    const brandMentionsResource = apiResource.addResource('brand-mentions');
    brandMentionsResource.addMethod('GET', new apigateway.LambdaIntegration(getBrandMentionsFunction, integrationOptions), methodOptions);

    const brandConfigResource = apiResource.addResource('brand-config');
    brandConfigResource.addMethod('GET', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);
    brandConfigResource.addMethod('POST', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);
    brandConfigResource.addMethod('PUT', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);
    brandConfigResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);
    
    const brandConfigPresetsResource = brandConfigResource.addResource('presets');
    brandConfigPresetsResource.addMethod('GET', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);

    const brandConfigExpandResource = brandConfigResource.addResource('expand');
    brandConfigExpandResource.addMethod('POST', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);

    const brandConfigExpandAllResource = brandConfigResource.addResource('expand-all');
    brandConfigExpandAllResource.addMethod('POST', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);

    const brandConfigFindCompetitorsResource = brandConfigResource.addResource('find-competitors');
    brandConfigFindCompetitorsResource.addMethod('POST', new apigateway.LambdaIntegration(manageBrandConfigFunction, integrationOptions), methodOptions);

    const crawledContentResource = apiResource.addResource('crawled-content');
    crawledContentResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);

    const triggerResource = apiResource.addResource('trigger-analysis');
    triggerResource.addMethod('POST', new apigateway.LambdaIntegration(executionMgmtFunction, integrationOptions), methodOptions);

    const triggerKeywordResource = apiResource.addResource('trigger-keyword-analysis');
    triggerKeywordResource.addMethod('POST', new apigateway.LambdaIntegration(executionMgmtFunction, integrationOptions), methodOptions);

    const executionsResource = apiResource.addResource('executions');
    const executionIdResource = executionsResource.addResource('{id}');
    executionIdResource.addMethod('GET', new apigateway.LambdaIntegration(executionMgmtFunction, integrationOptions), methodOptions);

    const schedulesResource = apiResource.addResource('schedules');
    schedulesResource.addMethod('GET', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    schedulesResource.addMethod('POST', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    
    const scheduleNameResource = schedulesResource.addResource('{name}');
    scheduleNameResource.addMethod('DELETE', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);

    // Raw Responses Browser API
    const rawResponsesResource = apiResource.addResource('raw-responses');
    const rawResponsesBrowseResource = rawResponsesResource.addResource('browse');
    rawResponsesBrowseResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);
    
    const rawResponsesFileResource = rawResponsesResource.addResource('file');
    rawResponsesFileResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);
    
    const rawResponsesDownloadResource = rawResponsesResource.addResource('download');
    rawResponsesDownloadResource.addMethod('GET', new apigateway.LambdaIntegration(citationsContentFunction, integrationOptions), methodOptions);

    // Keyword Research API
    const keywordResearchResource = apiResource.addResource('keyword-research');
    const keywordResearchExpandResource = keywordResearchResource.addResource('expand');
    keywordResearchExpandResource.addMethod('POST', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    
    const keywordResearchCompetitorResource = keywordResearchResource.addResource('competitor');
    keywordResearchCompetitorResource.addMethod('POST', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    
    const keywordResearchHistoryResource = keywordResearchResource.addResource('history');
    keywordResearchHistoryResource.addMethod('GET', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);
    
    const keywordResearchIdResource = keywordResearchResource.addResource('{id}');
    keywordResearchIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(keywordMgmtFunction, integrationOptions), methodOptions);

    // ========================================
    // Visibility & Insights API Routes
    // (Handled by consolidated StatsInsightsFunction)
    // ========================================

    const visibilityResource = apiResource.addResource('visibility');
    visibilityResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    const promptInsightsResource = apiResource.addResource('prompt-insights');
    promptInsightsResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    const citationGapsResource = apiResource.addResource('citation-gaps');
    citationGapsResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    const recommendationsResource = apiResource.addResource('recommendations');
    recommendationsResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    // POST /recommendations/{id}/status — set the action-tracking state
    // (new / in_progress / done / wontfix) for a given recommendation.
    // GET /recommendations/{id}/status — read the current state.
    // Both routed to the consolidated stats-insights Lambda which loads
    // recommendation-status.py via the ROUTE_MAP prefix match.
    const recommendationIdResource = recommendationsResource.addResource('{id}');
    const recommendationStatusResource = recommendationIdResource.addResource('status');
    recommendationStatusResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);
    recommendationStatusResource.addMethod('POST', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    const trendsResource = apiResource.addResource('trends');
    trendsResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    // Reports aggregator endpoints. /reports/overview returns the
    // cross-keyword executive-summary rollup; /reports/competitor
    // returns the per-competitor rollup (outranked keywords,
    // exclusive citation sources, prioritised outreach list).
    // Both are routed to the consolidated stats-insights Lambda so
    // they share the warm container with /trends, /recommendations,
    // /visibility, and /citation-gaps which they compose.
    const reportsResource = apiResource.addResource('reports');
    const reportsOverviewResource = reportsResource.addResource('overview');
    reportsOverviewResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);
    const reportsCompetitorResource = reportsResource.addResource('competitor');
    reportsCompetitorResource.addMethod('GET', new apigateway.LambdaIntegration(statsInsightsFunction, integrationOptions), methodOptions);

    // Persona Rankings API Route
    const personaRankingsResource = apiResource.addResource('persona-rankings');
    personaRankingsResource.addMethod('GET', new apigateway.LambdaIntegration(getPersonaRankingsFunction, integrationOptions), methodOptions);

    // Self-Reflection API Routes
    const selfReflectionResource = apiResource.addResource('self-reflection');
    selfReflectionResource.addMethod('POST', new apigateway.LambdaIntegration(selfReflectionFunction, integrationOptions), methodOptions);
    selfReflectionResource.addMethod('GET', new apigateway.LambdaIntegration(selfReflectionFunction, integrationOptions), methodOptions);

    // ========================================
    // Content Studio API
    // ========================================

    // Content Studio Lambda
    const contentStudioFunction = new lambda.Function(this, 'ContentStudioFunction', {
      functionName: 'CitationAnalysis-API-ContentStudio',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'content-studio.handler',
      code: createApiLambdaCode('content-studio.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      // Self-invokes for async content generation — see the constant's comment.
      reservedConcurrentExecutions: SELF_INVOKING_FUNCTION_CONCURRENCY,
      description: 'API: Content Studio - ideas and content generation',
      logGroup: apiLambdaLogGroup(this, 'ContentStudioLogGroup', 'CitationAnalysis-API-ContentStudio'),
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_CONTENT_STUDIO: contentStudioTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_SELF_REFLECTION: selfReflectionTable.tableName,
        // Budget after which the reader-side sweep declares a generation dead.
        // MUST stay above this function's own 300s timeout: at the previous
        // 240s a legitimate 241-300s run was marked `failed` while still
        // running, then flipped back to `generated` on completion
        // (AUDIT-2026-08-19 §2.9). 60s of headroom absorbs async queue delay
        // between the row being written and the worker actually starting.
        GENERATION_TIMEOUT_SECONDS: '360',
        ...bedrockTierEnv,
      },
    });
    searchResultsTable.grantReadData(contentStudioFunction);
    citationsTable.grantReadData(contentStudioFunction);
    crawledContentTable.grantReadData(contentStudioFunction);
    brandConfigTable.grantReadData(contentStudioFunction);
    contentStudioTable.grantReadWriteData(contentStudioFunction);
    keywordsTable.grantReadData(contentStudioFunction);
    selfReflectionTable.grantReadData(contentStudioFunction);
    // Grant Bedrock access for content generation using Converse API
    // Uses global.anthropic.claude-* inference profiles (Haiku 4.5 for speed)
    // Note: Converse API requires bedrock:InvokeModel permission (not bedrock:Converse)
    // Global cross-region inference requires three ARN patterns per AWS docs
    contentStudioFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`, // Regional inference profile
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`, // Regional foundation model
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`, // Global foundation model (no region/account)
      ],
    }));
    
    // Grant permission to invoke itself asynchronously for background content generation
    // Use ARN pattern to avoid circular dependency
    contentStudioFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:CitationAnalysis-API-ContentStudio`],
    }));

    // Content Studio API Routes
    const contentStudioResource = apiResource.addResource('content-studio');
    const contentStudioIdeasResource = contentStudioResource.addResource('ideas');
    contentStudioIdeasResource.addMethod('GET', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);
    
    const contentStudioGenerateResource = contentStudioResource.addResource('generate');
    contentStudioGenerateResource.addMethod('POST', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);
    
    const contentStudioStatusResource = contentStudioResource.addResource('status');
    const contentStudioStatusIdResource = contentStudioStatusResource.addResource('{id}');
    contentStudioStatusIdResource.addMethod('GET', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);
    
    const contentStudioViewedResource = contentStudioResource.addResource('viewed');
    contentStudioViewedResource.addMethod('POST', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);
    
    const contentStudioHistoryResource = contentStudioResource.addResource('history');
    contentStudioHistoryResource.addMethod('GET', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);
    
    const contentStudioIdResource = contentStudioResource.addResource('{id}');
    contentStudioIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(contentStudioFunction, integrationOptions), methodOptions);

    // ========================================
    // Provider Configuration API
    // ========================================

    // Provider Config API Routes (handled by configMgmtFunction)
    const providersResource = apiResource.addResource('providers');
    providersResource.addMethod('GET', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    
    const providerIdResource = providersResource.addResource('{id}');
    providerIdResource.addMethod('PUT', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);
    
    const providerValidateResource = providerIdResource.addResource('validate');
    providerValidateResource.addMethod('POST', new apigateway.LambdaIntegration(configMgmtFunction, integrationOptions), methodOptions);

    // ========================================
    // User Management API
    // ========================================

    // User Management Lambda
    const manageUsersFunction = new lambda.Function(this, 'ManageUsersFunction', {
      functionName: 'CitationAnalysis-API-ManageUsers',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-users.handler',
      code: createApiLambdaCode('manage-users.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 256,
      description: 'API: Manage Cognito users',
      logGroup: apiLambdaLogGroup(this, 'ManageUsersLogGroup', 'CitationAnalysis-API-ManageUsers'),
      environment: {
        USER_POOL_ID: auth.userPool.userPoolId,
      },
    });

    // Grant Cognito permissions for user management
    manageUsersFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminResetUserPassword',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:ListGroups',
      ],
      resources: [auth.userPool.userPoolArn],
    }));

    // User Management API Routes
    const usersResource = apiResource.addResource('users');
    usersResource.addMethod('GET', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    usersResource.addMethod('POST', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    
    const usersGroupsResource = usersResource.addResource('groups');
    usersGroupsResource.addMethod('GET', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    
    const userUsernameResource = usersResource.addResource('{username}');
    userUsernameResource.addMethod('GET', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    userUsernameResource.addMethod('PUT', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    userUsernameResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);
    
    const userResetPasswordResource = userUsernameResource.addResource('reset-password');
    userResetPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(manageUsersFunction, integrationOptions), methodOptions);

    // ========================================
    // Visualization Dashboard - S3 + CloudFront
    // ========================================

    // S3 Bucket for Web Hosting
    // Security: Block all public access, use CloudFront OAC for access
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `citation-analysis-web-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      versioned: false,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'web/',
    });

    // Build the React app (npm run build must be run before deployment)
    // The build output will be in web/dist folder
    // Note: API URL is injected via VITE_API_URL env var during build (see scripts/build-web.sh)
    const webPath = path.join(__dirname, '../web');
    const distPath = path.join(webPath, 'dist');
    
    // Require web build before deployment - fail fast for better developer experience
    if (!fs.existsSync(distPath)) {
      throw new WebBuildRequiredError();
    }

    // Deploy web assets to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(distPath)],
      destinationBucket: webBucket,
      prune: false,
    });

    // ========================================
    // CloudFront WAF (us-east-1) - Cross-Region Custom Resource
    // ========================================
    
    // CloudFront WAF must be in us-east-1. We use a custom resource to create it.
    const cloudFrontWafProvider = new cdk.custom_resources.Provider(this, 'CloudFrontWafProvider', {
      onEventHandler: new lambda.Function(this, 'CloudFrontWafHandler', {
        functionName: 'CitationAnalysis-CloudFrontWafHandler',
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        timeout: cdk.Duration.minutes(5),
        code: lambda.Code.fromInline(`
import boto3
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    request_type = event['RequestType']
    props = event['ResourceProperties']
    waf_name = props['WafName']
    
    # WAFv2 client in us-east-1 for CloudFront scope
    waf = boto3.client('wafv2', region_name='us-east-1')
    
    if request_type == 'Create':
        return create_waf(waf, waf_name)
    elif request_type == 'Update':
        old_props = event.get('OldResourceProperties', {})
        physical_id = event['PhysicalResourceId']
        # If name changed, delete old and create new
        if old_props.get('WafName') != waf_name:
            delete_waf(waf, physical_id)
            return create_waf(waf, waf_name)
        return {'PhysicalResourceId': physical_id, 'Data': {'WebAclArn': physical_id}}
    elif request_type == 'Delete':
        physical_id = event['PhysicalResourceId']
        delete_waf(waf, physical_id)
        return {'PhysicalResourceId': physical_id}

def create_waf(waf, waf_name):
    response = waf.create_web_acl(
        Name=waf_name,
        Scope='CLOUDFRONT',
        DefaultAction={'Allow': {}},
        VisibilityConfig={
            'SampledRequestsEnabled': True,
            'CloudWatchMetricsEnabled': True,
            'MetricName': 'CitationAnalysisCloudFrontWaf'
        },
        Rules=[
            {
                'Name': 'AWSManagedRulesCommonRuleSet',
                'Priority': 1,
                'OverrideAction': {'None': {}},
                'Statement': {
                    'ManagedRuleGroupStatement': {
                        'VendorName': 'AWS',
                        'Name': 'AWSManagedRulesCommonRuleSet'
                    }
                },
                'VisibilityConfig': {
                    'SampledRequestsEnabled': True,
                    'CloudWatchMetricsEnabled': True,
                    'MetricName': 'AWSManagedRulesCommonRuleSet'
                }
            },
            {
                'Name': 'AWSManagedRulesKnownBadInputsRuleSet',
                'Priority': 2,
                'OverrideAction': {'None': {}},
                'Statement': {
                    'ManagedRuleGroupStatement': {
                        'VendorName': 'AWS',
                        'Name': 'AWSManagedRulesKnownBadInputsRuleSet'
                    }
                },
                'VisibilityConfig': {
                    'SampledRequestsEnabled': True,
                    'CloudWatchMetricsEnabled': True,
                    'MetricName': 'AWSManagedRulesKnownBadInputsRuleSet'
                }
            },
            {
                'Name': 'RateLimitRule',
                'Priority': 3,
                'Action': {'Block': {}},
                'Statement': {
                    'RateBasedStatement': {
                        'Limit': 1000,
                        'AggregateKeyType': 'IP'
                    }
                },
                'VisibilityConfig': {
                    'SampledRequestsEnabled': True,
                    'CloudWatchMetricsEnabled': True,
                    'MetricName': 'RateLimitRule'
                }
            }
        ]
    )
    arn = response['Summary']['ARN']
    logger.info(f"Created WAF: {arn}")
    return {'PhysicalResourceId': arn, 'Data': {'WebAclArn': arn}}

def delete_waf(waf, arn):
    try:
        # Get the lock token
        name = arn.split('/')[-2]
        id = arn.split('/')[-1]
        response = waf.get_web_acl(Name=name, Scope='CLOUDFRONT', Id=id)
        lock_token = response['LockToken']
        waf.delete_web_acl(Name=name, Scope='CLOUDFRONT', Id=id, LockToken=lock_token)
        logger.info(f"Deleted WAF: {arn}")
    except Exception as e:
        logger.warning(f"Failed to delete WAF {arn}: {e}")
`),
      }),
    });

    // Grant the handler permission to manage WAF in us-east-1
    cloudFrontWafProvider.onEventHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'wafv2:CreateWebACL',
        'wafv2:DeleteWebACL',
        'wafv2:GetWebACL',
        'wafv2:UpdateWebACL',
      ],
      resources: ['*'], // WAF ARNs are dynamic
    }));

    // Create the CloudFront WAF via custom resource
    const cloudFrontWaf = new cdk.CustomResource(this, 'CloudFrontWaf', {
      serviceToken: cloudFrontWafProvider.serviceToken,
      properties: {WafName: 'CitationAnalysis-CloudFront-WAF',},
    });
    // CloudFront Distribution with WAF protection
    // Create response headers policy for security headers
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: 'CitationAnalysis-SecurityHeaders-v3',
      comment: 'Security headers for Citation Analysis Dashboard',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none';",
          override: true,
        },
        contentTypeOptions: {override: true,},
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31536000), // 1 year
          includeSubdomains: true,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      webAclId: cloudFrontWaf.getAttString('WebAclArn'),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // ========================================
    // Associate WAF with API Gateway — NOT DONE, BY DECISION 2026-08-19
    // ========================================
    //
    // The commented-out `CfnWebACLAssociation` that lived here is gone along
    // with the ACL it referenced; see "WAF Web ACL for API Gateway — REMOVED"
    // above for the reasoning and for what protects the API instead. Kept as a
    // marker so the absence reads as a decision rather than an oversight.

    // ========================================
    // Configure CORS with CloudFront Domain
    // ========================================
    
    // Now that we have the CloudFront domain, configure CORS headers
    // This is done via a custom resource or by setting environment variables
    // that Lambda functions use to return proper CORS headers
    const cloudFrontOrigin = `https://${distribution.distributionDomainName}`;

    // SECURITY: Gateway responses use the CloudFront origin instead of wildcard '*'
    // so that auth failure details (401/403) are not observable by arbitrary origins.
    // In dev mode, use wildcard to allow localhost (Lambda-level CORS still validates per-request).
    const gatewayResponseCorsHeaders = {
      'Access-Control-Allow-Origin': devMode ? "'*'" : `'${cloudFrontOrigin}'`,
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
    };

    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: gatewayResponseCorsHeaders,
    });

    api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: gatewayResponseCorsHeaders,
    });

    api.addGatewayResponse('ExpiredToken', {
      type: apigateway.ResponseType.EXPIRED_TOKEN,
      statusCode: '403',
      responseHeaders: gatewayResponseCorsHeaders,
    });
    
    // Update Cognito User Pool Client callback URLs with CloudFront domain
    const cfnUserPoolClient = auth.userPoolClient.node.defaultChild as cdk.aws_cognito.CfnUserPoolClient;
    cfnUserPoolClient.callbackUrLs = [cloudFrontOrigin, 'http://localhost:5173'];
    cfnUserPoolClient.logoutUrLs = [cloudFrontOrigin, 'http://localhost:5173'];
    
    // Update Cognito email templates with actual CloudFront URL
    auth.updateEmailTemplatesWithUrl(cloudFrontOrigin);
    
    // Store CloudFront origin in SSM Parameter for Lambda functions to use
    const corsOriginParam = new cdk.aws_ssm.StringParameter(this, 'CorsOriginParam', {
      parameterName: '/citation-analysis/cors-origin',
      stringValue: cloudFrontOrigin,
      description: 'Allowed CORS origin for API responses',
    });
    
    // Grant all API Lambda functions read access to the CORS parameter
    const apiLambdaFunctions = [
      statsInsightsFunction, citationsContentFunction,
      keywordMgmtFunction, configMgmtFunction, executionMgmtFunction,
      getBrandMentionsFunction, manageBrandConfigFunction,
      contentStudioFunction, manageUsersFunction,
      getPersonaRankingsFunction, selfReflectionFunction
    ];
    
    for (const fn of apiLambdaFunctions) {
      corsOriginParam.grantRead(fn);
      fn.addEnvironment('CORS_ORIGIN_PARAM', corsOriginParam.parameterName);
      if (devMode) {
        fn.addEnvironment('ALLOW_LOCALHOST', 'true');
      }
    }

    // ========================================
    // Optimize Lambda Permissions
    // ========================================
    // CDK creates 2 Lambda::Permission per API method (prod + test-invoke).
    // For consolidated Lambdas backing many routes, replace N permissions with
    // a single wildcard permission per function. This is safe because all routes
    // share the same Cognito authorizer and the Lambda handles its own routing.
    // AWS docs support wildcard source ARNs for execute-api.

    const consolidatedFunctions = [
      statsInsightsFunction, citationsContentFunction, keywordMgmtFunction,
      configMgmtFunction, executionMgmtFunction, manageBrandConfigFunction,
      contentStudioFunction, manageUsersFunction,
    ];

    for (const fn of consolidatedFunctions) {
      // Add single wildcard permission for this API
      fn.addPermission('ApiGatewayWildcard', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: api.arnForExecuteApi('*'),
      });
    }

    // Remove CDK auto-generated per-method Lambda::Permission resources
    // for consolidated functions. The wildcard permission above covers all methods.
    // We use Aspects to remove them after synthesis since they're created on the
    // API Gateway method constructs, not on the Lambda.
    class RemoveDuplicatePermissions implements cdk.IAspect {
      private readonly fnArns: Set<string>;
      private readonly fnArnStrings: string[];
      constructor(fns: lambda.Function[]) {
        this.fnArns = new Set(fns.map(fn => fn.functionArn));
        this.fnArnStrings = fns.map(fn => JSON.stringify(fn.functionArn));
      }
      public visit(node: Construct): void {
        if (node instanceof lambda.CfnPermission) {
          if (node.node.id === 'ApiGatewayWildcard') return;
          const fnNameStr = JSON.stringify(node.functionName);
          if (this.fnArnStrings.includes(fnNameStr)) {
            const parent = node.node.scope;
            if (parent) {
              parent.node.tryRemoveChild(node.node.id);
            }
          }
        }
      }
    }


    cdk.Aspects.of(this).add(new RemoveDuplicatePermissions(consolidatedFunctions));

    // ========================================
    // Outputs
    // ========================================

    // API Gateway URL
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: 'CitationAnalysis-ApiGatewayUrl',
    });

    // CloudFront Distribution URL
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Citation Analysis Dashboard URL',
      exportName: 'CitationAnalysis-DashboardUrl',
    });

    // CloudFront Distribution ID
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID (for cache invalidation)',
      exportName: 'CitationAnalysis-CloudFrontDistributionId',
    });

    // There is no API Gateway Web ACL output because there is no longer an API
    // Gateway Web ACL — it was deleted on 2026-08-19 (AUDIT-2026-08-19 §2.1).
    // The output had already been dropped before that, because describing an
    // unassociated ACL as "protecting API Gateway" told anyone auditing this
    // account that protection existed where it did not.
    //
    // The CloudFront Web ACL below IS attached, so its export is accurate.

    // WAF Web ACL ARN (CloudFront - us-east-1)
    new cdk.CfnOutput(this, 'CloudFrontWafWebAclArn', {
      value: cloudFrontWaf.getAttString('WebAclArn'),
      description: 'WAF Web ACL ARN protecting CloudFront (us-east-1)',
      exportName: 'CitationAnalysis-CloudFrontWafWebAclArn',
    });

    // Web S3 Bucket Name
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 bucket for web dashboard',
      exportName: 'CitationAnalysis-WebBucketName',
    });

    // CORS Origin
    new cdk.CfnOutput(this, 'CorsOrigin', {
      value: cloudFrontOrigin,
      description: 'Allowed CORS origin (CloudFront domain)',
      exportName: 'CitationAnalysis-CorsOrigin',
    });

    // Cognito User Pool ID
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'CitationAnalysis-UserPoolId',
    });

    // Cognito User Pool Client ID
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'CitationAnalysis-UserPoolClientId',
    });

    // Cognito Identity Pool ID
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: auth.identityPool.identityPoolId,
      description: 'Cognito Identity Pool ID',
      exportName: 'CitationAnalysis-IdentityPoolId',
    });

    // S3 Website URL removed - bucket no longer has public access
    // Access is now exclusively through CloudFront with OAC

    // Deployment instructions
    new cdk.CfnOutput(this, 'DeploymentInstructions', {
      value: 'Open the dashboard, go to Settings > Providers to configure API keys, then add keywords and run analysis',
      description: 'Next steps after deployment',
    });
  }
}
