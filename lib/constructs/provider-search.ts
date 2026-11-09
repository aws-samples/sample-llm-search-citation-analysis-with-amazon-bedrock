import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { monthLogGroup } from './api-functions';
import { bedrockTierEnv } from './bedrock-invoke';
import { WEB_SEARCH_GATEWAY_URL_PARAMETER, readWebSearchRegion } from './web-search';

/**
 * One search Lambda per provider, called in parallel for every keyword.
 *
 * The analysis workflow used to call every provider one after another inside a
 * single `CitationAnalysis-Search` invocation (~139 s per keyword), and nothing
 * bounded how many keywords hit one provider at once. Each provider now has its
 * own function, and that function's reserved concurrency is the provider's cap
 * on requests in flight across the whole run. A keyword whose provider is at
 * its cap gets `Lambda.TooManyRequestsException` and waits its turn through
 * the Step Functions retrier below, so a low-tier key is queued rather than
 * throttled into failed calls.
 */

type ProviderType = 'llm' | 'search';

export interface SearchProvider {
  /** Provider id as `lambda/search/handler.py` names it in `providers`. */
  readonly id: string;
  readonly type: ProviderType;
  /**
   * Default cap on this provider's requests in flight across all running
   * keywords, sized for our low-tier keys from the 2026-09-30 benchmark (N
   * requests in flight through the repo's own client code).
   */
  readonly defaultConcurrency: number;
  /**
   * Default seconds between two requests to this provider across every slot
   * (`PROVIDER_MIN_INTERVAL_SECONDS`, paced through a shared send-time ledger
   * in the ProviderConfig table — `lambda/shared/provider_pacing.py`). The cap
   * above bounds requests in flight, not how often they start; a per-second or
   * per-minute limit needs this too. Omitted: not paced.
   */
  readonly defaultMinIntervalSeconds?: number;
  /**
   * Every invocation makes a billed call that the handler never retries
   * itself, so the workflow must not re-run a failed invocation either: a
   * crash or timeout after the provider answered would pay again. Only the
   * slot-wait retry (the function never ran) applies. Omitted: retried.
   */
  readonly billedOnce?: boolean;
}

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  // 20 in flight: 20/20 (p50 32 s, p90 57 s). Half the proven level leaves
  // tokens-per-minute headroom when query prompts get longer.
  { id: 'openai', type: 'llm', defaultConcurrency: 10 },
  // Sends `x-ratelimit-limit: 1` (about one request a second). 20 in flight:
  // 11/20 (429s). With the reset-aware 429 waits and 12 extra attempts, 3 and
  // 4 in flight were 20/20 (15 waited-out 429s each) at ~29-32 calls a minute,
  // against ~14 at 1; the 2.28.0 live run at 1 queued keywords ~2 minutes for
  // a slot. 3 keeps most of the gain with the fewest 429s. Three slots sending
  // every ~15 s still met in the same second about one call in five (2.38.1
  // run: 8 refused and retried calls in 30); the 1.1 s interval spaces them.
  { id: 'perplexity', type: 'llm', defaultConcurrency: 3, defaultMinIntervalSeconds: 1.1 },
  // 20 in flight: 20/20 (p50 22 s), same headroom as OpenAI.
  { id: 'gemini', type: 'llm', defaultConcurrency: 10 },
  // Not benchmarked (disabled in our deployment). Anthropic's entry tier has the
  // lowest request and input-token limits of the four, and web_search answers
  // are long, so this starts at half the other answer engines.
  { id: 'claude', type: 'llm', defaultConcurrency: 5 },
  // 20 in flight: 20/20 at ~2 s.
  { id: 'brave', type: 'search', defaultConcurrency: 10 },
  // 20 in flight: 20/20 at ~3 s.
  { id: 'tavily', type: 'search', defaultConcurrency: 10 },
  // 20 in flight: 20/20, but only through 10 throttle retries.
  { id: 'exa', type: 'search', defaultConcurrency: 5 },
  // Async client (submit, then poll the free Search Archive): 5 in flight gave
  // 10/10 with no retries, max 84 s.
  { id: 'serpapi', type: 'search', defaultConcurrency: 5 },
  // ~6 searches per minute on our plan, counted per minute with refused
  // requests included (a 429 reads "Consumed (req/min): 11, Remaining: 0").
  // 2 in flight needed the same 10 throttle retries as 1, so 2 doubles
  // throughput for free; 3 needed 16. The 12 s interval keeps two slots at
  // five searches a minute, so the retries are no longer the pacing.
  { id: 'firecrawl', type: 'search', defaultConcurrency: 2, defaultMinIntervalSeconds: 12 },
  // Amazon Bedrock Web Search through an AgentCore Gateway. Not benchmarked yet.
  { id: 'agentcore', type: 'search', defaultConcurrency: 5 },
];

