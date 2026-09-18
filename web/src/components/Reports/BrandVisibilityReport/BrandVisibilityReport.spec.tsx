import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen,
} from '@testing-library/react';
import {
  MemoryRouter, Routes, Route 
} from 'react-router-dom';
import { BrandVisibilityReport } from './BrandVisibilityReport';
import { buildKeywordTrends } from './keywordTrends-fixtures';
import type { Keyword } from '../../../types';

vi.mock('./useBrandVisibilityReport', () => ({useBrandVisibilityReport: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));

import { useBrandVisibilityReport } from './useBrandVisibilityReport';

const mockUse = useBrandVisibilityReport as ReturnType<typeof vi.fn>;

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

const PER_KEYWORD_DATA = {
  keyword: 'best running shoes',
  visibility: {
    keyword: 'best running shoes',
    timestamp: '2026-05-10T00:00:00Z',
    total_brands: 4,
    total_mentions: 20,
    brands: [
      {
        name: 'Nike',
        visibility_score: 80,
        provider_count: 4,
        providers: ['openai', 'perplexity', 'gemini', 'claude'],
        total_mentions: 12,
        best_rank: 1,
        avg_sentiment: 0.5,
        share_of_voice: 60,
        classification: 'first_party' as const,
      },
    ],
    first_party: [],
    competitors: [],
    others: [],
    summary: {
      first_party_avg_score: 80,
      competitor_avg_score: 50,
      first_party_total_sov: 60,
      competitor_total_sov: 40,
    },
  },
  visibilityLoading: false,
  visibilityError: null,
  trends: {
    period_type: 'day',
    days_analyzed: 30,
    data_points: 30,
    trend_data: [],
    trend_direction: 'stable',
    summary: {
      current_score: 80,
      previous_score: 78,
      change: 2,
      change_percent: 2.5,
      average_score: 79,
      max_score: 82,
      min_score: 76,
    },
  },
  trendsLoading: false,
  trendsError: null,
  ready: true,
};

const ALL_KEYWORDS_DATA = {
  keyword: null,
  visibility: null,
  visibilityLoading: false,
  visibilityError: null,
  trends: buildKeywordTrends([
    {
      keyword: 'best running shoes',
      current_score: 80,
      change: 8,
    },
    {
      keyword: 'best hiking boots',
      current_score: 30,
      change: -10,
    },
  ]),
  trendsLoading: false,
  trendsError: null,
  ready: true,
};

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
    mockUse.mockReturnValue(PER_KEYWORD_DATA);
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

  it('renders the per-keyword subtitle with the selected keyword', () => {
    renderAt('/reports/visibility/best%20running%20shoes');
    const matches = screen.getAllByText(/best running shoes/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders a brand row from visibility data', () => {
    renderAt('/reports/visibility/best%20running%20shoes');
    expect(screen.getByText('Nike')).toBeInTheDocument();
  });

  it('renders the gap-to-competitor headline metric', () => {
    renderAt('/reports/visibility/best%20running%20shoes');
    expect(screen.getByText('+30.0')).toBeInTheDocument();
  });
});

describe('BrandVisibilityReport — all-keywords variant', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(ALL_KEYWORDS_DATA);
  });

  it('renders the cross-keyword subtitle', () => {
    renderAt('/reports/visibility');
    expect(screen.getByText(/Cross-keyword visibility overview/i)).toBeInTheDocument();
  });

  it('renders the improving / declining / stable counts from overall aggregates', () => {
    renderAt('/reports/visibility');
    // Fixture: improving=1, declining=1. The labels "Improving" and
    // "Declining" appear twice — once as paragraph metric labels in the
    // headline, once as h3 column titles in MoversSection. Disambiguate
    // by tag: the metric panel uses a <p>, the column uses an <h3>.
    const labels = screen.getAllByText('Improving');
    const metricLabel = labels.find((el) => el.tagName === 'P');
    expect(metricLabel?.parentElement).toHaveTextContent('1');
  });

  it('renders the average score from overall aggregates', () => {
    renderAt('/reports/visibility');
    // Fixture: avg_score=55 -> "55.0" formatted.
    expect(screen.getByText('55.0')).toBeInTheDocument();
  });

  it('renders the per-keyword leaderboard rows for every tracked keyword', () => {
    renderAt('/reports/visibility');
    const shoesMatches = screen.getAllByText('best running shoes');
    const bootsMatches = screen.getAllByText('best hiking boots');
    expect(shoesMatches.length).toBeGreaterThan(0);
    expect(bootsMatches.length).toBeGreaterThan(0);
  });

  it('orders the leaderboard by current_score descending', () => {
    renderAt('/reports/visibility');
    // Fixture: shoes=80, boots=30 — shoes should appear above boots in the table.
    // Filter to rows that contain a keyword cell.
    const tables = screen.getAllByRole('table');
    const leaderboard = tables[tables.length - 1];
    const text = leaderboard.textContent ?? '';
    expect(text.indexOf('best running shoes')).toBeLessThan(
      text.indexOf('best hiking boots'),
    );
  });

  it('renders the keyword scope selector populated with All + every tracked keyword', () => {
    renderAt('/reports/visibility');
    const select = screen.getByLabelText(/scope/i) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toContain('All keywords');
    expect(optionTexts).toContain('best running shoes');
    expect(optionTexts).toContain('best hiking boots');
  });
});
