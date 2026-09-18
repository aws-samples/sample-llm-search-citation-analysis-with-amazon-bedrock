import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExecutiveSummaryReport } from './ExecutiveSummaryReport';

vi.mock('./useExecutiveSummary', () => ({useExecutiveSummary: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));

import { useExecutiveSummary } from './useExecutiveSummary';

const mockUse = useExecutiveSummary as ReturnType<typeof vi.fn>;

const POPULATED = {
  data: {
    generated_at: '2026-05-14T12:00:00Z',
    period_type: 'day',
    days_analyzed: 30,
    keywords_analyzed: 4,
    overall_score: 65.4,
    previous_score: 60.5,
    change: 4.9,
    change_percent: 8.1,
    trend_direction: 'improving',
    summary: {
      improving_count: 2,
      declining_count: 1,
      stable_count: 1 
    },
    top_improving: [
      {
        keyword: 'best running shoes',
        current_score: 80,
        change: 8,
        change_percent: 11.1,
        trend_direction: 'improving' 
      },
    ],
    top_declining: [
      {
        keyword: 'best hiking boots',
        current_score: 30,
        change: -10,
        change_percent: -25,
        trend_direction: 'declining' 
      },
    ],
    top_recommendations: [
      {
        type: 'gap',
        priority: 'high',
        title: 'Pitch hiking-gear-focused publishers',
        description: 'Target the citation gaps on outdoor outlets.',
        action: 'Reach out to Outside, Backpacker, REI Co-op Journal',
        impact: '5-10% visibility lift on `best hiking boots`',
      },
    ],
  },
  loading: false,
  error: null,
  ready: true,
};

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/reports/executive-summary']}>
      <ExecutiveSummaryReport />
    </MemoryRouter>,
  );
}

describe('ExecutiveSummaryReport', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(POPULATED);
  });

  it('renders the report H1', () => {
    renderReport();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Executive Summary/i 
      }),
    ).toBeInTheDocument();
  });

  it('renders the overall visibility headline value', () => {
    renderReport();
    expect(screen.getByText('65.4')).toBeInTheDocument();
  });

  it('renders a top-improving keyword in the wins panel', () => {
    renderReport();
    expect(screen.getByText('best running shoes')).toBeInTheDocument();
  });

  it('renders the recommendation title in the next-actions panel', () => {
    renderReport();
    expect(
      screen.getByText('Pitch hiking-gear-focused publishers'),
    ).toBeInTheDocument();
  });
});
