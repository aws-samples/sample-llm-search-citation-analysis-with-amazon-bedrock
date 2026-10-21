import {
  describe, expect, it
} from 'vitest';
import { isTruncationMark } from './truncationDecoders';

describe('isTruncationMark', () => {
  it.each([
    ['a run timestamp', '2026-10-05T06:50:33Z'],
    ['null for a window read whole', null],
    ['nothing from an older API build', undefined],
  ])('accepts %s', (_description, value) => {
    expect(isTruncationMark(value)).toBe(true);
  });

  it.each([
    ['a number', 5],
    ['a flag', true],
  ])('rejects %s', (_description, value) => {
    expect(isTruncationMark(value)).toBe(false);
  });
});
