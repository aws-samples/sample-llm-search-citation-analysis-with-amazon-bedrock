import {
  describe, expect, it
} from 'vitest';
import {
  isGroupKeywordRunsPage, isGroupKpiHistoryResponse, isGroupRunDriversPage
} from './groupKpiHistory';
import {
  buildHistory, buildKeywordHistory, buildKeywordSummary, buildRun, buildRunDrivers, KEYWORD_HISTORIES
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
    ['a run without KPIs', {
      ...buildHistory(),
      runs: [{
        ...buildRun(),
        kpis: null 
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
        ...buildKeywordSummary('k', []),
        keyword: 1 
      }] 
    }],
    ['a keyword without a run count', {
      ...buildHistory(),
      keywords: [{
        keyword: 'k',
        latest: null 
      }] 
    }],
    ['a keyword whose latest run is not an object', {
      ...buildHistory(),
      keywords: [{
        ...buildKeywordSummary('k', []),
        latest: 'RUN_1' 
      }] 
    }],
  ])('rejects a payload with %s', (_label, payload) => {
    expect(isGroupKpiHistoryResponse(payload)).toBe(false);
  });
});

describe('isGroupKeywordRunsPage', () => {
  it('accepts a page of keyword runs with a next token', () => {
    expect(isGroupKeywordRunsPage({
      keywords: KEYWORD_HISTORIES,
      next_token: 'abc' 
    })).toBe(true);
  });

  it('accepts the last page', () => {
    expect(isGroupKeywordRunsPage({
      keywords: [],
      next_token: null 
    })).toBe(true);
  });

  it.each([
    ['no next token', { keywords: [] }],
    ['a keyword without runs', {
      keywords: [{ keyword: 'k' }],
      next_token: null 
    }],
    ['a keyword without a name', {
      keywords: [{
        ...buildKeywordHistory('k', []),
        keyword: 2 
      }],
      next_token: null 
    }],
  ])('rejects a page with %s', (_label, payload) => {
    expect(isGroupKeywordRunsPage(payload)).toBe(false);
  });
});

describe('isGroupRunDriversPage', () => {
  it('accepts a page of run drivers', () => {
    expect(isGroupRunDriversPage({
      changes: [buildRunDrivers()],
      next_token: null 
    })).toBe(true);
  });

  it.each([
    ['changes that are not a list', {
      changes: {},
      next_token: null 
    }],
    ['a change without a previous run', {
      changes: [{
        ...buildRunDrivers(),
        previous_timestamp: null 
      }],
      next_token: null 
    }],
    ['a change without drivers', {
      changes: [{
        ...buildRunDrivers(),
        drivers: 'none' 
      }],
      next_token: null 
    }],
    ['a numeric next token', {
      changes: [],
      next_token: 3 
    }],
  ])('rejects a page with %s', (_label, payload) => {
    expect(isGroupRunDriversPage(payload)).toBe(false);
  });
});
