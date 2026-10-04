import {
  describe, it, expect
} from 'vitest';
import {
  sentimentCounts, sentimentShareNote
} from './sentimentShares';

describe('sentimentCounts', () => {
  it('pools the neutral and mixed mentions and counts every labelled one', () => {
    expect(sentimentCounts({
      positive: 5,
      neutral: 4,
      negative: 1,
      mixed: 2,
    })).toStrictEqual({
      positive: 5,
      negative: 1,
      neutralOrMixed: 6,
      labelled: 12,
    });
  });
});

describe('sentimentShareNote', () => {
  it.each([
    [5, 12, '41.7% of 12 mentions with a sentiment'],
    [1, 1, '100.0% of 1 mention with a sentiment'],
    [0, 3, '0.0% of 3 mentions with a sentiment'],
    [0, 0, 'No mention with a sentiment yet'],
    [23, 80, '28.8% of 80 mentions with a sentiment'],
  ])('writes %s of %s labelled mentions as "%s"', (count, labelled, note) => {
    expect(sentimentShareNote(count, labelled)).toBe(note);
  });
});
