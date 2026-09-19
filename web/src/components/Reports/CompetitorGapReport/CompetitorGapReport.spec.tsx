import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import {
  MemoryRouter, Routes, Route 
} from 'react-router-dom';
import { CompetitorGapReport } from './CompetitorGapReport';

vi.mock('./useCompetitorGap', () => ({useCompetitorGap: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));
vi.mock('../../../hooks/useBrandConfig', () => ({useBrandConfig: vi.fn()}));

import { useCompetitorGap } from './useCompetitorGap';
import { useBrandConfig } from '../../../hooks/useBrandConfig';

const mockGap = useCompetitorGap as ReturnType<typeof vi.fn>;
const mockBrand = useBrandConfig as ReturnType<typeof vi.fn>;

const POPULATED_DATA = {
  competitor: 'Adidas',
  rollup: {
    competitor: 'Adidas',
    outranked_keywords: [
      {
        keyword: 'best running shoes',
        their_best_rank: 1,
        our_best_rank: 3,
        rank_delta: 2,
        providers: ['openai', 'perplexity'],
      },
    ],
    exclusive_sources: [
      {
        keyword: 'best running shoes',
        url: 'https://example.com/shoes',
        domain: 'example.com',
        priority: 'high' as const,
        citation_count: 9,
        provider_count: 3,
        providers: ['openai', 'perplexity', 'gemini'],
        lift_score: 6.91,
      },
    ],
    outreach_targets: [
      {
        keyword: 'best running shoes',
        url: 'https://example.com/shoes',
        domain: 'example.com',
        priority: 'high' as const,
        citation_count: 9,
        provider_count: 3,
        providers: ['openai', 'perplexity', 'gemini'],
        lift_score: 6.91,
      },
    ],
  },
  keywordsAnalyzed: 4,
  loading: false,
  error: null,
  ready: true,
};

function renderAt(path: string, competitors: string[] = ['Adidas', 'Asics']) {
  mockBrand.mockReturnValue({
    config: {
      tracked_brands: {
        first_party: ['Nike'],
        competitors 
      } 
    },
    presets: {},
    loading: false,
    error: null,
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/competitor" element={<CompetitorGapReport />} />
        <Route
          path="/reports/competitor/:competitor"
          element={<CompetitorGapReport />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CompetitorGapReport', () => {
  beforeEach(() => {
    mockGap.mockReturnValue(POPULATED_DATA);
  });

  it('renders the report H1 with the selected competitor', () => {
    renderAt('/reports/competitor/Adidas');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Competitor Gap.*Adidas/i 
      }),
    ).toBeInTheDocument();
  });

  it('renders the outranked keyword in the table', () => {
    renderAt('/reports/competitor/Adidas');
    const matches = screen.getAllByText('best running shoes');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders the their-rank value for the outranked row', () => {
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('renders the our-rank value for the outranked row', () => {
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('renders the rank delta with a + sign', () => {
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('renders the outreach target domain', () => {
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('renders the lift score on the outreach card', () => {
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText('6.91')).toBeInTheDocument();
  });

  it('renders a competitor switcher populated with every configured competitor', () => {
    renderAt('/reports/competitor/Adidas');
    const select = screen.getByLabelText(/Competitor:/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('Adidas');
    expect(optionValues).toContain('Asics');
  });

  it('renders the empty-state when no competitors are configured', () => {
    renderAt('/reports/competitor', []);
    const matches = screen.getAllByText(/no competitors configured/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders loading placeholders when the rollup is loading', () => {
    mockGap.mockReturnValue({
      ...POPULATED_DATA,
      rollup: null,
      loading: true,
      error: null,
      ready: false,
    });
    renderAt('/reports/competitor/Adidas');
    expect(screen.getByText(/Loading rollup/i)).toBeInTheDocument();
  });

  it('renders error message when the rollup hook reports an error', () => {
    mockGap.mockReturnValue({
      ...POPULATED_DATA,
      rollup: null,
      loading: false,
      error: 'Backend exploded',
      ready: true,
    });
    renderAt('/reports/competitor/Adidas');
    // The error propagates to all three sections (each renders its own
    // error placeholder).
    const matches = screen.getAllByText('Backend exploded');
    expect(matches.length).toBeGreaterThan(0);
  });
});
