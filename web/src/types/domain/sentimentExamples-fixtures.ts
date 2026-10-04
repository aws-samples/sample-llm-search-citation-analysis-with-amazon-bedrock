import type {
  SentimentExample, SentimentExamplesResponse
} from './sentimentExamples';

/**
 * Payloads of `GET /visibility/sentiment-examples` for the specs: one
 * negative OpenAI sighting of Hotel Sol for "hotel coruna spa", unless
 * overridden.
 */

const EXAMPLE_ANSWER = '## Spa hotels\n\nHotel Sol is **cheaper**, but guests often mention that the rooms at Hotel Sol feel dated.';

export function buildSentimentExample(overrides: Partial<SentimentExample> = {}): SentimentExample {
  return {
    keyword: 'hotel coruna spa',
    provider: 'openai',
    persona: 'default',
    persona_name: 'Default',
    timestamp: '2026-09-28T10:00:00.000000Z',
    brand: 'Hotel Sol',
    rank: 3,
    sentiment: 'negative',
    quote: 'Guests often mention that the rooms at Hotel Sol feel dated.',
    reason: 'The answer warns about dated rooms.',
    ranking_context: 'mentioned as a cheaper but dated option',
    answer: EXAMPLE_ANSWER,
    answer_truncated: false,
    ...overrides,
  };
}

export function buildSentimentExamplesResponse(overrides: Partial<SentimentExamplesResponse> = {}): SentimentExamplesResponse {
  return {
    scope: {
      kind: 'group',
      label: 'Hotel Sol',
      keyword_count: 2,
    },
    keywords_truncated: false,
    sentiment: 'negative',
    provider: 'openai',
    total: 1,
    examples: [buildSentimentExample()],
    ...overrides,
  };
}

/** A body the guard must accept: every nullable field null, every engine. */
export const SPARSE_SENTIMENT_EXAMPLES = buildSentimentExamplesResponse({
  provider: null,
  examples: [buildSentimentExample({
    persona_name: null,
    rank: null,
    quote: null,
    reason: null,
    ranking_context: null,
  })],
});

const VALID = buildSentimentExamplesResponse();

/** Bodies the guard must reject, each wrong in one field. */
export const REJECTED_SENTIMENT_EXAMPLES_BODIES: ReadonlyArray<[description: string, body: unknown]> = [
  ['a null body', null],
  ['a list', []],
  ['a body without its scope', {
    ...VALID,
    scope: null,
  }],
  ['a keywords-truncated flag that is not a boolean', {
    ...VALID,
    keywords_truncated: 'no',
  }],
  ['an unknown sentiment', {
    ...VALID,
    sentiment: 'angry',
  }],
  ['a provider that is not a string', {
    ...VALID,
    provider: 7,
  }],
  ['a total that is not a number', {
    ...VALID,
    total: '1',
  }],
  ['examples that are not a list', {
    ...VALID,
    examples: {},
  }],
  ['an example that is not an object', {
    ...VALID,
    examples: ['Hotel Sol'],
  }],
  ...([
    ['keyword', 1],
    ['provider', null],
    ['persona', null],
    ['timestamp', 0],
    ['brand', null],
    ['answer', null],
    ['persona_name', 2],
    ['quote', 3],
    ['reason', false],
    ['ranking_context', 4],
    ['rank', '3'],
    ['sentiment', 'Negative'],
    ['answer_truncated', 'false'],
  ] as const).map(([field, value]): [string, unknown] => [`an example whose ${field} is ${JSON.stringify(value)}`, {
    ...VALID,
    examples: [{
      ...buildSentimentExample(),
      [field]: value,
    }],
  }]),
];
