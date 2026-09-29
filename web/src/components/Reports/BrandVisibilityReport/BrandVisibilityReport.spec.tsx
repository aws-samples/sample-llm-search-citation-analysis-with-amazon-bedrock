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
  cardFigure, definitionTerms, plainStatCard, sectionTable, sectionTitled, sectionTitles, statFigure
} from '../layout/reportQueries-fixtures';
import {
  rankedBrandNames, rankingsShareOfVoiceCaption
} from './sections/brandRankings-fixtures';
import {
  BRAND_TRENDS_SOV_CAPTION, LATEST_BRANDS_SOV_CAPTION, TREND_VIEW_KPI_CAPTION, VISIBILITY_BRANDS_SOV_CAPTION, chartCaption, hasChartPanel
} from './sections/reportChartPanels-fixtures';
import {
  KPI_TREND_TITLE, SHARE_OF_VOICE_TITLE, SHARE_OF_VOICE_TREND_TITLE
} from './sections/ReportChartPanels';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';
import type { Keyword } from '../../../types';

vi.mock('./useBrandVisibilityReport', () => ({useBrandVisibilityReport: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

import { useBrandVisibilityReport } from './useBrandVisibilityReport';

const mockUse = vi.mocked(useBrandVisibilityReport);

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
  });

  it('renders the report H1', () => {
    renderAt('/reports/visibility/best%20running%20shoes');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Brand Visibility/i 
      }),
    ).toBeInTheDocument();
  });

  it('names the keyword in the subtitle', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(screen.getByText('Per-keyword visibility for "best running shoes"')).toBeInTheDocument();
  });

  it('shows the headline, the brand rankings, the trend history and the definitions, in that order', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(sectionTitles()).toStrictEqual(['Headline', 'Brand rankings', 'Trend history', DEFINITIONS_TITLE]);
  });

  it('shows the keyword KPIs of the visibility answer in the headline', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(statFigure('Mention rate').textContent).toBe('60.0%');
  });

  it('lists the brands of the visibility answer in the rankings', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(rankedBrandNames()).toStrictEqual(['Nike', 'Adidas']);
  });

  it('charts the share of voice of the visibility answer next to the rankings', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(rankingsShareOfVoiceCaption()).toBe(VISIBILITY_BRANDS_SOV_CAPTION);
  });

  it('charts the keyword KPIs per period in the trend history', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(chartCaption(KPI_TREND_TITLE, sectionTitled('Trend history'))).toBe(TREND_VIEW_KPI_CAPTION);
  });

  it('charts no share of voice over time for one keyword', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(hasChartPanel(SHARE_OF_VOICE_TREND_TITLE)).toBe(false);
  });

  it('ends with the definition of every KPI and of the trend rule', () => {
    renderAt('/reports/visibility/best%20running%20shoes');

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => entry.label));
  });
});

describe('BrandVisibilityReport — all-keywords variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(allKeywordsReportData());
  });

  it('renders the cross-keyword subtitle', () => {
    renderAt('/reports/visibility');
    expect(screen.getByText(/Cross-keyword visibility overview/i)).toBeInTheDocument();
  });

  it('shows the headline, brand rankings, history, movers, leaderboard and definitions, in that order', () => {
    renderAt('/reports/visibility');

    expect(sectionTitles()).toStrictEqual([
      'Headline', 'Brand rankings', 'Trend history', 'Top movers', 'Per-keyword leaderboard', DEFINITIONS_TITLE,
    ]);
  });

  it('ranks the brands of the latest periods of every keyword', () => {
    renderAt('/reports/visibility');

    expect(rankedBrandNames()).toStrictEqual(['Nike', 'Adidas', 'Puma']);
  });

  it.each([
    [SHARE_OF_VOICE_TITLE, LATEST_BRANDS_SOV_CAPTION],
    [SHARE_OF_VOICE_TREND_TITLE, BRAND_TRENDS_SOV_CAPTION],
  ])('charts the %s of every keyword next to the brand rankings', (panel, caption) => {
    renderAt('/reports/visibility');

    expect(chartCaption(panel, sectionTitled('Brand rankings'))).toBe(caption);
  });

  it('counts the improving keywords in the headline', () => {
    renderAt('/reports/visibility');

    expect(cardFigure(plainStatCard('Improving')).textContent).toBe('1');
  });

  it('lists every keyword in the API order in the leaderboard', () => {
    renderAt('/reports/visibility');

    expect(sectionTable('Per-keyword leaderboard').slice(1).map(([keyword]) => keyword)).toStrictEqual(['best running shoes', 'best hiking boots']);
  });

  it('ends with the definition of every KPI and of the trend rule', () => {
    renderAt('/reports/visibility');

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => entry.label));
  });

  it('renders the keyword scope selector populated with All + every tracked keyword', () => {
    renderAt('/reports/visibility');
    const select = screen.getByLabelText<HTMLSelectElement>(/scope/i);
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toContain('All keywords');
    expect(optionTexts).toContain('best running shoes');
    expect(optionTexts).toContain('best hiking boots');
  });
});

describe('BrandVisibilityReport — keyword group (hotel) variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(groupReportData());
  });

  it('shows the hotel KPIs instead of the cross-keyword overview', () => {
    renderAt('/reports/visibility?group=hotel-sol');
    expect(screen.getByRole('heading', { name: 'KPI evolution' })).toBeInTheDocument();
    expect(screen.queryByText(/Cross-keyword visibility overview/i)).not.toBeInTheDocument();
  });

  it('asks for the last 90 days of the group by default', () => {
    renderAt('/reports/visibility?group=hotel-sol');
    expect(mockUse).toHaveBeenLastCalledWith({
      kind: 'group',
      groupId: 'hotel-sol' 
    }, 90);
  });

  it('asks for the period the reader picks', async () => {
    renderAt('/reports/visibility?group=hotel-sol');
    await userEvent.selectOptions(screen.getByLabelText('Period'), '180');
    expect(mockUse).toHaveBeenLastCalledWith({
      kind: 'group',
      groupId: 'hotel-sol' 
    }, 180);
  });

  it('describes the report as every KPI of the hotel per run', () => {
    renderAt('/reports/visibility?group=hotel-sol');
    expect(screen.getByText(/mention rate, share of voice, visibility score and every other KPI per run/)).toBeInTheDocument();
  });

  it('keeps its own KPI evolution chart without a share-of-voice donut, which would need another request', () => {
    renderAt('/reports/visibility?group=hotel-sol');

    expect(hasChartPanel(SHARE_OF_VOICE_TITLE)).toBe(false);
  });

  it('ends with the definitions block', () => {
    renderAt('/reports/visibility?group=hotel-sol');

    expect(sectionTitles().slice(-1)).toStrictEqual([DEFINITIONS_TITLE]);
  });
});
