import {
  describe, expect, it
} from 'vitest';
import { describeExportSize } from './exportSize';

describe('describeExportSize', () => {
  it.each([
    [1, 812, '1 row, 812 B'],
    [41237, 3_355_443, '41,237 rows, 3.2 MB'],
    [500, 14_336, '500 rows, 14 KB'],
    [2_000_000, 52_428_800, '2,000,000 rows, 50 MB'],
  ])('describes %i rows in %i bytes as %s', (rows, bytes, expected) => {
    expect(describeExportSize(rows, bytes)).toBe(expected);
  });

  it('gives the rows alone while no byte is written', () => {
    expect(describeExportSize(0, 0)).toBe('0 rows');
  });
});
