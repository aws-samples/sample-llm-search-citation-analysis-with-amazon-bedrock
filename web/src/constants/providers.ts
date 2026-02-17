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

/** List of all supported providers (for iteration) */
export const PROVIDERS: ProviderId[] = [
  PROVIDER.OPENAI,
  PROVIDER.PERPLEXITY,
  PROVIDER.GEMINI,
  PROVIDER.CLAUDE,
];

/** Provider display names */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'OpenAI',
  [PROVIDER.PERPLEXITY]: 'Perplexity',
  [PROVIDER.GEMINI]: 'Google Gemini',
  [PROVIDER.CLAUDE]: 'Anthropic Claude',
};

/** Provider descriptions */
export const PROVIDER_DESCRIPTIONS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'GPT-5.2 with native web search',
  [PROVIDER.PERPLEXITY]: 'Sonar model with real-time web search',
  [PROVIDER.GEMINI]: 'Gemini Flash with Google Search grounding',
  [PROVIDER.CLAUDE]: 'Claude Sonnet with web search tool',
};

/** Provider documentation URLs */
export const PROVIDER_DOCS_URLS: Record<ProviderId, string> = {
  [PROVIDER.OPENAI]: 'https://platform.openai.com/api-keys',
  [PROVIDER.PERPLEXITY]: 'https://www.perplexity.ai/settings/api',
  [PROVIDER.GEMINI]: 'https://aistudio.google.com/apikey',
  [PROVIDER.CLAUDE]: 'https://console.anthropic.com/settings/keys',
};
