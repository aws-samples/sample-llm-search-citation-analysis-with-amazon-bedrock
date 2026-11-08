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

/** A provider's display name ("OpenAI"), or its id for a provider the dashboard does not know. */
export function providerName(provider: string): string {
  return isProviderId(provider) ? PROVIDER_NAMES[provider] : provider;
}

interface ProviderColor {
  /** The provider's chart colour as `r, g, b`, for `rgb()` / `rgba()`. */
  rgb: string;
  /** Tinted badge classes in the same hue. */
  badge: string;
}

/** One hue per provider, so charts and badges agree on which colour is which engine. */
const PROVIDER_COLORS: Record<ProviderId, ProviderColor> = {
  [PROVIDER.OPENAI]: {
    rgb: '16, 185, 129',
    badge: 'bg-green-100 text-green-800',
  },
  [PROVIDER.PERPLEXITY]: {
    rgb: '249, 115, 22',
    badge: 'bg-orange-100 text-orange-800',
  },
  [PROVIDER.GEMINI]: {
    rgb: '59, 130, 246',
    badge: 'bg-blue-100 text-blue-800',
  },
  [PROVIDER.CLAUDE]: {
    rgb: '168, 85, 247',
    badge: 'bg-purple-100 text-purple-800',
  },
  // cyan-500: a hue no other engine, brand or sentiment series uses.
  [PROVIDER.GOOGLE_AI_OVERVIEW]: {
    rgb: '6, 182, 212',
    badge: 'bg-cyan-100 text-cyan-800',
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
