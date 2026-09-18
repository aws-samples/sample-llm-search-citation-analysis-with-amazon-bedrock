import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityDashboard } from './VisibilityDashboard';
import type {
  GroupVisibilityResponse, Keyword, KeywordGroup, VisibilityMetricsResponse 
} from '../../types';

vi.mock('../../hooks/useVisibilityMetrics', () => ({ useVisibilityMetrics: vi.fn() }));
vi.mock('../../hooks/useHistoricalTrends', () => ({ useHistoricalTrends: vi.fn() }));
vi.mock('../../hooks/usePersonaRankings', () => ({ usePersonaRankings: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('./groupOverviewExport', () => ({ exportGroupOverview: vi.fn() }));

import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { exportGroupOverview } from './groupOverviewExport';

const mockUseVisibilityMetrics = vi.mocked(useVisibilityMetrics);
const mockUseHistoricalTrends = vi.mocked(useHistoricalTrends);
const mockUsePersonaRankings = vi.mocked(usePersonaRankings);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);
const mockExportGroupOverview = vi.mocked(exportGroupOverview);

const keywords: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'hotels',
    created_at: '2026-01-01T00:00:00Z',
    group_ids: ['group-coruna'] 
  },
  {
    id: 'kw-2',
    keyword: 'resorts',
    created_at: '2026-01-02T00:00:00Z' 
  },
];

const groups: KeywordGroup[] = [{
  id: 'group-coruna',
  name: 'Hotel Coruña',
  description: '',
  keyword_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}];

const groupVisibility: GroupVisibilityResponse = {
  scope: {
    kind: 'group',
    label: '1 group(s)',
    keyword_count: 1 
  },
  timestamp: '2026-09-18T10:00:00Z',
  total_providers: 4,
  keywords_analyzed: 2,
  keywords_with_data: 1,
  keywords: [
    {
      keyword: 'hotels',
      has_data: true,
      timestamp: '2026-09-18T10:00:00Z',
      first_party_score: 72.5,
      competitor_score: 40.1,
      first_party_sov: 55,
      competitor_sov: 45,
      first_party_providers: 3,
      total_mentions: 9,
      first_party_mentioned: true,
    },
    {
      keyword: 'resorts',
      has_data: false,
      timestamp: null,
      first_party_score: 0,
      competitor_score: 0,
      first_party_sov: 0,
      competitor_sov: 0,
      first_party_providers: 0,
      total_mentions: 0,
      first_party_mentioned: false,
    },
  ],
  brands: [{
    name: 'Marriott',
    classification: 'first_party',
    visibility_score: 72.5,
    share_of_voice: 55,
    provider_count: 3,
    providers: ['openai', 'gemini', 'perplexity'],
    total_mentions: 9,
    best_rank: 1,
    keyword_count: 1,
  }],
  first_party: [],
  competitors: [],
  others: [],
  summary: {
    first_party_avg_score: 72.5,
    competitor_avg_score: 40.1,
    first_party_avg_sov: 55,
    competitor_avg_sov: 45,
    coverage_rate: 100,
    provider_coverage: 75,
  },
};

const keywordVisibility: VisibilityMetricsResponse = {
  keyword: 'hotels',
  timestamp: '2026-09-18T10:00:00Z',
  total_brands: 1,
  total_mentions: 10,
  brands: [{
    name: 'Marriott',
    visibility_score: 80,
    provider_count: 1,
    providers: ['openai'],
    total_mentions: 10,
    best_rank: 1,
    avg_sentiment: 0.5,
    share_of_voice: 30,
    classification: 'first_party',
  }],
  first_party: [],
  competitors: [],
  others: [],
  summary: {
    first_party_avg_score: 75,
    competitor_avg_score: 60,
    first_party_total_sov: 30,
    competitor_total_sov: 70,
  },
};

function mockVisibility(data: GroupVisibilityResponse | VisibilityMetricsResponse | null, overrides: {
  loading?: boolean;
  error?: string | null 
} = {}) {
  const fetchVisibilityMetrics = vi.fn();
  mockUseVisibilityMetrics.mockReturnValue({
    data,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    fetchVisibilityMetrics,
  });
  return fetchVisibilityMetrics;
}

