import {
  describe, expect, it
} from 'vitest';
import {
  keywordMovers, TOP_MOVERS
} from './keywordMovers';
import {
  buildKeywordTrend, movingKeyword
} from '../../layout/reportPayload-fixtures';

const ROWS = [
  movingKeyword('small-up', 2.5, 'improving', 80),
  movingKeyword('flat-up', 1.5, 'stable', 70),
  movingKeyword('big-down', -9, 'declining', 60),
  movingKeyword('big-up', 9, 'improving', 50),
  movingKeyword('small-down', -2, 'declining', 40),
  buildKeywordTrend('new'),
];

describe('keywordMovers', () => {
  it('lists the keywords whose visibility score improves, largest move first, with their score and change', () => {
    expect(keywordMovers(ROWS, 'improving')).toStrictEqual([
      {
        keyword: 'big-up',
        visibility_score: 50,
        change: 9,
      },
      {
        keyword: 'small-up',
        visibility_score: 80,
        change: 2.5,
      },
    ]);
  });

  it('lists the keywords whose visibility score declines, largest fall first', () => {
    expect(keywordMovers(ROWS, 'declining').map((mover) => mover.keyword)).toStrictEqual(['big-down', 'small-down']);
  });

  it('leaves out a keyword that moved less than the trend rule counts as a move', () => {
    expect(keywordMovers(ROWS, 'improving').map((mover) => mover.keyword)).not.toContain('flat-up');
  });

  it('leaves out a keyword without an earlier period', () => {
    expect(keywordMovers([buildKeywordTrend('new')], 'improving')).toStrictEqual([]);
  });

  it('keeps the API order (best visibility score first) between equal moves', () => {
    const rows = [movingKeyword('first', -3, 'declining', 90), movingKeyword('second', -3, 'declining', 10)];

    expect(keywordMovers(rows, 'declining').map((mover) => mover.keyword)).toStrictEqual(['first', 'second']);
  });

  it('lists at most the top movers', () => {
    const rows = Array.from({ length: TOP_MOVERS + 3 }, (_, index) => movingKeyword(`up-${index}`, index + 2, 'improving'));

    expect(keywordMovers(rows, 'improving')).toHaveLength(TOP_MOVERS);
  });
});
