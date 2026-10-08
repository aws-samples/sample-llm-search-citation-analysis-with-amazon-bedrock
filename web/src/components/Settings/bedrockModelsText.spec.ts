import {
  describe, expect, it
} from 'vitest';
import {
  describeTestResult, describeTierUse, modelName
} from './bedrockModelsText';
import {
  BEDROCK_MODEL_OPTIONS, SONNET_5_5, buildPassedTest
} from '../../api/bedrockModels-fixtures';

describe('describeTierUse', () => {
  it('names a single role without a list', () => {
    expect(describeTierUse(['generation'])).toBe('Used for Content Studio.');
  });

  it('spells out a role it has no words for', () => {
    expect(describeTierUse(['query_rewriting'])).toBe('Used for query rewriting.');
  });
});

describe('modelName', () => {
  it('names a listed model', () => {
    expect(modelName(BEDROCK_MODEL_OPTIONS, SONNET_5_5)).toBe('Claude Sonnet 5.5');
  });

  it('falls back to the id of a model the account does not list', () => {
    expect(modelName(BEDROCK_MODEL_OPTIONS, 'global.anthropic.claude-legacy')).toBe('global.anthropic.claude-legacy');
  });
});

describe('describeTestResult', () => {
  it.each([
    [1_500_000, 'Works · 412 ms · 1.5M tokens/min'],
    [400_000, 'Works · 412 ms · 400K tokens/min'],
    [800, 'Works · 412 ms · 800 tokens/min'],
  ])('writes a quota of %d tokens per minute compactly', (tokensPerMinute, sentence) => {
    expect(describeTestResult(buildPassedTest({ tokens_per_minute: tokensPerMinute }))).toBe(sentence);
  });

  it('says the quota is still being read while the first reading is under way', () => {
    expect(describeTestResult(buildPassedTest({ complete: false }))).toBe('Works · 412 ms · quota still being read');
  });

  it('says the quota was not reported once every quota has been read', () => {
    expect(describeTestResult(buildPassedTest({ complete: true }))).toBe('Works · 412 ms · quota not reported');
  });

  it('says the quota was not reported when the test carries none', () => {
    expect(describeTestResult(buildPassedTest(null))).toBe('Works · 412 ms · quota not reported');
  });

  it('falls back to a generic sentence for an error without a message', () => {
    expect(describeTestResult({
      valid: false,
      model: SONNET_5_5,
      reason: 'error',
      error: null,
    })).toBe('The test failed.');
  });
});
