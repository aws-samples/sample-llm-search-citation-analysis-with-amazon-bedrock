import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter, Routes, Route 
} from 'react-router-dom';
import { BrandVisibilityReport } from './BrandVisibilityReport';
import {
  allKeywordsReportData, groupReportData, keywordReportData
} from './useBrandVisibilityReport-fixtures';
import {
  cardFigure, definitionTerms, VISIBILITY_DEFINITION_TERMS, plainStatCard, sectionTable, sectionTitled, sectionTitles, statFigure
} from '../layout/reportQueries-fixtures';
import {
  rankedBrandNames, rankingsShareOfVoiceCaption
} from './sections/brandRankings-fixtures';
import {
  BRAND_TRENDS_SOV_CAPTION, LATEST_BRANDS_SOV_CAPTION, TREND_VIEW_KPI_CAPTION, VISIBILITY_BRANDS_SOV_CAPTION, chartCaption, hasChartPanel,
  trendHistoryKpiCaption
} from './sections/reportChartPanels-fixtures';
import {
  SHARE_OF_VOICE_TITLE, SHARE_OF_VOICE_TREND_TITLE
} from './sections/ReportChartPanels';
import type { Keyword } from '../../../types';
import { buildKeywordGroupsHookResult } from '../../../hooks/useKeywordGroups-fixtures';

vi.mock('./useBrandVisibilityReport', () => ({useBrandVisibilityReport: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));
vi.mock('../../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

import { useBrandVisibilityReport } from './useBrandVisibilityReport';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';

const mockUse = vi.mocked(useBrandVisibilityReport);
vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([]));

const KEYWORDS: Keyword[] = [
  {
    id: '1',
    keyword: 'best running shoes',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    keyword: 'best hiking boots',
    created_at: '2026-01-01T00:00:00Z',
  },
];

const DEFINITIONS_TITLE = 'How these KPIs are measured';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reports/visibility"
          element={<BrandVisibilityReport keywords={KEYWORDS} />}
        />
        <Route
          path="/reports/visibility/:keyword"
          element={<BrandVisibilityReport keywords={KEYWORDS} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BrandVisibilityReport — per-keyword variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(keywordReportData());
    renderAt('/reports/visibility/best%20running%20shoes');
  });

  it('renders the report H1', () => {
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Brand Visibility/i 
      }),
    ).toBeInTheDocument();
  });

  it('names the keyword in the subtitle', () => {
    expect(screen.getByText('Per-keyword visibility for "best running shoes"')).toBeInTheDocument();
  });

  it('shows the headline, the brand rankings, the trend history and the definitions, in that order', () => {
    expect(sectionTitles()).toStrictEqual(['Headline', 'Brand rankings', 'Trend history', DEFINITIONS_TITLE]);
  });

  it('shows the keyword KPIs of the visibility answer in the headline', () => {
    expect(statFigure('Mention rate').textContent).toBe('60.0%');
  });

  it('lists the brands of the visibility answer in the rankings', () => {
    expect(rankedBrandNames()).toStrictEqual(['Nike', 'Adidas']);
  });

  it('charts the share of voice of the visibility answer next to the rankings', () => {
    expect(rankingsShareOfVoiceCaption()).toBe(VISIBILITY_BRANDS_SOV_CAPTION);
  });

  it('charts the keyword KPIs per period in the trend history', () => {
    expect(trendHistoryKpiCaption()).toBe(TREND_VIEW_KPI_CAPTION);
  });

  it('charts no share of voice over time for one keyword', () => {
    expect(hasChartPanel(SHARE_OF_VOICE_TREND_TITLE)).toBe(false);
  });
});