/**
 * Google AI Overviews through DataForSEO's SERP API (an answer engine: the
 * overview is the answer, its references the citations). Its function
 * `CitationAnalysis-Search-google_ai_overview` lives in the SEO stack
 * (`lib/seo-stack.ts`) because the main stack sits at CloudFormation's
 * 500-resource limit; the main workflow calls it by name (see
 * `readExternalSearchProviders`). Not benchmarked; DataForSEO allows 2,000
 * requests a minute per account, so 5 in flight is about the other paid
 * providers' level rather than a DataForSEO limit.
 */
export const GOOGLE_AI_OVERVIEW_PROVIDER: SearchProvider = {
  id: 'google_ai_overview', type: 'llm', defaultConcurrency: 5, billedOnce: true,
};

/** CDK context flag that adds the {@link GOOGLE_AI_OVERVIEW_PROVIDER} branch to the main workflow. */
const SEO_ENGINE_CONTEXT = 'seoEngine';

/**
 * The providers whose function another stack owns: Google AI Overviews when
 * CDK context `seoEngine` is `true` (`-c seoEngine=true`, or a boolean in
 * cdk.json), none otherwise. Off by default so the workflow never calls a
 * function before the SEO stack that holds it is deployed; a branch whose
 * function is missing fails into a counted failed provider row on every keyword.
 */
export function readExternalSearchProviders(scope: Construct): readonly SearchProvider[] {
  const raw: unknown = scope.node.tryGetContext(SEO_ENGINE_CONTEXT);
  return raw === true || raw === 'true' ? [GOOGLE_AI_OVERVIEW_PROVIDER] : [];
}

/** `CitationAnalysis-Search-<id>`: the name the workflow calls a provider's function by. */
function providerSearchFunctionName(providerId: string): string {
  return `CitationAnalysis-Search-${providerId}`;
}

const PROVIDER_CONCURRENCY_CONTEXT = 'providerConcurrency';
const PROVIDER_PACING_CONTEXT = 'providerPacing';

/**
 * Extra client-side attempts after a 429 in the analysis search path
 * (read by the search clients). A 429 answers in milliseconds, so waiting out a
 * per-minute limit is cheap, and the reserved concurrency above already keeps
 * the provider near its limit rather than far over it.
 */
const PROVIDER_THROTTLE_EXTRA_ATTEMPTS = 12;

/**
 * Attempts to get a slot while a provider is at its cap. Sized for a slow
 * queue: 20 keywords in flight on a cap of 1, where one invocation runs every
 * query prompt (~30 s with a few prompts and their 429 waits), so the last
 * keyword waits ~19 x 30 s ≈ 10 min (the 2.28.0 live run with Perplexity at
 * 1 waited up to 7 min). Retries are not a FIFO queue (each waiting keyword
 * re-polls at a random point), so the budget is 3x the drain, ~30 min: the
 * 2 s x 1.5 backoff reaches the 30 s ceiling after ~8 attempts (~50 s mean
 * with FULL jitter), after which each attempt averages 15 s, so 30 min ≈ 120
 * attempts. Worst case that is ~360 history events per branch, far inside the
 * child execution's 25,000.
 */
const PROVIDER_SLOT_RETRY_ATTEMPTS = 120;

/** Thrown at synth time when `-c providerConcurrency=...` or `-c providerPacing=...` is not usable. */
class InvalidProviderSettingError extends Error {
  constructor(contextKey: string, message: string) {
    super(`CDK context '${contextKey}': ${message}`);
    this.name = 'InvalidProviderSettingError';
  }
}

const KNOWN_PROVIDER_IDS = SEARCH_PROVIDERS.map((provider) => provider.id);

function parseJsonOverride(contextKey: string, raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    throw new InvalidProviderSettingError(contextKey, `must be a JSON object, got ${raw}`);
  }
}

