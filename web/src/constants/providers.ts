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
} as const;

/** Type for provider identifier values */
export type ProviderId = typeof PROVIDER[keyof typeof PROVIDER];

/** Provider display names */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'OpenAI',
  [PROVIDER.PERPLEXITY]: 'Perplexity',
  [PROVIDER.GEMINI]: 'Google Gemini',
  [PROVIDER.CLAUDE]: 'Anthropic Claude',
};

/** Provider descriptions */
export const PROVIDER_DESCRIPTIONS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'Native web search via the Responses API',
  [PROVIDER.PERPLEXITY]: 'Sonar model with real-time web search',
  [PROVIDER.GEMINI]: 'Google Search grounding',
  [PROVIDER.CLAUDE]: 'Claude Sonnet with web search tool',
};

/** Provider documentation URLs */
export const PROVIDER_DOCS_URLS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'https://platform.openai.com/api-keys',
  [PROVIDER.PERPLEXITY]: 'https://www.perplexity.ai/settings/api',
  [PROVIDER.GEMINI]: 'https://aistudio.google.com/apikey',
  [PROVIDER.CLAUDE]: 'https://console.anthropic.com/settings/keys',
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
};

/** The colour of a known provider; `undefined` for one the dashboard does not know. */
export function providerColor(provider: string): ProviderColor | undefined {
  return isProviderId(provider) ? PROVIDER_COLORS[provider] : undefined;
}
