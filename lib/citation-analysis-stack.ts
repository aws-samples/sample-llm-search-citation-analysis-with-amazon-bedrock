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
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as path from 'path';
import * as fs from 'fs';
import { Auth } from './constructs/auth';

/**
 * Creates optimized Lambda code bundle containing only the specific handler file
 * plus shared utilities (decimal_utils.py). This reduces deployment package size
 * and improves cold start times compared to bundling all API handlers together.
 * 
 * Uses local bundling (no Docker required) with Docker as fallback.
 * 
 * @param handlerFileName - The Python handler file name (e.g., 'get-stats.py')
 * @returns Lambda Code asset with only the required files
 */
function createApiLambdaCode(handlerFileName: string): lambda.Code {
  const apiPath = path.join(__dirname, '../lambda/api');
  
  return lambda.Code.fromAsset(apiPath, {
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: [
        'bash', '-c',
        `mkdir -p /asset-output && ` +
        `cp /asset-input/${handlerFileName} /asset-output/ && ` +
        `if [ -f /asset-input/decimal_utils.py ]; then cp /asset-input/decimal_utils.py /asset-output/; fi`
      ],
      local: {
        tryBundle(outputDir: string): boolean {
          try {
            // Copy the specific handler file
            const handlerSrc = path.join(apiPath, handlerFileName);
            const handlerDest = path.join(outputDir, handlerFileName);
            fs.copyFileSync(handlerSrc, handlerDest);
            
            // Copy decimal_utils.py if it exists (shared utility)
            const utilsSrc = path.join(apiPath, 'decimal_utils.py');
            if (fs.existsSync(utilsSrc)) {
              const utilsDest = path.join(outputDir, 'decimal_utils.py');
              fs.copyFileSync(utilsSrc, utilsDest);
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
    const novaActSecret = secretsmanager.Secret.fromSecretNameV2(
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
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          enabled: true,
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

    // Grant Crawler Lambda read access to Nova Act secret (for intelligent verification handling)
    novaActSecret.grantRead(crawlerLambdaRole);

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
      throw new Error(
        'Shared layer not built. Run: bash lambda/layer/build-layer.sh\n' +
        'Or use scripts/deploy.sh which builds all layers automatically.'
      );
    }
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: 'CitationAnalysis-SharedLayer',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/layer')),
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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/parse-keywords')),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Parse keywords from S3 or direct input',
      logGroup: parseKeywordsLogGroup,
    });

    // Grant ParseKeywords Lambda read access to keywords bucket
    keywordsBucket.grantRead(parseKeywordsFunction);

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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/search')),
      role: searchLambdaRole,
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(180), // Increased to 3 minutes to accommodate retries
      memorySize: 512,
      description: 'Query all AI providers with web search',
      logGroup: searchLogGroup,
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
        RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/deduplication')),
      role: deduplicationLambdaRole,
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Deduplicate and prioritize citations',
      logGroup: deduplicationLogGroup,
      environment: {CITATIONS_TABLE_NAME: citationsTable.tableName,},
    });

    // Crawler Lambda Layer - Browser tools (Playwright + AgentCore)
    // Separate from shared layer to keep each under 250MB limit
    // NOTE: Run scripts/deploy.sh or lambda/crawler-layer/build-layer.sh before cdk deploy
    const crawlerLayerPath = path.join(__dirname, '../lambda/crawler-layer');
    const crawlerLayerPythonPath = path.join(crawlerLayerPath, 'python');
    if (!fs.existsSync(crawlerLayerPythonPath) || fs.readdirSync(crawlerLayerPythonPath).length === 0) {
      throw new Error(
        'Crawler layer not built. Run: bash lambda/crawler-layer/build-layer.sh\n' +
        'Or use scripts/deploy.sh which builds all layers automatically.'
      );
    }
    const crawlerLayer = new lambda.LayerVersion(this, 'CrawlerLayer', {
      layerVersionName: 'CitationAnalysis-CrawlerLayer',
      code: lambda.Code.fromAsset(crawlerLayerPath),
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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/crawler')),
      role: crawlerLambdaRole,
      layers: [crawlerLayer], // Crawler layer includes shared modules (copied during build)
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024, // Increased for browser automation
      description: 'Crawl cited pages using Bedrock AgentCore with screenshots and SEO analysis',
      logGroup: crawlerLogGroup,
      environment: {
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        BEDROCK_MODEL_ID: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        BROWSER_TIMEOUT_MS: '30000',
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', // Use AgentCore managed browsers
        BROWSER_ID: crawlerBrowser.attrBrowserId, // Pre-created browser with Web Bot Auth
        NOVA_ACT_SECRET_NAME: 'citation-analysis/nova-act-key', // Nova Act for verification handling
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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/generate-summary')),
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
      itemSelector: {'citation.$': '$$.Map.Item.Value',},
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
        'query_prompts.$': '$$.Execution.Input.query_prompts',
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
    const stateMachine = new stepfunctions.StateMachine(this, 'CitationAnalysisStateMachine', {
      stateMachineName: 'CitationAnalysis-Workflow',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      role: stepFunctionsRole,
      timeout: cdk.Duration.hours(2),
      tracingEnabled: true,
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
    });
    
    const getStatsFunction = new lambda.Function(this, 'GetStatsFunction', {
      functionName: 'CitationAnalysis-API-GetStats',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-stats.handler',
      code: createApiLambdaCode('get-stats.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get dashboard statistics',
      environment: {
        SEARCH_RESULTS_TABLE: searchResultsTable.tableName,
        CITATIONS_TABLE: citationsTable.tableName,
        CRAWLED_CONTENT_TABLE: crawledContentTable.tableName,
        KEYWORDS_TABLE: keywordsTable.tableName,
      },
    });

    const getCitationsFunction = new lambda.Function(this, 'GetCitationsFunction', {
      functionName: 'CitationAnalysis-API-GetCitations',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-citations.handler',
      code: createApiLambdaCode('get-citations.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get citation statistics',
      environment: {
        CITATIONS_TABLE: citationsTable.tableName,
        SEARCH_RESULTS_TABLE: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
      },
    });

    const getUrlBreakdownFunction = new lambda.Function(this, 'GetUrlBreakdownFunction', {
      functionName: 'CitationAnalysis-API-GetUrlBreakdown',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-url-breakdown.handler',
      code: createApiLambdaCode('get-url-breakdown.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get keyword/provider breakdown for a URL',
      environment: {SEARCH_RESULTS_TABLE: searchResultsTable.tableName,},
    });

    const getSearchesFunction = new lambda.Function(this, 'GetSearchesFunction', {
      functionName: 'CitationAnalysis-API-GetSearches',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-searches.handler',
      code: createApiLambdaCode('get-searches.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get search results',
      environment: {SEARCH_RESULTS_TABLE: searchResultsTable.tableName,},
    });

    const getKeywordsFunction = new lambda.Function(this, 'GetKeywordsFunction', {
      functionName: 'CitationAnalysis-API-GetKeywords',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-keywords.handler',
      code: createApiLambdaCode('get-keywords.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get all keywords',
      environment: {KEYWORDS_TABLE: keywordsTable.tableName,},
    });

    const getBrandMentionsFunction = new lambda.Function(this, 'GetBrandMentionsFunction', {
      functionName: 'CitationAnalysis-API-GetBrandMentions',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-brand-mentions.handler',
      code: createApiLambdaCode('get-brand-mentions.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get brand mentions from search results',
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
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Manage brand tracking configuration',
      environment: {DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,},
    });

    const getCrawledContentFunction = new lambda.Function(this, 'GetCrawledContentFunction', {
      functionName: 'CitationAnalysis-API-GetCrawledContent',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-crawled-content.handler',
      code: createApiLambdaCode('get-crawled-content.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get crawled content with screenshots and SEO analysis',
      environment: {CRAWLED_CONTENT_TABLE: crawledContentTable.tableName,},
    });

    const manageKeywordsFunction = new lambda.Function(this, 'ManageKeywordsFunction', {
      functionName: 'CitationAnalysis-API-ManageKeywords',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-keywords.handler',
      code: createApiLambdaCode('manage-keywords.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Create, update, delete keywords',
      environment: {KEYWORDS_TABLE: keywordsTable.tableName,},
    });

    const manageQueryPromptsFunction = new lambda.Function(this, 'ManageQueryPromptsFunction', {
      functionName: 'CitationAnalysis-API-ManageQueryPrompts',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-query-prompts.handler',
      code: createApiLambdaCode('manage-query-prompts.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: CRUD operations for query prompt templates',
      environment: {QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,},
    });

    const triggerAnalysisFunction = new lambda.Function(this, 'TriggerAnalysisFunction', {
      functionName: 'CitationAnalysis-API-TriggerAnalysis',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'trigger-analysis.handler',
      code: createApiLambdaCode('trigger-analysis.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Trigger Step Functions execution',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        KEYWORDS_TABLE: keywordsTable.tableName,
        QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,
      },
    });

    const triggerKeywordAnalysisFunction = new lambda.Function(this, 'TriggerKeywordAnalysisFunction', {
      functionName: 'CitationAnalysis-API-TriggerKeywordAnalysis',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'trigger-keyword-analysis.handler',
      code: createApiLambdaCode('trigger-keyword-analysis.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Trigger Step Functions execution for specific keywords',
      environment: {STATE_MACHINE_ARN: stateMachine.stateMachineArn, QUERY_PROMPTS_TABLE: queryPromptsTable.tableName,},
    });

    // Grant trigger-keyword-analysis read access to query prompts
    queryPromptsTable.grantReadData(triggerKeywordAnalysisFunction);

    const getExecutionStatusFunction = new lambda.Function(this, 'GetExecutionStatusFunction', {
      functionName: 'CitationAnalysis-API-GetExecutionStatus',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-execution-status.handler',
      code: createApiLambdaCode('get-execution-status.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get Step Functions execution status (v2)',
    });

    const manageScheduleFunction = new lambda.Function(this, 'ManageScheduleFunction', {
      functionName: 'CitationAnalysis-API-ManageSchedule',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-schedule.handler',
      code: createApiLambdaCode('manage-schedule.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Manage EventBridge schedules',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        SCHEDULE_ROLE_ARN: schedulerRole.roleArn,
      },
    });

    const browseRawResponsesFunction = new lambda.Function(this, 'BrowseRawResponsesFunction', {
      functionName: 'CitationAnalysis-API-BrowseRawResponses',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'browse-raw-responses.handler',
      code: createApiLambdaCode('browse-raw-responses.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Browse raw API responses and screenshots in S3',
      environment: {
        RAW_RESPONSES_BUCKET: rawResponsesBucket.bucketName,
        SCREENSHOTS_BUCKET: screenshotsBucket.bucketName,
      },
    });

    // Grant browse function read access to raw responses and screenshots buckets
    rawResponsesBucket.grantRead(browseRawResponsesFunction);
    screenshotsBucket.grantRead(browseRawResponsesFunction);

    // Keyword Research Lambda Function
    const keywordResearchFunction = new lambda.Function(this, 'KeywordResearchFunction', {
      functionName: 'CitationAnalysis-API-KeywordResearch',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'keyword-research.handler',
      code: createApiLambdaCode('keyword-research.py'),
      layers: [sharedLayer],  // Needs requests library
      timeout: cdk.Duration.seconds(120),
      memorySize: 256,
      description: 'API: Keyword expansion and competitor analysis',
      environment: {
        KEYWORD_RESEARCH_TABLE: keywordResearchTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });

    // Grant keyword research function access to DynamoDB and Secrets
    keywordResearchTable.grantReadWriteData(keywordResearchFunction);
    perplexitySecret.grantRead(keywordResearchFunction);
    openaiSecret.grantRead(keywordResearchFunction);  // Fallback provider
    geminiSecret.grantRead(keywordResearchFunction);  // Fallback provider
    keywordResearchFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:CitationAnalysis-API-KeywordResearch`],
    }));  // Self-invoke for async keyword research

    // Grant API Lambda functions read access to DynamoDB tables
    searchResultsTable.grantReadData(getStatsFunction);
    citationsTable.grantReadData(getStatsFunction);
    crawledContentTable.grantReadData(getStatsFunction);
    keywordsTable.grantReadData(getStatsFunction);
    citationsTable.grantReadData(getCitationsFunction);
    searchResultsTable.grantReadData(getCitationsFunction);
    brandConfigTable.grantReadData(getCitationsFunction);
    searchResultsTable.grantReadData(getUrlBreakdownFunction);
    searchResultsTable.grantReadData(getSearchesFunction);
    keywordsTable.grantReadData(getKeywordsFunction);
    keywordsTable.grantReadWriteData(manageKeywordsFunction);
    queryPromptsTable.grantReadWriteData(manageQueryPromptsFunction);
    keywordsTable.grantReadData(triggerAnalysisFunction);
    queryPromptsTable.grantReadData(triggerAnalysisFunction);
    searchResultsTable.grantReadData(getBrandMentionsFunction);
    brandConfigTable.grantReadData(getBrandMentionsFunction);
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
    
    crawledContentTable.grantReadData(getCrawledContentFunction);
    screenshotsBucket.grantRead(getCrawledContentFunction);

    // Grant permissions for Step Functions and EventBridge Scheduler management
    triggerAnalysisFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:StartExecution'],
      resources: [stateMachine.stateMachineArn],
    }));

    triggerKeywordAnalysisFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:StartExecution'],
      resources: [stateMachine.stateMachineArn],
    }));

    // Scoped to specific state machine and its executions (security best practice)
    getExecutionStatusFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:DescribeExecution',
        'states:GetExecutionHistory',
      ],
      resources: [
        `arn:aws:states:${this.region}:${this.account}:execution:CitationAnalysis-Workflow:*`
      ],
    }));
    getExecutionStatusFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:ListExecutions'],
      resources: [stateMachine.stateMachineArn],
    }));

    // Scoped to CitationAnalysis schedules only (security best practice)
    manageScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:GetSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:UpdateSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/CitationAnalysis-*`],
    }));
    manageScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:ListSchedules'],
      resources: ['*'], // ListSchedules requires wildcard but is read-only
    }));
    manageScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'scheduler:CreateScheduleGroup',
        'scheduler:GetScheduleGroup',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule-group/default`],
    }));

    manageScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));

    // Grant scheduler role permission to start executions
    stateMachine.grantStartExecution(schedulerRole);

    // ========================================
    // WAF Web ACL for API Gateway
    // ========================================
    
    // Create WAF Web ACL with AWS managed rules for API protection
    const apiWaf = new wafv2.CfnWebACL(this, 'ApiWaf', {
      name: 'CitationAnalysis-API-WAF',
      scope: 'REGIONAL', // REGIONAL for API Gateway
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CitationAnalysisApiWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
        // AWS Managed Rules - Common Rule Set (protects against common web exploits)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - Known Bad Inputs (blocks request patterns known to be malicious)
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - SQL Injection protection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // Rate limiting rule - 1000 requests per 5 minutes per IP
        {
          name: 'RateLimitRule',
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

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
    statsResource.addMethod('GET', new apigateway.LambdaIntegration(getStatsFunction, integrationOptions), methodOptions);

    // Health check endpoint - No authentication required
    // NOSONAR: Health check must be public for load balancer/monitoring probes
    const healthResource = apiResource.addResource('health');
    healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthCheckFunction, integrationOptions), {
      authorizationType: apigateway.AuthorizationType.NONE, // NOSONAR
    });

    const citationsResource = apiResource.addResource('citations');
    citationsResource.addMethod('GET', new apigateway.LambdaIntegration(getCitationsFunction, integrationOptions), methodOptions);

    const urlBreakdownResource = apiResource.addResource('url-breakdown');
    urlBreakdownResource.addMethod('GET', new apigateway.LambdaIntegration(getUrlBreakdownFunction, integrationOptions), methodOptions);

    const searchesResource = apiResource.addResource('searches');
    searchesResource.addMethod('GET', new apigateway.LambdaIntegration(getSearchesFunction, integrationOptions), methodOptions);

    const keywordsResource = apiResource.addResource('keywords');
    keywordsResource.addMethod('GET', new apigateway.LambdaIntegration(getKeywordsFunction, integrationOptions), methodOptions);
    keywordsResource.addMethod('POST', new apigateway.LambdaIntegration(manageKeywordsFunction, integrationOptions), methodOptions);
    
    const keywordIdResource = keywordsResource.addResource('{id}');
    keywordIdResource.addMethod('PUT', new apigateway.LambdaIntegration(manageKeywordsFunction, integrationOptions), methodOptions);
    keywordIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageKeywordsFunction, integrationOptions), methodOptions);

    const queryPromptsResource = apiResource.addResource('query-prompts');
    queryPromptsResource.addMethod('GET', new apigateway.LambdaIntegration(manageQueryPromptsFunction, integrationOptions), methodOptions);
    queryPromptsResource.addMethod('POST', new apigateway.LambdaIntegration(manageQueryPromptsFunction, integrationOptions), methodOptions);

    const queryPromptIdResource = queryPromptsResource.addResource('{id}');
    queryPromptIdResource.addMethod('PUT', new apigateway.LambdaIntegration(manageQueryPromptsFunction, integrationOptions), methodOptions);
    queryPromptIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageQueryPromptsFunction, integrationOptions), methodOptions);
    queryPromptIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(manageQueryPromptsFunction, integrationOptions), methodOptions);

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
    crawledContentResource.addMethod('GET', new apigateway.LambdaIntegration(getCrawledContentFunction, integrationOptions), methodOptions);

    const triggerResource = apiResource.addResource('trigger-analysis');
    triggerResource.addMethod('POST', new apigateway.LambdaIntegration(triggerAnalysisFunction, integrationOptions), methodOptions);

    const triggerKeywordResource = apiResource.addResource('trigger-keyword-analysis');
    triggerKeywordResource.addMethod('POST', new apigateway.LambdaIntegration(triggerKeywordAnalysisFunction, integrationOptions), methodOptions);

    const executionsResource = apiResource.addResource('executions');
    const executionIdResource = executionsResource.addResource('{id}');
    executionIdResource.addMethod('GET', new apigateway.LambdaIntegration(getExecutionStatusFunction, integrationOptions), methodOptions);

    const schedulesResource = apiResource.addResource('schedules');
    schedulesResource.addMethod('GET', new apigateway.LambdaIntegration(manageScheduleFunction, integrationOptions), methodOptions);
    schedulesResource.addMethod('POST', new apigateway.LambdaIntegration(manageScheduleFunction, integrationOptions), methodOptions);
    
    const scheduleNameResource = schedulesResource.addResource('{name}');
    scheduleNameResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageScheduleFunction, integrationOptions), methodOptions);

    // Raw Responses Browser API
    const rawResponsesResource = apiResource.addResource('raw-responses');
    const rawResponsesBrowseResource = rawResponsesResource.addResource('browse');
    rawResponsesBrowseResource.addMethod('GET', new apigateway.LambdaIntegration(browseRawResponsesFunction, integrationOptions), methodOptions);
    
    const rawResponsesFileResource = rawResponsesResource.addResource('file');
    rawResponsesFileResource.addMethod('GET', new apigateway.LambdaIntegration(browseRawResponsesFunction, integrationOptions), methodOptions);
    
    const rawResponsesDownloadResource = rawResponsesResource.addResource('download');
    rawResponsesDownloadResource.addMethod('GET', new apigateway.LambdaIntegration(browseRawResponsesFunction, integrationOptions), methodOptions);

    // Keyword Research API
    const keywordResearchResource = apiResource.addResource('keyword-research');
    const keywordResearchExpandResource = keywordResearchResource.addResource('expand');
    keywordResearchExpandResource.addMethod('POST', new apigateway.LambdaIntegration(keywordResearchFunction, integrationOptions), methodOptions);
    
    const keywordResearchCompetitorResource = keywordResearchResource.addResource('competitor');
    keywordResearchCompetitorResource.addMethod('POST', new apigateway.LambdaIntegration(keywordResearchFunction, integrationOptions), methodOptions);
    
    const keywordResearchHistoryResource = keywordResearchResource.addResource('history');
    keywordResearchHistoryResource.addMethod('GET', new apigateway.LambdaIntegration(keywordResearchFunction, integrationOptions), methodOptions);
    
    const keywordResearchIdResource = keywordResearchResource.addResource('{id}');
    keywordResearchIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(keywordResearchFunction, integrationOptions), methodOptions);

    // ========================================
    // Visibility & Insights APIs
    // ========================================

    // Visibility Metrics Lambda
    const getVisibilityMetricsFunction = new lambda.Function(this, 'GetVisibilityMetricsFunction', {
      functionName: 'CitationAnalysis-API-GetVisibilityMetrics',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-visibility-metrics.handler',
      code: createApiLambdaCode('get-visibility-metrics.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Get visibility scores and share of voice metrics',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getVisibilityMetricsFunction);
    brandConfigTable.grantReadData(getVisibilityMetricsFunction);
    providerConfigTable.grantReadData(getVisibilityMetricsFunction);

    // Prompt Insights Lambda
    const getPromptInsightsFunction = new lambda.Function(this, 'GetPromptInsightsFunction', {
      functionName: 'CitationAnalysis-API-GetPromptInsights',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-prompt-insights.handler',
      code: createApiLambdaCode('get-prompt-insights.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'API: Get prompt intelligence and winning/losing prompts',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getPromptInsightsFunction);
    keywordsTable.grantReadData(getPromptInsightsFunction);
    brandConfigTable.grantReadData(getPromptInsightsFunction);

    // Citation Gaps Lambda
    const getCitationGapsFunction = new lambda.Function(this, 'GetCitationGapsFunction', {
      functionName: 'CitationAnalysis-API-GetCitationGaps',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-citation-gaps.handler',
      code: createApiLambdaCode('get-citation-gaps.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'API: Get citation gap analysis',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getCitationGapsFunction);
    citationsTable.grantReadData(getCitationGapsFunction);
    crawledContentTable.grantReadData(getCitationGapsFunction);
    brandConfigTable.grantReadData(getCitationGapsFunction);
    keywordsTable.grantReadData(getCitationGapsFunction);

    // Recommendations Lambda
    const getRecommendationsFunction = new lambda.Function(this, 'GetRecommendationsFunction', {
      functionName: 'CitationAnalysis-API-GetRecommendations',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-recommendations.handler',
      code: createApiLambdaCode('get-recommendations.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'API: Get actionable recommendations',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getRecommendationsFunction);
    citationsTable.grantReadData(getRecommendationsFunction);
    crawledContentTable.grantReadData(getRecommendationsFunction);
    brandConfigTable.grantReadData(getRecommendationsFunction);
    keywordsTable.grantReadData(getRecommendationsFunction);
    // Grant Bedrock access for LLM-enhanced recommendations
    // Uses global.anthropic.claude-* inference profiles with Converse API
    // Note: Converse API requires bedrock:InvokeModel permission (not bedrock:Converse)
    // Global cross-region inference requires three ARN patterns per AWS docs
    getRecommendationsFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/global.anthropic.claude-*`, // Regional inference profile
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`, // Regional foundation model
        `arn:aws:bedrock:::foundation-model/anthropic.claude-*`, // Global foundation model (no region/account)
      ],
    }));

    // Historical Trends Lambda
    const getHistoricalTrendsFunction = new lambda.Function(this, 'GetHistoricalTrendsFunction', {
      functionName: 'CitationAnalysis-API-GetHistoricalTrends',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get-historical-trends.handler',
      code: createApiLambdaCode('get-historical-trends.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      description: 'API: Get historical visibility trends',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
      },
    });
    searchResultsTable.grantReadData(getHistoricalTrendsFunction);
    brandConfigTable.grantReadData(getHistoricalTrendsFunction);
    keywordsTable.grantReadData(getHistoricalTrendsFunction);
    providerConfigTable.grantReadData(getHistoricalTrendsFunction);

    // Visibility Metrics API Route
    const visibilityResource = apiResource.addResource('visibility');
    visibilityResource.addMethod('GET', new apigateway.LambdaIntegration(getVisibilityMetricsFunction, integrationOptions), methodOptions);

    // Prompt Insights API Route
    const promptInsightsResource = apiResource.addResource('prompt-insights');
    promptInsightsResource.addMethod('GET', new apigateway.LambdaIntegration(getPromptInsightsFunction, integrationOptions), methodOptions);

    // Citation Gaps API Route
    const citationGapsResource = apiResource.addResource('citation-gaps');
    citationGapsResource.addMethod('GET', new apigateway.LambdaIntegration(getCitationGapsFunction, integrationOptions), methodOptions);

    // Recommendations API Route
    const recommendationsResource = apiResource.addResource('recommendations');
    recommendationsResource.addMethod('GET', new apigateway.LambdaIntegration(getRecommendationsFunction, integrationOptions), methodOptions);

    // Historical Trends API Route
    const trendsResource = apiResource.addResource('trends');
    trendsResource.addMethod('GET', new apigateway.LambdaIntegration(getHistoricalTrendsFunction, integrationOptions), methodOptions);

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
      description: 'API: Content Studio - ideas and content generation',
      environment: {
        DYNAMODB_TABLE_SEARCH_RESULTS: searchResultsTable.tableName,
        DYNAMODB_TABLE_CITATIONS: citationsTable.tableName,
        DYNAMODB_TABLE_CRAWLED_CONTENT: crawledContentTable.tableName,
        DYNAMODB_TABLE_BRAND_CONFIG: brandConfigTable.tableName,
        DYNAMODB_TABLE_CONTENT_STUDIO: contentStudioTable.tableName,
        DYNAMODB_TABLE_KEYWORDS: keywordsTable.tableName,
        GENERATION_TIMEOUT_SECONDS: '240',
      },
    });
    searchResultsTable.grantReadData(contentStudioFunction);
    citationsTable.grantReadData(contentStudioFunction);
    crawledContentTable.grantReadData(contentStudioFunction);
    brandConfigTable.grantReadData(contentStudioFunction);
    contentStudioTable.grantReadWriteData(contentStudioFunction);
    keywordsTable.grantReadData(contentStudioFunction);
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

    // Provider Config Lambda
    const manageProvidersFunction = new lambda.Function(this, 'ManageProvidersFunction', {
      functionName: 'CitationAnalysis-API-ManageProviders',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'manage-providers.handler',
      code: createApiLambdaCode('manage-providers.py'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Manage AI provider configuration',
      environment: {
        PROVIDER_CONFIG_TABLE: providerConfigTable.tableName,
        SECRETS_PREFIX: 'citation-analysis/',
      },
    });
    providerConfigTable.grantReadWriteData(manageProvidersFunction);
    // Grant access to read/write secrets for all providers
    openaiSecret.grantRead(manageProvidersFunction);
    openaiSecret.grantWrite(manageProvidersFunction);
    perplexitySecret.grantRead(manageProvidersFunction);
    perplexitySecret.grantWrite(manageProvidersFunction);
    geminiSecret.grantRead(manageProvidersFunction);
    geminiSecret.grantWrite(manageProvidersFunction);
    claudeSecret.grantRead(manageProvidersFunction);
    claudeSecret.grantWrite(manageProvidersFunction);
    // Grant permission to create new secrets
    manageProvidersFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:PutSecretValue',
        'secretsmanager:GetSecretValue',
      ],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:citation-analysis/*`],
    }));

    // Provider Config API Routes
    const providersResource = apiResource.addResource('providers');
    providersResource.addMethod('GET', new apigateway.LambdaIntegration(manageProvidersFunction, integrationOptions), methodOptions);
    
    const providerIdResource = providersResource.addResource('{id}');
    providerIdResource.addMethod('PUT', new apigateway.LambdaIntegration(manageProvidersFunction, integrationOptions), methodOptions);
    
    const providerValidateResource = providerIdResource.addResource('validate');
    providerValidateResource.addMethod('POST', new apigateway.LambdaIntegration(manageProvidersFunction, integrationOptions), methodOptions);

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
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Manage Cognito users',
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
    // Associate WAF with API Gateway
    // ========================================
    
    // NOTE: WAF association commented out due to CloudFormation timing issues
    // The WAF is created and protects CloudFront, but API Gateway association
    // has caused deployment failures in the past. The API is still protected by:
    // - Cognito authorizer (JWT validation on all endpoints)
    // - Input validation in Lambda functions
    // - CORS restrictions
    // - Rate limiting at API Gateway level
    // 
    // To enable WAF on API Gateway, uncomment and test carefully:
    /*
    const apiStageArn = `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/prod`;
    const apiWafAssociation = new wafv2.CfnWebACLAssociation(this, 'ApiWafAssociation', {
      resourceArn: apiStageArn,
      webAclArn: apiWaf.attrArn,
    });
    apiWafAssociation.addDependency(apiWaf);
    */

    // ========================================
    // Configure CORS with CloudFront Domain
    // ========================================
    
    // Now that we have the CloudFront domain, configure CORS headers
    // This is done via a custom resource or by setting environment variables
    // that Lambda functions use to return proper CORS headers
    const cloudFrontOrigin = `https://${distribution.distributionDomainName}`;

    // SECURITY: Gateway responses use the CloudFront origin instead of wildcard '*'
    // so that auth failure details (401/403) are not observable by arbitrary origins.
    const gatewayResponseCorsHeaders = {
      'Access-Control-Allow-Origin': `'${cloudFrontOrigin}'`,
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
      getStatsFunction, getCitationsFunction, getUrlBreakdownFunction, getSearchesFunction,
      getKeywordsFunction, manageKeywordsFunction, manageQueryPromptsFunction, getBrandMentionsFunction,
      manageBrandConfigFunction, getCrawledContentFunction, triggerAnalysisFunction,
      triggerKeywordAnalysisFunction, getExecutionStatusFunction, manageScheduleFunction,
      browseRawResponsesFunction, keywordResearchFunction, getVisibilityMetricsFunction,
      getPromptInsightsFunction, getCitationGapsFunction, getRecommendationsFunction,
      getHistoricalTrendsFunction, contentStudioFunction, manageProvidersFunction,
      manageUsersFunction
    ];
    
    for (const fn of apiLambdaFunctions) {
      corsOriginParam.grantRead(fn);
      fn.addEnvironment('CORS_ORIGIN_PARAM', corsOriginParam.parameterName);
    }

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

    // WAF Web ACL ARN (API Gateway)
    new cdk.CfnOutput(this, 'WafWebAclArn', {
      value: apiWaf.attrArn,
      description: 'WAF Web ACL ARN protecting API Gateway',
      exportName: 'CitationAnalysis-WafWebAclArn',
    });

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