function parseOverrideObject(contextKey: string, raw: unknown): Record<string, unknown> {
  const parsed = typeof raw === 'string' ? parseJsonOverride(contextKey, raw) : raw;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidProviderSettingError(contextKey, `must be a JSON object, got ${JSON.stringify(raw)}`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function knownProvider(contextKey: string, providerId: string): void {
  if (!KNOWN_PROVIDER_IDS.includes(providerId)) {
    throw new InvalidProviderSettingError(
      contextKey, `unknown provider '${providerId}' (known: ${KNOWN_PROVIDER_IDS.join(', ')})`
    );
  }
}

function validatedCap(providerId: string, value: unknown): number {
  knownProvider(PROVIDER_CONCURRENCY_CONTEXT, providerId);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InvalidProviderSettingError(
      PROVIDER_CONCURRENCY_CONTEXT, `'${providerId}' must be a positive integer, or 0 for no cap, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function validatedInterval(providerId: string, value: unknown): number {
  knownProvider(PROVIDER_PACING_CONTEXT, providerId);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidProviderSettingError(
      PROVIDER_PACING_CONTEXT, `'${providerId}' must be a number of seconds >= 0 (0 for no pacing), got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/** The per-provider defaults of `pick`, overridden by the JSON object in CDK context `contextKey` (validated by `validate`). */
function readProviderSettings(
  scope: Construct,
  contextKey: string,
  pick: (provider: SearchProvider) => number,
  validate: (providerId: string, value: unknown) => number,
): ReadonlyMap<string, number> {
  const settings = new Map(SEARCH_PROVIDERS.map((provider) => [provider.id, pick(provider)]));
  const raw: unknown = scope.node.tryGetContext(contextKey);
  if (raw === undefined || raw === null || raw === '') {
    return settings;
  }
  for (const [providerId, value] of Object.entries(parseOverrideObject(contextKey, raw))) {
    settings.set(providerId, validate(providerId, value));
  }
  return settings;
}

/**
 * The per-provider caps: the defaults above, overridden per deployment with
 * `-c providerConcurrency='{"perplexity":5,"firecrawl":10}'` (a JSON string on
 * the command line, or an object in cdk.json) once a paid plan allows more.
 * `0` means no cap (no reserved concurrency). Unknown ids and values that are
 * not whole numbers >= 0 fail synth rather than silently keep a default.
 *
 * Reserved concurrency comes out of the account's Lambda concurrency limit,
 * and Lambda refuses a deploy that leaves fewer than 100 unreserved. The
 * defaults reserve 58 (plus 20 for the Content Studio workers) of the usual
 * 1,000. A new account with a low limit must lower these caps, or set them to
 * 0, and raise the limit through Service Quotas before running at scale.
 */
export function readProviderConcurrency(scope: Construct): ReadonlyMap<string, number> {
  return readProviderSettings(scope, PROVIDER_CONCURRENCY_CONTEXT, (provider) => provider.defaultConcurrency, validatedCap);
}

/**
 * The seconds between two requests to each provider across every slot: the
 * defaults above (0 for a provider without one), overridden per deployment with
 * `-c providerPacing='{"perplexity":0,"firecrawl":6}'` once a paid plan allows
 * more. `0` means no pacing. Unknown ids and negative or non-numeric values
 * fail synth.
 */
export function readProviderPacing(scope: Construct): ReadonlyMap<string, number> {
  return readProviderSettings(
    scope, PROVIDER_PACING_CONTEXT, (provider) => provider.defaultMinIntervalSeconds ?? 0, validatedInterval
  );
}

/** The names a provider search function's environment carries (`providerSearchEnvironment`). */
export interface ProviderSearchResourceNames {
  readonly searchResultsTable: string;
  readonly brandConfigTable: string;
  readonly providerConfigTable: string;
  readonly rawResponsesBucket: string;
}

/**
 * The environment every provider search function shares (`lambda/search/handler.py`
 * reads it): the tables and bucket it writes, the secrets prefix, the Web
 * Search gateway location and the Bedrock tiers of brand extraction.
 */
export function providerSearchEnvironment(scope: Construct, names: ProviderSearchResourceNames): Record<string, string> {
  return {
    DYNAMODB_TABLE_SEARCH_RESULTS: names.searchResultsTable,
    DYNAMODB_TABLE_BRAND_CONFIG: names.brandConfigTable,
    DYNAMODB_TABLE_PROVIDER_CONFIG: names.providerConfigTable,
    SECRETS_PREFIX: 'citation-analysis/',
    RAW_RESPONSES_BUCKET: names.rawResponsesBucket,
    WEB_SEARCH_REGION: readWebSearchRegion(scope),
    WEB_SEARCH_GATEWAY_URL_PARAMETER,
    ...bedrockTierEnv,
  };
}

/** What one provider search function is built from. */
export interface ProviderFunctionProps {
  /** Everything the provider functions share with the single search Lambda they replace. */
  readonly code: lambda.Code;
  readonly role: iam.IRole;
  readonly layers: lambda.ILayerVersion[];
  /** From {@link providerSearchEnvironment}. */
  readonly environment: Record<string, string>;
}

export interface ProviderSearchProps extends ProviderFunctionProps {
  /** From {@link readProviderConcurrency}. */
  readonly concurrency: ReadonlyMap<string, number>;
  /** From {@link readProviderPacing}. */
  readonly pacing: ReadonlyMap<string, number>;
  /**
   * Providers whose `CitationAnalysis-Search-<id>` function another stack
   * owns (from {@link readExternalSearchProviders}): the workflow gets their
   * branch, called by function name, and this construct creates no resource for them.
   */
  readonly externalProviders?: readonly SearchProvider[];
}

interface ProviderFunction {
  readonly provider: SearchProvider;
  readonly label: string;
  readonly handler: lambda.IFunction;
}

function constructLabel(providerId: string): string {
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

/** The row a provider contributes when its Lambda failed after every retry. */
function failedProviderResult(provider: SearchProvider): Record<string, unknown> {
  return {
    provider: provider.id,
    provider_type: provider.type,
    status: 'error',
    error: 'provider Lambda failed',
    citations: [],
    citation_count: 0,
    query_prompt_id: 'default',
  };
}

/** A provider function's cap on calls in flight (0 = no cap) and seconds between calls (0 = not paced). */
interface ProviderLimits {
  readonly cap: number;
  readonly interval: number;
}

/**
 * `CitationAnalysis-Search-<id>`: the `lambda/search` handler for one
 * provider, with its own 30-day log group and reserved concurrency. Built by
 * {@link ProviderSearch} for the main stack's providers and by the SEO stack
 * for {@link GOOGLE_AI_OVERVIEW_PROVIDER}. The construct ids are
 * `<label>LogGroup` and `<label>Function` under `scope`.
 */
export function providerSearchFunction(
  scope: Construct,
  provider: SearchProvider,
  props: ProviderFunctionProps,
  limits: ProviderLimits,
  label: string = constructLabel(provider.id),
): lambda.Function {
  const functionName = providerSearchFunctionName(provider.id);
  const logGroup = monthLogGroup(scope, `${label}LogGroup`, `/aws/lambda/${functionName}`, cdk.RemovalPolicy.DESTROY);
  const { cap, interval } = limits;
  // Only a paced provider carries the interval; the search handler reads it per request.
  const pacingEnvironment: Record<string, string> = interval > 0
    ? {
      PROVIDER_MIN_INTERVAL_SECONDS: String(interval),
    }
    : {};

  return new lambda.Function(scope, `${label}Function`, {
    functionName,
    runtime: lambda.Runtime.PYTHON_3_12,
    handler: 'handler.handler',
    code: props.code,
    role: props.role,
    layers: props.layers,
    timeout: cdk.Duration.seconds(900), // 15 min max — invoked by Step Functions, not API Gateway
    memorySize: 512,
    description: `Query ${provider.id} with web search for one keyword; reserved concurrency caps its calls in flight`,
    logGroup,
    // 0 = no cap: the function draws on the account's unreserved pool.
    reservedConcurrentExecutions: cap === 0 ? undefined : cap,
    environment: {
      ...props.environment,
      PROVIDER_THROTTLE_EXTRA_ATTEMPTS: String(PROVIDER_THROTTLE_EXTRA_ATTEMPTS),
      ...pacingEnvironment,
    },
  });
}

/**
 * The ten `CitationAnalysis-Search-<id>` functions and the workflow states
 * that call them, plus a branch per external provider whose function another
 * stack owns (looked up by name, no resource here).
 */
export class ProviderSearch extends Construct {
  private readonly providerFunctions: ProviderFunction[];

  constructor(scope: Construct, id: string, props: ProviderSearchProps) {
    super(scope, id);
    const ownFunctions = SEARCH_PROVIDERS.map((provider) => {
      const label = constructLabel(provider.id);
      return { provider, label, handler: this.providerFunction(provider, label, props) };
    });
    const externalFunctions = (props.externalProviders ?? []).map((provider) => {
      const label = constructLabel(provider.id);
      const handler = lambda.Function.fromFunctionName(
        this, `${label}ExternalFunction`, providerSearchFunctionName(provider.id)
      );
      return { provider, label, handler };
    });
    this.providerFunctions = [...ownFunctions, ...externalFunctions];
  }

  /**
   * `SearchAllProviders` (a Parallel, one branch per provider; the name is kept
   * so execution status mapping still recognises it) followed by
   * `MergeProviderResults`, which flattens the branches' `results` into the one
   * `{keyword, timestamp, results}` list DeduplicateCitations reads.
   * `$.provider_results[*].results[*]` was proven with
   * `aws stepfunctions test-state` to flatten, including when some or all
   * branches are empty (a disabled provider returns no rows).
   */
  searchAllProviders(): stepfunctions.Chain {
    const parallel = new stepfunctions.Parallel(this, 'SearchAllProviders', {
      stateName: 'SearchAllProviders',
      resultPath: '$.provider_results',
    });
    for (const providerFunction of this.providerFunctions) {
      parallel.branch(this.providerBranch(providerFunction));
    }
    const merge = new stepfunctions.Pass(this, 'MergeProviderResults', {
      stateName: 'MergeProviderResults',
      parameters: {
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'results.$': '$.provider_results[*].results[*]',
      },
    });
    return stepfunctions.Chain.start(parallel).next(merge);
  }

  private providerFunction(provider: SearchProvider, label: string, props: ProviderSearchProps): lambda.Function {
    return providerSearchFunction(this, provider, props, {
      cap: props.concurrency.get(provider.id) ?? provider.defaultConcurrency,
      interval: props.pacing.get(provider.id) ?? provider.defaultMinIntervalSeconds ?? 0,
    }, label);
  }

  private providerBranch({ provider, label, handler }: ProviderFunction): stepfunctions.IChainable {
    const invoke = new tasks.LambdaInvoke(this, `${label}Search`, {
      stateName: `Search-${provider.id}`,
      lambdaFunction: handler,
      payload: stepfunctions.TaskInput.fromObject({
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'query_prompts.$': '$.query_prompts',
        // The keyword's market (or null); the search Lambda re-validates it.
        'market.$': '$.market',
        providers: [provider.id],
      }),
      // Only the slim results survive into the Parallel output.
      resultSelector: { 'results.$': '$.Payload.results' },
      retryOnServiceExceptions: true,
    });

    // The provider is at its cap: wait for a slot. Must come before the
    // States.TaskFailed retrier, which also matches this error and would give
    // up after two attempts.
    invoke.addRetry({
      errors: ['Lambda.TooManyRequestsException'],
      interval: cdk.Duration.seconds(2),
      backoffRate: 1.5,
      maxDelay: cdk.Duration.seconds(30),
      jitterStrategy: stepfunctions.JitterType.FULL,
      maxAttempts: PROVIDER_SLOT_RETRY_ATTEMPTS,
    });
    // The invocation ran out of its 900 s before every query prompt was
    // answered (each prompt's answers are stored as it finishes, and a retry
    // skips stored prompts, so nothing is asked twice). Re-invoke at once to
    // continue; one invocation always answers at least one prompt, so ten
    // attempts cover the ten-prompt cap (MAX_QUERY_PROMPTS_PER_RUN). Must come
    // before the States.TaskFailed retrier, which would match it too.
    // Lambda-level failures only: the clients retry their own HTTP errors.
    // A billed-once provider asks one prompt per keyword, so it never runs
    // out of time between prompts, and its failed run goes straight to the
    // catch below.
    if (provider.billedOnce !== true) {
      invoke.addRetry({
        errors: ['SearchTimeBudgetSpentError'],
        interval: cdk.Duration.seconds(1),
        backoffRate: 1,
        maxAttempts: 10,
      });
      invoke.addRetry({
        errors: ['States.TaskFailed', 'States.Timeout'],
        interval: cdk.Duration.seconds(10),
        maxAttempts: 2,
        backoffRate: 2.0,
      });
    }
    // A provider that still fails is counted as a failed call in the run
    // summary instead of failing the keyword and every other provider's answer.
    invoke.addCatch(
      new stepfunctions.Pass(this, `${label}SearchFailed`, {
        stateName: `SearchFailed-${provider.id}`,
        result: stepfunctions.Result.fromObject({ results: [failedProviderResult(provider)] }),
      }),
      { errors: ['States.ALL'] }
    );
    return invoke;
  }
}
