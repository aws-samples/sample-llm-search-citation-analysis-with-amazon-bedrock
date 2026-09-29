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
  cardFigure, definitionTerms, plainStatCard, sectionTable, sectionTitles, statFigure
} from '../layout/reportQueries-fixtures';
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

    expect(sectionTable('Brand rankings').slice(1).map(([brand]) => brand)).toStrictEqual(['Nike', 'Adidas']);
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

  it('shows the headline, history, movers, leaderboard and definitions, in that order', () => {
    renderAt('/reports/visibility');

    expect(sectionTitles()).toStrictEqual(['Headline', 'Trend history', 'Top movers', 'Per-keyword leaderboard', DEFINITIONS_TITLE]);
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

  it('ends with the definitions block', () => {
    renderAt('/reports/visibility?group=hotel-sol');

    expect(sectionTitles().slice(-1)).toStrictEqual([DEFINITIONS_TITLE]);
  });
});
