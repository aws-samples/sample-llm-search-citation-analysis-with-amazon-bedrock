import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  brandMentionsExcelRows, brandMentionsFileName, exportBrandMentions, exportBrandMentionsFor
} from './brandMentionsExport';
import { fetchBrandAppearances } from '../../api/brandMentions';
import {
  brandMentionsExportRows, GROUP_REPORT_SCOPE
} from './brandMentionsExport-fixtures';

const mocks = vi.hoisted(() => ({exportToExcel: vi.fn(),}));

vi.mock('../../api/brandMentions', () => ({ fetchBrandAppearances: vi.fn() }));

vi.mock('../../exporters/excelGenerator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../exporters/excelGenerator')>();
  return {
    ...actual,
    exportToExcel: mocks.exportToExcel,
  };
});

describe('brandMentionsExcelRows', () => {
  it('returns one exact row for each keyword brand provider appearance', () => {
    expect(brandMentionsExcelRows(brandMentionsExportRows)).toStrictEqual([
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
      brandMentionsExportRows,
      'Hotel Coruña',
      new Date('2026-09-18T12:00:00Z')
    );

    expect(mocks.exportToExcel).toHaveBeenCalledWith({
      data: brandMentionsExcelRows(brandMentionsExportRows),
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

describe('exportBrandMentionsFor', () => {
  beforeEach(() => {
    mocks.exportToExcel.mockResolvedValue(undefined);
    vi.mocked(fetchBrandAppearances).mockResolvedValue(brandMentionsExportRows);
  });

  it('reads every appearance of the request before exporting', async () => {
    const request = {
      scope: GROUP_REPORT_SCOPE,
      marketId: null,
      filters: { classification: 'competitor' },
    };

    await exportBrandMentionsFor(request, 'Hotel Coruña');

    expect(fetchBrandAppearances).toHaveBeenCalledWith(request);
  });

  it('exports one row per appearance the pages returned', async () => {
    await exportBrandMentionsFor({
      scope: GROUP_REPORT_SCOPE,
      marketId: null,
      filters: {},
    }, 'Hotel Coruña', new Date('2026-09-18T12:00:00Z'));

    expect(mocks.exportToExcel).toHaveBeenCalledWith(expect.objectContaining({
      data: brandMentionsExcelRows(brandMentionsExportRows),
      fileName: 'brand-mentions-hotel-coru-a-2026-09-18.xlsx',
    }));
  });
});
