import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  brandMentionsExcelRows, brandMentionsFileName, exportBrandMentions
} from './brandMentionsExport';
import { brandMentionsExportResponse } from './brandMentionsExport-fixtures';

const mocks = vi.hoisted(() => ({exportToExcel: vi.fn(),}));

vi.mock('../../exporters/excelGenerator', () => ({exportToExcel: mocks.exportToExcel,}));

describe('brandMentionsExcelRows', () => {
  it('returns one exact row for each keyword brand provider appearance', () => {
    expect(brandMentionsExcelRows(brandMentionsExportResponse)).toStrictEqual([
      {
        Keyword: 'hotel coruna spa',
        Brand: 'Hotel Coruna',
        Classification: 'first_party',
        Provider: 'openai',
        Model: 'gpt-4.1',
        Rank: 1,
        Mentions: 2,
        'First position': 12,
        Sentiment: 'positive',
      },
      {
        Keyword: 'best hotels galicia',
        Brand: 'Hotel Coruna',
        Classification: 'first_party',
        Provider: 'gemini',
        Model: 'gemini-2.5-pro',
        Rank: 2,
        Mentions: 1,
        'First position': 30,
        Sentiment: 'neutral',
      },
      {
        Keyword: 'hotel coruna spa',
        Brand: 'Rival Inn',
        Classification: 'competitor',
        Provider: 'openai',
        Model: 'gpt-4.1',
        Rank: 3,
        Mentions: 4,
        'First position': 44,
        Sentiment: 'negative',
      },
    ]);
  });
});

describe('brandMentionsFileName', () => {
  it('returns the scoped dated xlsx filename when scope contains punctuation', () => {
    expect(brandMentionsFileName('Hotel Coruña — weekly', new Date('2026-09-18T12:00:00Z')))
      .toBe('brand-mentions-hotel-coru-a-weekly-2026-09-18.xlsx');
  });
});

describe('exportBrandMentions', () => {
  beforeEach(() => {
    mocks.exportToExcel.mockResolvedValue(undefined);
  });

  it('exports the exact server appearance rows and filename when invoked', async () => {
    await exportBrandMentions(
      brandMentionsExportResponse,
      'Hotel Coruña',
      new Date('2026-09-18T12:00:00Z')
    );

    expect(mocks.exportToExcel).toHaveBeenCalledWith({
      data: brandMentionsExcelRows(brandMentionsExportResponse),
      columns: [
        { wch: 36 },
        { wch: 28 },
        { wch: 16 },
        { wch: 16 },
        { wch: 24 },
        { wch: 14 },
        { wch: 12 },
        { wch: 16 },
        { wch: 16 },
      ],
      sheetName: 'Brand Mentions',
      fileName: 'brand-mentions-hotel-coru-a-2026-09-18.xlsx',
    });
  });
});