describe('BrandVisibilityReport — all-keywords variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(allKeywordsReportData());
    renderAt('/reports/visibility');
  });

  it('renders the cross-keyword subtitle', () => {
    expect(screen.getByText(/Cross-keyword visibility overview/i)).toBeInTheDocument();
  });

  it('shows the headline, brand rankings, history, movers, leaderboard and definitions, in that order', () => {
    expect(sectionTitles()).toStrictEqual([
      'Headline', 'Brand rankings', 'Trend history', 'Top movers', 'Per-keyword leaderboard', DEFINITIONS_TITLE,
    ]);
  });

  it('ranks the brands of the latest periods of every keyword', () => {
    expect(rankedBrandNames()).toStrictEqual(['Nike', 'Adidas', 'Puma']);
  });

  it('describes the brand rankings as the latest period of every keyword, with its share of voice over time', () => {
    expect(screen.getByText('Every brand the AI answers named in each keyword\'s latest period (the leading 10), by visibility score, '
      + 'and the share of voice of your brand and its leading competitors over time. First-party rows are highlighted.')).toBeInTheDocument();
  });

  it.each([
    [SHARE_OF_VOICE_TITLE, LATEST_BRANDS_SOV_CAPTION],
    [SHARE_OF_VOICE_TREND_TITLE, BRAND_TRENDS_SOV_CAPTION],
  ])('charts the %s of every keyword next to the brand rankings', (panel, caption) => {
    expect(chartCaption(panel, sectionTitled('Brand rankings'))).toBe(caption);
  });

  it('counts the improving keywords in the headline', () => {
    expect(cardFigure(plainStatCard('Improving')).textContent).toBe('1');
  });

  it('lists every keyword in the API order in the leaderboard', () => {
    expect(sectionTable('Per-keyword leaderboard').slice(1).map(([keyword]) => keyword)).toStrictEqual(['best running shoes', 'best hiking boots']);
  });

  it('renders the keyword scope selector populated with All + every tracked keyword', () => {
    const select = screen.getByLabelText<HTMLSelectElement>(/scope/i);
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toContain('All keywords');
    expect(optionTexts).toContain('best running shoes');
    expect(optionTexts).toContain('best hiking boots');
  });
});

describe('BrandVisibilityReport — definitions', () => {
  it.each([
    ['one keyword', '/reports/visibility/best%20running%20shoes', keywordReportData],
    ['every keyword', '/reports/visibility', allKeywordsReportData],
  ])('ends the report of %s with the definition of every KPI and of the trend rule', (_label, path, data) => {
    mockUse.mockReturnValue(data());
    renderAt(path);

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITION_TERMS);
  });
});

describe('BrandVisibilityReport — keyword group (hotel) variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(groupReportData());
    renderAt('/reports/visibility?group=hotel-sol');
  });

  it('shows the hotel KPIs instead of the cross-keyword overview', () => {
    expect(screen.getByRole('heading', { name: 'KPI evolution' })).toBeInTheDocument();
    expect(screen.queryByText(/Cross-keyword visibility overview/i)).not.toBeInTheDocument();
  });

  it('asks for the last 90 days of the group by default', () => {
    expect(mockUse).toHaveBeenLastCalledWith({
      kind: 'group',
      groupId: 'hotel-sol' 
    }, 90);
  });

  it('asks for the period the reader picks', async () => {
    await userEvent.selectOptions(screen.getByLabelText('Period'), '180');
    expect(mockUse).toHaveBeenLastCalledWith({
      kind: 'group',
      groupId: 'hotel-sol' 
    }, 180);
  });

  it('describes the report as every KPI of the hotel per run', () => {
    expect(screen.getByText(/mention rate, share of voice, visibility score and every other KPI per run/)).toBeInTheDocument();
  });

  it('keeps its own KPI evolution chart without a share-of-voice donut, which would need another request', () => {
    expect(hasChartPanel(SHARE_OF_VOICE_TITLE)).toBe(false);
  });

  it('ends with the definitions block', () => {
    expect(sectionTitles().slice(-1)).toStrictEqual([DEFINITIONS_TITLE]);
  });
});


describe('BrandVisibilityReport — requests in flight', () => {
  it.each([
    [
      'one keyword while its visibility answer loads',
      '/reports/visibility/best%20running%20shoes',
      {
        ...keywordReportData(),
        visibility: null,
        visibilityLoading: true,
      },
    ],
    [
      'every keyword while the trends load',
      '/reports/visibility',
      {
        ...allKeywordsReportData(),
        trends: null,
        trendsLoading: true,
      },
    ],
  ])('shows the brand rankings loading for %s', (_case, path, data) => {
    mockUse.mockReturnValue(data);
    renderAt(path);

    expect(screen.getByText('Loading brand rankings…')).toBeInTheDocument();
  });
});
