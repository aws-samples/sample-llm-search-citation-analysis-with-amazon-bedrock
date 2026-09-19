import {
  describe, expect, it
} from 'vitest';
import { researchExcelFileName } from './researchExport';

const EXPORT_DATE = new Date('2026-09-18T12:00:00Z');

describe('researchExcelFileName', () => {
  it('returns the scoped dated xlsx filename when title contains punctuation', () => {
    expect(researchExcelFileName('Hotel Coruña — weekly', EXPORT_DATE))
      .toBe('keyword-research-hotel-coru-a-weekly-2026-09-18.xlsx');
  });

  it('limits the normalized scope to 60 characters when title exceeds the export limit', () => {
    expect(researchExcelFileName('a'.repeat(61), EXPORT_DATE))
      .toBe(`keyword-research-${'a'.repeat(60)}-2026-09-18.xlsx`);
  });
});
