/**
 * Centralized AI provider constants.
 * Single source of truth for provider identifiers across the frontend.
 */

/** AI provider identifiers */
export const PROVIDER = {
  OPENAI: 'openai',
  PERPLEXITY: 'perplexity',
  GEMINI: 'gemini',
  CLAUDE: 'claude',
  GOOGLE_AI_OVERVIEW: 'google_ai_overview',
} as const;

/** Type for provider identifier values */
export type ProviderId = typeof PROVIDER[keyof typeof PROVIDER];

/** Provider display names */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'OpenAI',
  [PROVIDER.PERPLEXITY]: 'Perplexity',
  [PROVIDER.GEMINI]: 'Google Gemini',
  [PROVIDER.CLAUDE]: 'Anthropic Claude',
  [PROVIDER.GOOGLE_AI_OVERVIEW]: 'Google AI Overviews',
};

/** Provider descriptions */
export const PROVIDER_DESCRIPTIONS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'Native web search via the Responses API',
  [PROVIDER.PERPLEXITY]: 'Sonar model with real-time web search',
  [PROVIDER.GEMINI]: 'Google Search grounding',
  [PROVIDER.CLAUDE]: 'Claude Sonnet with web search tool',
  [PROVIDER.GOOGLE_AI_OVERVIEW]: 'The AI Overview on a Google results page (via DataForSEO)',
};

/** Provider documentation URLs */
export const PROVIDER_DOCS_URLS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'https://platform.openai.com/api-keys',
  [PROVIDER.PERPLEXITY]: 'https://www.perplexity.ai/settings/api',
  [PROVIDER.GEMINI]: 'https://aistudio.google.com/apikey',
  [PROVIDER.CLAUDE]: 'https://console.anthropic.com/settings/keys',
  [PROVIDER.GOOGLE_AI_OVERVIEW]: 'https://app.dataforseo.com/api-access',
};

function isProviderId(provider: string): provider is ProviderId {
  return Object.keys(PROVIDER_NAMES).includes(provider);
}

/** Display names of the web-search providers, which add cited links but write no answer (not counted in the KPIs). */
const SEARCH_PROVIDER_NAMES: ReadonlyMap<string, string> = new Map([
  ['brave', 'Brave Search'],
  ['tavily', 'Tavily'],
  ['exa', 'Exa'],
  ['serpapi', 'SerpAPI'],
  ['firecrawl', 'Firecrawl'],
  ['agentcore', 'Amazon Bedrock Web Search'],
]);

/** A provider's display name ("OpenAI", "Brave Search"), or its id for a provider the dashboard does not know. */
export function providerName(provider: string): string {
  if (isProviderId(provider)) return PROVIDER_NAMES[provider];
  return SEARCH_PROVIDER_NAMES.get(provider) ?? provider;
}

interface ProviderColor {
  /** The provider's chart colour as `r, g, b`, for `rgb()` / `rgba()`. */
  rgb: string;
  /** Badge classes: neutral grey with the engine name (the hue is for charts only). */
  badge: string;
}

/** One hue per provider, so charts and badges agree on which colour is which engine. */
const PROVIDER_COLORS: Record<ProviderId, ProviderColor> = {
  [PROVIDER.OPENAI]: {
    rgb: '16, 185, 129',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
  [PROVIDER.PERPLEXITY]: {
    rgb: '249, 115, 22',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
  [PROVIDER.GEMINI]: {
    rgb: '59, 130, 246',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
  [PROVIDER.CLAUDE]: {
    rgb: '168, 85, 247',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
  // cyan-500: a hue no other engine, brand or sentiment series uses.
  [PROVIDER.GOOGLE_AI_OVERVIEW]: {
    rgb: '6, 182, 212',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
};

/** The colour of a known provider; `undefined` for one the dashboard does not know. */
export function providerColor(provider: string): ProviderColor | undefined {
  return isProviderId(provider) ? PROVIDER_COLORS[provider] : undefined;
}

/** The provider types of `GET /providers`: answer engines, search providers, and SEO data credentials (neither). */
export type ProviderType = 'llm' | 'search' | 'seo';

/** The credential provider whose key the Google AI Overviews engine uses. */
export const DATAFORSEO_PROVIDER_ID = 'dataforseo';

/** Display names of the providers that are a credential rather than an engine. */
const CREDENTIAL_PROVIDER_NAMES: ReadonlyMap<string, string> = new Map([[DATAFORSEO_PROVIDER_ID, 'DataForSEO']]);

/** The name of the provider whose key another one borrows ("DataForSEO"), else `providerName`. */
export function credentialProviderName(provider: string): string {
  return CREDENTIAL_PROVIDER_NAMES.get(provider) ?? providerName(provider);
}

/** Whether a provider row is authenticated by IAM (no API key to store); a row without `auth` uses a key. */
export function usesIamAuth(provider: { readonly auth?: string }): boolean {
  return provider.auth === 'iam';
}
