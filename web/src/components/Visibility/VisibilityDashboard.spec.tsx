import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityDashboard } from './VisibilityDashboard';
import type {
  GroupVisibilityResponse, Keyword, VisibilityMetricsResponse
} from '../../types';

vi.mock('../../hooks/useVisibilityMetrics', () => ({ useVisibilityMetrics: vi.fn() }));
vi.mock('../../hooks/useHistoricalTrends', () => ({ useHistoricalTrends: vi.fn() }));
vi.mock('../../hooks/usePersonaRankings', () => ({ usePersonaRankings: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('./groupOverviewExport', () => ({ exportGroupOverview: vi.fn() }));
vi.mock('../Personas/PersonaSelector', () => ({ PersonaSelector: () => <div>Persona selector</div> }));

import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import {
  buildKeywordGroup, buildKeywordGroupsHookResult
} from '../../hooks/useKeywordGroups-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
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

const groups = [buildKeywordGroup()];

const groupVisibility: GroupVisibilityResponse = {
  scope: {
    kind: 'group',
    label: '1 group(s)',
    keyword_count: 2
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
      first_party_best_rank: 1,
      answers: 4,
      mentioned_answers: 3,
      rank_1_share: 50,
      top_3_share: 75,
      mean_rank: 2,
      mean_first_position: 24,
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
      first_party_best_rank: null,
      answers: 0,
      mentioned_answers: 0,
      rank_1_share: 0,
      top_3_share: 0,
      mean_rank: null,
      mean_first_position: null,
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
    first_party_mean_best_rank: 1,
    rank_1_share: 50,
    top_3_share: 75,
    mean_rank: 2,
    mean_first_position: 24,
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
  prominence: {
    answers: 4,
    mentioned_answers: 3,
    rank_1_share: 50,
    top_3_share: 75,
    mean_rank: 2,
    mean_first_position: 24,
  },
  summary: {
    first_party_avg_score: 75,
    competitor_avg_score: 60,
    first_party_total_sov: 30,
    competitor_total_sov: 70,
  },
};

const rankSortingVisibility = {
  ...groupVisibility,
  keywords_analyzed: 3,
  keywords_with_data: 3,
  keywords: [
    {
      ...groupVisibility.keywords[0],
      keyword: 'rank two',
      first_party_best_rank: 2,
    },
    {
      ...groupVisibility.keywords[0],
      keyword: 'unranked',
      first_party_best_rank: null,
    },
    {
      ...groupVisibility.keywords[0],
      keyword: 'rank one',
      first_party_best_rank: 1,
    },
  ],
} satisfies GroupVisibilityResponse;

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

function mockTrends(overrides: { loading?: boolean } = {}) {
  const fetchHistoricalTrends = vi.fn();
  mockUseHistoricalTrends.mockReturnValue({
    data: null,
    loading: overrides.loading ?? false,
    error: null,
    fetchHistoricalTrends,
  });
  return fetchHistoricalTrends;
}

describe('VisibilityDashboard', () => {
  beforeEach(() => {
    mockVisibility(null);
    mockTrends();
    mockUsePersonaRankings.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchPersonaRankings: vi.fn(),
    });
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult(groups));
  });

  describe('initial render', () => {
    it('renders title and scope description', () => {
      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/Track how visible your brand is/)).toBeInTheDocument();
    });

    it('offers all keywords every group and each keyword in scope selector', () => {
      render(<VisibilityDashboard keywords={keywords} />);

      expect(renderedScopeOptionLabels('Analyze')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
    });

    it('loads all-keywords visibility and history by default', () => {
      const fetchVisibilityMetrics = mockVisibility(null);
      const fetchHistoricalTrends = mockTrends();

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

    it('shows loading message when trends are loading', () => {
      mockTrends({ loading: true });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });
  });

  describe('group overview', () => {
    it('shows Citation rate only for the group visibility coverage KPI', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Citation rate')).toBeInTheDocument();
      expect(screen.queryByText('Coverage')).not.toBeInTheDocument();
    });

    it('shows rank-one top-three and mean-rank prominence values', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Prominence').parentElement).toHaveTextContent(
        'Prominence50%rank-#1 share · top-3 75% · mean rank 2'
      );
    });

    it('shows best rank in the per-keyword table', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);
      const keywordTable = screen.getByRole('table', { name: 'Keywords in this scope' });

      expect(within(keywordTable).getByRole('button', { name: 'Best rank' })).toBeInTheDocument();
      expect(within(keywordTable).getByText('1')).toBeInTheDocument();
      expect(screen.getByText(/1 of 2 keywords have analysis data/)).toBeInTheDocument();
    });

    it('lists keywords without data at the bottom with a hint', () => {
      mockVisibility(groupVisibility);

      render(<VisibilityDashboard keywords={keywords} />);
      const rows = within(screen.getByRole('table', { name: 'Keywords in this scope' })).getAllByRole('row');

      expect(rows[rows.length - 1]).toHaveTextContent('resortsNo analysis data yet');
    });

    it('keeps unavailable best ranks last in both sort directions', async () => {
      mockVisibility(rankSortingVisibility);

      render(<VisibilityDashboard keywords={keywords} />);
      const keywordTable = screen.getByRole('table', { name: 'Keywords in this scope' });
      await userEvent.click(within(keywordTable).getByRole('button', { name: 'Best rank' }));

      expect(within(keywordTable).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)).toStrictEqual([
        'rank one',
        'rank two',
        'unranked',
      ]);

      await userEvent.click(within(keywordTable).getByRole('button', { name: 'Best rank ↑' }));

      expect(within(keywordTable).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)).toStrictEqual([
        'rank two',
        'rank one',
        'unranked',
      ]);
    });

    it('re-fetches history when range changes', async () => {
      mockVisibility(groupVisibility);
      const fetchHistoricalTrends = mockTrends();

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.click(screen.getByRole('button', { name: '90 days' }));

      expect(fetchHistoricalTrends).toHaveBeenCalledWith({ kind: 'all' }, 'day', 90);
    });

    it('exports the exact rendered group overview', async () => {
      mockVisibility(groupVisibility);
      mockExportGroupOverview.mockResolvedValue();

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

      expect(mockExportGroupOverview).toHaveBeenCalledWith(groupVisibility, null, 'All keywords');
    });
  });

  describe('per-keyword mode', () => {
    it('fetches selected keyword visibility and history', async () => {
      const fetchVisibilityMetrics = mockVisibility(null);
      const fetchHistoricalTrends = mockTrends();

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

    it('fetches selected keyword group', async () => {
      const fetchVisibilityMetrics = mockVisibility(null);

      render(<VisibilityDashboard keywords={keywords} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'group:group-coruna');

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith({
        kind: 'group',
        groupId: 'group-coruna'
      }, undefined);
    });

    it('renders brand ranking values for a single keyword', () => {
      mockVisibility(keywordVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Brand Rankings')).toBeInTheDocument();
      expect(screen.getByText('Marriott')).toBeInTheDocument();
    });

    it('shows single-keyword prominence with rank context', () => {
      mockVisibility(keywordVisibility);

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('Prominence')).toBeInTheDocument();
      expect(screen.getByText('50.0%')).toBeInTheDocument();
      expect(screen.getByText('rank-#1 share · top-3 75.0% · mean rank 2')).toBeInTheDocument();
    });

    it('renders sentinel best rank as unavailable', () => {
      mockVisibility({
        ...keywordVisibility,
        brands: [{
          ...keywordVisibility.brands[0],
          best_rank: 999,
        }],
      });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('999')).not.toBeInTheDocument();
    });

    it('shows no-data message when keyword has no brands', () => {
      mockVisibility({
        ...keywordVisibility,
        brands: []
      });

      render(<VisibilityDashboard keywords={keywords} />);

      expect(screen.getByText('No brand data available.')).toBeInTheDocument();
    });
  });

  describe('empty keywords', () => {
    it('renders without fetching when keywords are empty', () => {
      const fetchVisibilityMetrics = mockVisibility(null);

      render(<VisibilityDashboard keywords={[]} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(fetchVisibilityMetrics).not.toHaveBeenCalled();
    });
  });
});
