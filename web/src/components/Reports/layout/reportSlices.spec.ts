import {
  describe, expect, it
} from 'vitest';
import { headlineSlice } from './reportSlices';
import { SETTLED_VISIBILITY_AND_TRENDS as SETTLED } from './reportPayload-fixtures';

describe('headlineSlice', () => {
  it.each([
    ['only the visibility request is in flight', { visibilityLoading: true }, true],
    ['only the trends request is in flight', { trendsLoading: true }, true],
    ['both requests have settled', {}, false],
  ])('reports loading %s when %s', (_condition, overrides, loading) => {
    expect(headlineSlice({
      ...SETTLED,
      ...overrides,
    }).loading).toBe(loading);
  });

  it.each([
    ['the visibility error when only visibility failed', { visibilityError: 'Visibility failed' }, 'Visibility failed'],
    ['the trends error when only trends failed', { trendsError: 'Trends failed' }, 'Trends failed'],
    ['the visibility error when both failed', {
      visibilityError: 'Visibility failed',
      trendsError: 'Trends failed',
    }, 'Visibility failed'],
    ['no error when neither failed', {}, null],
  ])('reports %s', (_condition, overrides, error) => {
    expect(headlineSlice({
      ...SETTLED,
      ...overrides,
    }).error).toBe(error);
  });
});
