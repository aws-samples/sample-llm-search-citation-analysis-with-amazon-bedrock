import {
  describe, expect, it
} from 'vitest';
import { isGroupKpiHistoryResponse } from './groupKpiHistory';
import {
  buildHistory, buildKeywordHistory, buildRun
} from '../../components/Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

describe('isGroupKpiHistoryResponse', () => {
  it('accepts the history the API answers', () => {
    expect(isGroupKpiHistoryResponse(buildHistory())).toBe(true);
  });

  it('accepts a history without runs or keywords', () => {
    expect(isGroupKpiHistoryResponse(buildHistory({
      runs: [],
      keywords: [] 
    }))).toBe(true);
  });

  it.each([
    ['nothing', null],
    ['an array', []],
    ['no scope', {
      ...buildHistory(),
      scope: null 
    }],
    ['runs that are not a list', {
      ...buildHistory(),
      runs: {} 
    }],
    ['keywords that are not a list', {
      ...buildHistory(),
      keywords: 'k' 
    }],
    ['a run without a timestamp', {
      ...buildHistory(),
      runs: [{
        ...buildRun(),
        timestamp: 5 
      }] 
    }],
    ['a run without the group-run flag', {
      ...buildHistory(),
      runs: [{
        ...buildRun(),
        is_group_run: 'yes' 
      }] 
    }],
    ['a run without a summary', {
      ...buildHistory(),
      runs: [{
        ...buildRun(),
        summary: null 
      }] 
    }],
    ['a run without models', {
      ...buildHistory(),
      runs: [{
        ...buildRun(),
        models: [] 
      }] 
    }],
    ['a keyword without a name', {
      ...buildHistory(),
      keywords: [{
        ...buildKeywordHistory('k', []),
        keyword: 1 
      }] 
    }],
    ['a keyword without runs', {
      ...buildHistory(),
      keywords: [{ keyword: 'k' }] 
    }],
  ])('rejects a payload with %s', (_label, payload) => {
    expect(isGroupKpiHistoryResponse(payload)).toBe(false);
  });
});
