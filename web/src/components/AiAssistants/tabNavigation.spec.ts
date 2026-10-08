import {
  describe, expect, it 
} from 'vitest';
import { nextTabIndex } from './tabNavigation';

describe('nextTabIndex', () => {
  it.each([
    ['ArrowRight', 2, 3],
    ['ArrowRight', 5, 0],
    ['ArrowLeft', 2, 1],
    ['ArrowLeft', 0, 5],
    ['Home', 4, 0],
    ['End', 1, 5],
  ])('moves %s from tab %i to tab %i of six', (key, current, expected) => {
    expect(nextTabIndex(key, current, 6)).toBe(expected);
  });

  it('ignores keys that do not move between tabs', () => {
    expect(nextTabIndex('Enter', 2, 6)).toBeNull();
  });
});
