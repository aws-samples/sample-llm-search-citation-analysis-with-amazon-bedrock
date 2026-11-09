import {
  describe, expect, it
} from 'vitest';
import { buildKeyword } from '../../api/keywordGroups-fixtures';
import {
  EVERY_KEYWORD_RUN, describeRun, runKeywordCount, runSelectionScope
} from './runSelection';

const KEYWORDS = [
  buildKeyword({
    id: 'k-1',
    keyword: 'hoteles en santiago',
    market_id: 'cl-es',
    group_ids: ['g-sol', 'g-mar'],
  }),
  buildKeyword({
    id: 'k-2',
    keyword: 'hotels in santiago',
    group_ids: ['g-sol'],
  }),
  buildKeyword({
    id: 'k-3',
    keyword: 'hotels in lima',
    group_ids: [],
  }),
];

describe('runSelectionScope', () => {
  it('sends no scope for every keyword in every market', () => {
    expect(runSelectionScope(EVERY_KEYWORD_RUN)).toBeUndefined();
  });

  it.each([
    [{ marketIds: ['cl-es'] }, {
      mode: 'all',
      market_ids: ['cl-es'],
    }],
    [{
      mode: 'groups' as const,
      groupIds: ['g-sol'],
    }, {
      mode: 'groups',
      group_ids: ['g-sol'],
    }],
    [{
      mode: 'keywords' as const,
      keywordIds: ['k-1'],
      marketIds: ['cl-es'],
    }, {
      mode: 'keywords',
      keyword_ids: ['k-1'],
      market_ids: ['cl-es'],
    }],
  ])('sends the scope of %o', (overrides, scope) => {
    expect(runSelectionScope({
      ...EVERY_KEYWORD_RUN,
      ...overrides,
    })).toStrictEqual(scope);
  });
});

describe('runKeywordCount', () => {
  it.each([
    ['every keyword', {}, 3],
    ['every keyword of a market', { marketIds: ['global'] }, 2],
    ['each member of the picked groups once', {
      mode: 'groups' as const,
      groupIds: ['g-sol', 'g-mar'],
    }, 2],
    ['group members of the ticked market only', {
      mode: 'groups' as const,
      groupIds: ['g-sol'],
      marketIds: ['cl-es'],
    }, 1],
    ['the picked keywords', {
      mode: 'keywords' as const,
      keywordIds: ['k-2', 'k-3'],
    }, 2],
  ])('counts %s', (_description, overrides, count) => {
    expect(runKeywordCount({
      ...EVERY_KEYWORD_RUN,
      ...overrides,
    }, KEYWORDS)).toBe(count);
  });
});

describe('describeRun', () => {
  it.each([
    [83, [], '83 active keywords in every market'],
    [1, ['Chile (Spanish)', 'No market'], '1 active keyword in Chile (Spanish), No market'],
  ])('describes %i keywords in %o', (count, markets, text) => {
    expect(describeRun(count, markets)).toBe(text);
  });
});
