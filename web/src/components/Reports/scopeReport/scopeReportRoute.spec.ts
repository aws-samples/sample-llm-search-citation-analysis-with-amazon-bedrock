import {
  describe, it, expect
} from 'vitest';
import {
  daysFromSearch, scopeFromSearch, scopeReportPath, trendPeriodFor
} from './scopeReportRoute';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../../ui/reportScope-fixtures';

describe('scopeFromSearch', () => {
  it.each([
    ['', ALL_SCOPE],
    ['?keyword=best%20running%20shoes', keywordScope('best running shoes')],
    ['?group=hotel-sol', groupScope('hotel-sol')],
    ['?group=hotel-sol&keyword=spa', keywordScope('spa')],
    ['?keyword=&group=', ALL_SCOPE],
  ] as const)('reads %s as its scope', (search, scope) => {
    expect(scopeFromSearch(new URLSearchParams(search))).toStrictEqual(scope);
  });
});

describe('daysFromSearch', () => {
  it.each([
    ['', 30],
    ['?days=90', 90],
    ['?days=180', 180],
    ['?days=365', 30],
    ['?days=abc', 30],
  ] as const)('reads %s as %s days', (search, days) => {
    expect(daysFromSearch(new URLSearchParams(search))).toBe(days);
  });
});

describe('trendPeriodFor', () => {
  it.each([
    [30, 'day'],
    [31, 'week'],
    [180, 'week'],
  ] as const)('charts %s days per %s', (days, period) => {
    expect(trendPeriodFor(days)).toBe(period);
  });
});

describe('scopeReportPath', () => {
  it.each([
    ['/reports/sources', ALL_SCOPE, 30],
    ['/reports/sources?days=90', ALL_SCOPE, 90],
    ['/reports/sources?keyword=best+running+shoes', keywordScope('best running shoes'), 30],
    ['/reports/sources?group=hotel-sol&days=180', groupScope('hotel-sol'), 180],
  ] as const)('links to %s', (path, scope, days) => {
    expect(scopeReportPath('/reports/sources', scope, days)).toBe(path);
  });

  it('reopens the scope and period it links to', () => {
    const [, search] = scopeReportPath('/reports/sources', groupScope('a&b'), 90).split('?');

    expect([scopeFromSearch(new URLSearchParams(search)), daysFromSearch(new URLSearchParams(search))]).toStrictEqual([groupScope('a&b'), 90]);
  });
});