describe('VisibilityDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibility(null);
    mockUseHistoricalTrends.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchHistoricalTrends: vi.fn(),
    });
    mockUsePersonaRankings.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchPersonaRankings: vi.fn(),
    });
    mockUseKeywordGroups.mockReturnValue({
      groups,
      loading: false,
      error: null,
      refresh: vi.fn(),
      createGroup: vi.fn(),
      renameGroup: vi.fn(),
      removeGroup: vi.fn(),
      changeMemberships: vi.fn(),
    });
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/Track how visible your brand is/)).toBeInTheDocument();
    });

    it('offers all keywords, every group and every keyword in the scope selector', () => {
      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByRole('option', { name: 'All keywords' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Hotel Coruña (1)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'hotels' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'resorts' })).toBeInTheDocument();
    });

    it('loads the all-keywords overview by default', () => {
      const fetchVisibilityMetrics = mockVisibility(null);
      const fetchHistoricalTrends = vi.fn();
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchHistoricalTrends,
      });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith({ kind: 'all' }, undefined);
      expect(fetchHistoricalTrends).toHaveBeenCalledWith({ kind: 'all' }, 'day', 30);
    });
  });

  describe('loading state', () => {
    it('shows loading message when visibility is loading', () => {
      mockVisibility(null, { loading: true });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });

    it('shows loading message when trends is loading', () => {
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        fetchHistoricalTrends: vi.fn(),
      });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });
  });

  describe('group overview', () => {
    it('shows the group KPIs and the per-keyword table', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Your visibility')).toBeInTheDocument();
      expect(screen.getByText('Coverage')).toBeInTheDocument();
      expect(screen.getByText('Keywords in this scope')).toBeInTheDocument();
      expect(screen.getByText(/1 of 2 keywords have analysis data/)).toBeInTheDocument();
    });

    it('lists keywords without data at the bottom with a hint', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('No analysis data yet')).toBeInTheDocument();
    });

    it('re-fetches the history when the range changes', async () => {
      mockVisibility(groupVisibility);
      const fetchHistoricalTrends = vi.fn();
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchHistoricalTrends,
      });

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.click(screen.getByRole('button', { name: '90 days' }));

      expect(fetchHistoricalTrends).toHaveBeenCalledWith({ kind: 'all' }, 'day', 90);
    });

    it('exports the overview to Excel', async () => {
      mockVisibility(groupVisibility);
      mockExportGroupOverview.mockResolvedValue();

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

      expect(mockExportGroupOverview).toHaveBeenCalledWith(groupVisibility, null, 'All keywords');
    });
  });

  describe('per-keyword mode', () => {
    it('fetches the keyword when one is selected', async () => {
      const fetchVisibilityMetrics = mockVisibility(null);
      const fetchHistoricalTrends = vi.fn();
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchHistoricalTrends,
      });

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'keyword:resorts');

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith({
        kind: 'keyword',
        keyword: 'resorts' 
      }, undefined);
      expect(fetchHistoricalTrends).toHaveBeenCalledWith({
        kind: 'keyword',
        keyword: 'resorts' 
      }, 'day', 30);
    });

    it('fetches a group when one is selected', async () => {
      const fetchVisibilityMetrics = mockVisibility(null);

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'group:group-coruna');

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith({
        kind: 'group',
        groupId: 'group-coruna' 
      }, undefined);
    });

    it('renders the brand rankings table for a single keyword', () => {
      mockVisibility(keywordVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Brand Rankings')).toBeInTheDocument();
      expect(screen.getByText('Marriott')).toBeInTheDocument();
    });

    it('shows no data message when the keyword has no brands', () => {
      mockVisibility({
        ...keywordVisibility,
        brands: [] 
      });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('No brand data available.')).toBeInTheDocument();
    });
  });

  describe('empty keywords', () => {
    it('renders without fetching when keywords is empty', () => {
      const fetchVisibilityMetrics = mockVisibility(null);

      render(<VisibilityDashboard keywords={[]} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(fetchVisibilityMetrics).not.toHaveBeenCalled();
    });
  });
});
