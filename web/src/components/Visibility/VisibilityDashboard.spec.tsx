import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityDashboard } from './VisibilityDashboard';

vi.mock('../../hooks/useVisibilityMetrics', () => ({ useVisibilityMetrics: vi.fn() }));
vi.mock('../../hooks/useHistoricalTrends', () => ({ useHistoricalTrends: vi.fn() }));
vi.mock('../../hooks/usePersonaRankings', () => ({ usePersonaRankings: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('./visibilityOverviewExport', () => ({ exportVisibilityOverview: vi.fn() }));
vi.mock('../Personas/PersonaSelector', () => ({ PersonaSelector: () => <div>Persona selector</div> }));

import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import {
  buildKeywordGroup, buildKeywordGroupsHookResult
} from '../../hooks/useKeywordGroups-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import { exportVisibilityOverview } from './visibilityOverviewExport';
import {
  SINGLE_PERSONA_RANKINGS, TOO_FEW_PERSONAS, buildPersonaRankingsHookResult, buildTrendsHookResult, buildVisibilityHookResult
} from './VisibilityDashboard-fixtures';
import {
  buildTrendsResponse, buildVisibility
} from './visibilityOverview-fixtures';
import { panelTitled } from './visibilityTables-fixtures';
import { HISTORY_TITLE } from './VisibilityHistory';
import type {
  Keyword, KeywordGroup
} from '../../types';

const mockUseVisibilityMetrics = vi.mocked(useVisibilityMetrics);
const mockUseHistoricalTrends = vi.mocked(useHistoricalTrends);
const mockUsePersonaRankings = vi.mocked(usePersonaRankings);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);
const mockExportVisibilityOverview = vi.mocked(exportVisibilityOverview);

const visibility = buildVisibility();
const trends = buildTrendsResponse();
const OTHER_GROUP = buildKeywordGroup({
  id: 'group-madrid',
  name: 'Hotel Madrid',
});
const HOTELS_SCOPE = {
  kind: 'keyword',
  keyword: 'hotels',
} as const;

describe('VisibilityDashboard', () => {
  beforeEach(() => {
    mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(null));
    mockUseHistoricalTrends.mockReturnValue(buildTrendsHookResult(null));
    mockUsePersonaRankings.mockReturnValue(buildPersonaRankingsHookResult(SINGLE_PERSONA_RANKINGS));
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult([buildKeywordGroup()]));
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/Track how visible your brand is/)).toBeInTheDocument();
    });

    it('offers all keywords, every group and every keyword in the scope selector', () => {
      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(renderedScopeOptionLabels('Analyze')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
    });

    it('loads all-keywords visibility and 30 days of daily history by default', () => {
      const visibilityHook = buildVisibilityHookResult(null);
      const trendsHook = buildTrendsHookResult(null);
      mockUseVisibilityMetrics.mockReturnValue(visibilityHook);
      mockUseHistoricalTrends.mockReturnValue(trendsHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenCalledWith({ kind: 'all' }, undefined);
      expect(trendsHook.fetchHistoricalTrends).toHaveBeenCalledWith({ kind: 'all' }, 'day', 30);
    });

    it('renders without fetching when there are no keywords', () => {
      const visibilityHook = buildVisibilityHookResult(null);
      mockUseVisibilityMetrics.mockReturnValue(visibilityHook);

      render(<VisibilityDashboard keywords={[]} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(visibilityHook.fetchVisibilityMetrics).not.toHaveBeenCalled();
    });

    it('shows no overview until visibility is loaded', () => {
      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument();
    });
  });

  describe('loading and errors', () => {
    it.each([
      ['visibility', buildVisibilityHookResult(null, { loading: true }), buildTrendsHookResult(null)],
      ['trends', buildVisibilityHookResult(null), buildTrendsHookResult(null, { loading: true })],
    ])('shows the loading message while %s load', (_request, visibilityHook, trendsHook) => {
      mockUseVisibilityMetrics.mockReturnValue(visibilityHook);
      mockUseHistoricalTrends.mockReturnValue(trendsHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });

    it('hides the loading message once both requests are done', () => {
      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.queryByText('Loading visibility data...')).not.toBeInTheDocument();
    });

    it('shows the visibility error once loading is over', () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(null, { error: 'Unable to load visibility metrics' }));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.getByText('Unable to load visibility metrics')).toBeInTheDocument();
    });

    it('hides the visibility error while a new request loads', () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(null, {
        loading: true,
        error: 'Unable to load visibility metrics',
      }));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.queryByText('Unable to load visibility metrics')).not.toBeInTheDocument();
    });

    it('shows a trends error in the history panel', () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));
      mockUseHistoricalTrends.mockReturnValue(buildTrendsHookResult(null, { error: 'Failed to fetch historical trends' }));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(within(panelTitled(HISTORY_TITLE)).getByText('History unavailable: Failed to fetch historical trends')).toBeInTheDocument();
    });
  });

  describe('overview', () => {
    it('describes the selected scope above the overview', () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.getByText(/keywords have analysis data/)).toHaveTextContent(/^All keywords · 1 of 2 keywords have analysis data/);
    });

    it('exports the rendered overview under the scope label', async () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));
      mockUseHistoricalTrends.mockReturnValue(buildTrendsHookResult(trends));
      mockExportVisibilityOverview.mockResolvedValue();

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

      expect(mockExportVisibilityOverview).toHaveBeenCalledWith(visibility, trends, 'All keywords');
    });

    it('leaves the persona comparison out of a scope wider than one keyword', () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(screen.queryByText(TOO_FEW_PERSONAS)).not.toBeInTheDocument();
    });
  });

  describe('scope selection', () => {
    it('fetches the selected keyword visibility, history and persona rankings', async () => {
      const visibilityHook = buildVisibilityHookResult(null);
      const trendsHook = buildTrendsHookResult(null);
      const personaHook = buildPersonaRankingsHookResult(null);
      mockUseVisibilityMetrics.mockReturnValue(visibilityHook);
      mockUseHistoricalTrends.mockReturnValue(trendsHook);
      mockUsePersonaRankings.mockReturnValue(personaHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'keyword:hotels');

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenLastCalledWith(HOTELS_SCOPE, undefined);
      expect(trendsHook.fetchHistoricalTrends).toHaveBeenLastCalledWith(HOTELS_SCOPE, 'day', 30);
      expect(personaHook.fetchPersonaRankings).toHaveBeenCalledWith('hotels');
    });

    it('fetches the selected keyword group', async () => {
      const visibilityHook = buildVisibilityHookResult(null);
      mockUseVisibilityMetrics.mockReturnValue(visibilityHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'group:group-coruna');

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenLastCalledWith({
        kind: 'group',
        groupId: 'group-coruna'
      }, undefined);
    });

    it.each([
      ['all keywords', 'all', { kind: 'all' }, 90],
      ['a single keyword', 'keyword:hotels', HOTELS_SCOPE, 7],
    ] as const)('re-fetches the history of %s when the range changes', async (_scope, option, scope, days) => {
      const trendsHook = buildTrendsHookResult(trends);
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));
      mockUseHistoricalTrends.mockReturnValue(trendsHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), option);
      await userEvent.click(screen.getByRole('button', { name: `${days} days` }));

      expect(trendsHook.fetchHistoricalTrends).toHaveBeenLastCalledWith(scope, 'day', days);
    });

    it('adds the persona comparison for a single keyword', async () => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'keyword:hotels');

      expect(screen.getByText(TOO_FEW_PERSONAS)).toBeInTheDocument();
    });

    it('fetches no persona rankings for all keywords', () => {
      const personaHook = buildPersonaRankingsHookResult(null);
      mockUsePersonaRankings.mockReturnValue(personaHook);

      render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);

      expect(personaHook.fetchPersonaRankings).not.toHaveBeenCalled();
    });

    it.each<[string, string, Keyword[], KeywordGroup[], string]>([
      ['falls back to all keywords when the selected keyword is deleted', 'keyword:hotels', [SCOPE_KEYWORDS[1]], [], 'All keywords'],
      ['falls back to all keywords when the selected group is deleted', 'group:group-coruna', [], [OTHER_GROUP], 'All keywords'],
      ['keeps the selected keyword while keywords and groups are still loading', 'keyword:hotels', [], [], 'hotels'],
    ])('%s', async (_outcome, option, keywordsAfter, groupsAfter, scopeLabel) => {
      mockUseVisibilityMetrics.mockReturnValue(buildVisibilityHookResult(visibility));

      const { rerender } = render(<VisibilityDashboard keywords={SCOPE_KEYWORDS} />);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), option);
      mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult(groupsAfter));
      rerender(<VisibilityDashboard keywords={keywordsAfter} />);

      expect(screen.getByText(/keywords have analysis data/).textContent?.split(' · ')[0]).toBe(scopeLabel);
    });
  });
});
