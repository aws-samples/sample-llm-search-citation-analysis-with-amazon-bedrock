import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContentActionPlanReport } from './ContentActionPlanReport';

vi.mock('./useContentActionPlan', () => ({useContentActionPlan: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));

import { useContentActionPlan } from './useContentActionPlan';

const mockUse = useContentActionPlan as ReturnType<typeof vi.fn>;

const POPULATED = {
  gaps: {
    total_gaps: 18,
    total_high_priority: 5,
    summary: {
      gap_count: 18,
      high_priority_gaps: 5,
      total_sources: 50,
      covered_count: 32,
      coverage_rate: 64 
    },
    top_gaps: [
      {
        url: 'https://www.example.com/best-shoes',
        domain: 'example.com',
        citation_count: 7,
        provider_count: 3,
        priority: 'high',
        keyword: 'best running shoes',
        first_party_brands: [],
        competitor_brands: ['Nike', 'Adidas'],
        providers: ['openai', 'perplexity', 'gemini'],
        gap_type: 'competitor_only',
      },
    ],
    keyword_summaries: [
      {
        keyword: 'best running shoes',
        gap_count: 6,
        high_priority_gaps: 3,
        coverage_rate: 50 
      },
      {
        keyword: 'best hiking boots',
        gap_count: 0,
        high_priority_gaps: 0,
        coverage_rate: 100 
      },
    ],
    gaps: [],
    covered_sources: [],
    domain_summary: [],
  },
  gapsLoading: false,
  gapsError: null,
  ideas: [
    {
      id: 'i1',
      type: 'visibility_gap',
      priority: 'high',
      title: 'Comprehensive Guide to Running Shoes',
      description: 'A long-form comparison piece.',
      keyword: 'best running shoes',
      source: 'analysis',
      actionable: true,
      content_angle: 'comprehensive_guide',
    },
  ],
  history: [
    {
      id: 'h1',
      keyword: 'best running shoes',
      idea_type: 'visibility_gap',
      idea_title: 'Comprehensive Guide to Running Shoes',
      content_angle: 'comprehensive_guide',
      generated_content: {
        title: 'Best Running Shoes 2026',
        meta_description: 'A buyer\'s guide.',
        body: '…',
        suggested_headings: [],
        key_points: ['Cushioning matters most', 'Drop affects gait'],
      },
      raw_content: '',
      competitor_sources_used: 3,
      status: 'generated',
      viewed: false,
      created_at: '2026-05-10T00:00:00Z',
      updated_at: '2026-05-10T00:00:00Z',
    },
  ],
  studioLoading: false,
  studioError: null,
  ready: true,
};

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/reports/content-action-plan']}>
      <ContentActionPlanReport />
    </MemoryRouter>,
  );
}

describe('ContentActionPlanReport', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(POPULATED);
  });

  it('renders the report H1', () => {
    renderReport();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Content Action Plan/i 
      }),
    ).toBeInTheDocument();
  });

  it('renders the headline citation gap count', () => {
    renderReport();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('renders the top citation target row', () => {
    renderReport();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('renders the brief title for ready content', () => {
    renderReport();
    expect(screen.getByText('Best Running Shoes 2026')).toBeInTheDocument();
  });
});
