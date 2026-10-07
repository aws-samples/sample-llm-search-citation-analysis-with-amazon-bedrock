import type {
  InsightsNarrative, NarrativeInsight, NarrativeRecommendation
} from './insightsNarrative';

/** The stored narrative of the airline group's run, written in Spanish, one item dropped by the validator. */
export function buildNarrative(overrides: Partial<InsightsNarrative> = {}): InsightsNarrative {
  return {
    run_timestamp: '2026-10-07T06:50:33.235274Z',
    model: 'global.anthropic.claude-sonnet-4-6',
    generated_at: '2026-10-07T06:55:12.000000Z',
    language: 'es',
    insights: [buildNarrativeInsight()],
    recommendations: [buildNarrativeRecommendation()],
    dropped: 1,
    ...overrides,
  };
}

export function buildNarrativeInsight(overrides: Partial<NarrativeInsight> = {}): NarrativeInsight {
  return {
    text: 'OpenAI sitúa a Aurora Airways primero en solo el 40% de las respuestas.',
    insight_ids: ['engine_play:openai'],
    ...overrides,
  };
}

export function buildNarrativeRecommendation(overrides: Partial<NarrativeRecommendation> = {}): NarrativeRecommendation {
  return {
    title: 'Ganar el primer puesto en OpenAI',
    text: 'Publicar comparativas de tarifas que OpenAI pueda citar.',
    insight_ids: ['engine_play:openai', 'weak_subbrand:Aurora Miles'],
    ...overrides,
  };
}
