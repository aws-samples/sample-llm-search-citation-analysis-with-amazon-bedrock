import {
  describe, expect, it
} from 'vitest';
import {
  credentialProviderName, PROVIDER, PROVIDER_DESCRIPTIONS, providerColor, providerName
} from './providers';

describe('provider constants', () => {
  it('lists Google AI Overviews among the AI engines', () => {
    expect(Object.values(PROVIDER)).toStrictEqual(['openai', 'perplexity', 'gemini', 'claude', 'google_ai_overview']);
  });

  it('names the Google AI Overviews engine', () => {
    expect(providerName('google_ai_overview')).toBe('Google AI Overviews');
  });

  it('describes the Google AI Overviews engine as the overview on a Google results page', () => {
    expect(PROVIDER_DESCRIPTIONS.google_ai_overview).toBe('The AI Overview on a Google results page (via DataForSEO)');
  });

  it('gives Google AI Overviews a colour no other engine uses', () => {
    const colours = Object.values(PROVIDER).map((provider) => providerColor(provider)?.rgb);

    expect(new Set(colours).size).toBe(colours.length);
  });

  it('names the DataForSEO credential', () => {
    expect(credentialProviderName('dataforseo')).toBe('DataForSEO');
  });

  it('falls back to the engine name for a provider that is not a credential', () => {
    expect(credentialProviderName('openai')).toBe('OpenAI');
  });
});
