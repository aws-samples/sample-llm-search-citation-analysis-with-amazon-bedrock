import {
  describe, expect, it
} from 'vitest';
import { isSentimentExamplesResponse } from './sentimentExamples';
import {
  buildSentimentExamplesResponse, REJECTED_SENTIMENT_EXAMPLES_BODIES, SPARSE_SENTIMENT_EXAMPLES
} from './sentimentExamples-fixtures';

describe('isSentimentExamplesResponse', () => {
  it('accepts the examples the API answers', () => {
    expect(isSentimentExamplesResponse(buildSentimentExamplesResponse())).toBe(true);
  });

  it('accepts examples of every engine whose optional details are null', () => {
    expect(isSentimentExamplesResponse(SPARSE_SENTIMENT_EXAMPLES)).toBe(true);
  });

  it('accepts an answer without examples', () => {
    expect(isSentimentExamplesResponse(buildSentimentExamplesResponse({
      total: 0,
      examples: [],
    }))).toBe(true);
  });

  it.each(['positive', 'neutral', 'mixed', 'negative'] as const)('accepts the %s sentiment', (sentiment) => {
    expect(isSentimentExamplesResponse(buildSentimentExamplesResponse({ sentiment }))).toBe(true);
  });

  it.each(REJECTED_SENTIMENT_EXAMPLES_BODIES)('rejects %s', (_description, body) => {
    expect(isSentimentExamplesResponse(body)).toBe(false);
  });
});
