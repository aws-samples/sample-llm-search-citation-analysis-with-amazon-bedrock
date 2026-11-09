import {
  describe, it, expect
} from 'vitest';
import {
  DEFAULT_HISTORY_FILTERS,
  countHiddenStaleFailures,
  filterHistory,
  isStaleFailure,
  presentTypes,
  statusGroupOf,
} from './researchHistoryFilter';
import {
  buildFailedRun, buildHistoryItem
} from './ResearchHistory-fixtures';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const recentFailure = buildFailedRun('recent-failed', 0, { created_at: new Date(NOW - 2 * DAY_MS).toISOString() });
const staleFailure = buildFailedRun('stale-failed', 0, { created_at: new Date(NOW - 30 * DAY_MS).toISOString() });
const stalePartial = buildHistoryItem({
  id: 'stale-partial',
  status: 'partial',
  created_at: new Date(NOW - 30 * DAY_MS).toISOString(),
});
const completedCompetitor = buildHistoryItem({
  id: 'competitor',
  type: 'competitor',
  status: 'completed',
});
const legacyRow = buildHistoryItem({
  id: 'legacy',
  status: undefined,
});
const runningRow = buildHistoryItem({
  id: 'running',
  status: 'processing',
});
const history = [recentFailure, staleFailure, stalePartial, completedCompetitor, legacyRow, runningRow];

describe('statusGroupOf', () => {
  it.each([
    ['pending', 'running'],
    ['running', 'running'],
    ['processing', 'running'],
    ['partial', 'failed'],
    ['failed', 'failed'],
    ['completed', 'completed'],
  ] as const)('puts a %s run in the %s group', (status, group) => {
    expect(statusGroupOf(buildHistoryItem({ status }))).toBe(group);
  });

  it('counts a legacy row without a status as completed', () => {
    expect(statusGroupOf(legacyRow)).toBe('completed');
  });
});

describe('isStaleFailure', () => {
  it('flags a failed run older than seven days', () => {
    expect(isStaleFailure(staleFailure, NOW)).toBe(true);
  });

  it('keeps a failed run from the last seven days', () => {
    expect(isStaleFailure(recentFailure, NOW)).toBe(false);
  });

  it('keeps an old partial run, which carries results', () => {
    expect(isStaleFailure(stalePartial, NOW)).toBe(false);
  });

  it('keeps a failed run whose date cannot be read', () => {
    expect(isStaleFailure(buildFailedRun('bad-date', 0, { created_at: 'not a date' }), NOW)).toBe(false);
  });
});

describe('filterHistory', () => {
  it('hides only the stale failures by default', () => {
    expect(filterHistory(history, DEFAULT_HISTORY_FILTERS, NOW).map(({ id }) => id)).toStrictEqual([
      'recent-failed', 'stale-partial', 'competitor', 'legacy', 'running',
    ]);
  });

  it('shows the stale failures once asked to', () => {
    expect(filterHistory(history, {
      ...DEFAULT_HISTORY_FILTERS,
      showStaleFailures: true
    }, NOW)).toHaveLength(history.length);
  });

  it('shows every failure, however old, under the failed group', () => {
    expect(filterHistory(history, {
      ...DEFAULT_HISTORY_FILTERS,
      status: 'failed'
    }, NOW).map(({ id }) => id)).toStrictEqual(['recent-failed', 'stale-failed', 'stale-partial']);
  });

  it('combines the type and status filters', () => {
    expect(filterHistory(history, {
      ...DEFAULT_HISTORY_FILTERS,
      type: 'competitor',
      status: 'completed'
    }, NOW).map(({ id }) => id)).toStrictEqual(['competitor']);
  });
});

describe('countHiddenStaleFailures', () => {
  it('counts the stale failures of the selected type', () => {
    expect(countHiddenStaleFailures(history, DEFAULT_HISTORY_FILTERS, NOW)).toBe(1);
    expect(countHiddenStaleFailures(history, {
      ...DEFAULT_HISTORY_FILTERS,
      type: 'competitor'
    }, NOW)).toBe(0);
  });

  it('counts nothing once a status group is picked', () => {
    expect(countHiddenStaleFailures(history, {
      ...DEFAULT_HISTORY_FILTERS,
      status: 'failed'
    }, NOW)).toBe(0);
  });
});

describe('presentTypes', () => {
  it('lists the loaded run types in display order', () => {
    expect(presentTypes([completedCompetitor, legacyRow])).toStrictEqual(['expansion', 'competitor']);
  });
});
