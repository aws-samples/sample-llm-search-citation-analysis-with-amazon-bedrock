import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen
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
import { clickExportToExcel } from './overviewRender-fixtures';
import {
  clickRangeButton, historyPanel, scopeLine
} from './visibilityTables-fixtures';
import type {
  HistoricalTrendsResponse, Keyword, KeywordGroup, PersonaRankingsResponse, VisibilityResponse
} from '../../types';

type HookStateOverrides = Parameters<typeof buildVisibilityHookResult>[1];

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

/** Makes `useVisibilityMetrics` return `data` in the given state; returns the hook result. */
function stubVisibility(data: VisibilityResponse | null, overrides?: HookStateOverrides) {
  const hook = buildVisibilityHookResult(data, overrides);
  vi.mocked(useVisibilityMetrics).mockReturnValue(hook);
  return hook;
}

/** Makes `useHistoricalTrends` return `data` in the given state; returns the hook result. */
function stubTrends(data: HistoricalTrendsResponse | null, overrides?: HookStateOverrides) {
  const hook = buildTrendsHookResult(data, overrides);
  vi.mocked(useHistoricalTrends).mockReturnValue(hook);
  return hook;
}

/** Makes `usePersonaRankings` return `data`; returns the hook result. */
function stubPersonaRankings(data: PersonaRankingsResponse | null) {
  const hook = buildPersonaRankingsHookResult(data);
  vi.mocked(usePersonaRankings).mockReturnValue(hook);
  return hook;
}

function renderDashboard(keywords: Keyword[] = SCOPE_KEYWORDS) {
  return render(<VisibilityDashboard keywords={keywords} />);
}

/** Renders the dashboard over the scope keywords and picks the scope `option` ("all", "keyword:hotels", "group:<id>"). */
async function renderDashboardScoped(option: string) {
  const view = renderDashboard();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), option);
  return view;
}

describe('VisibilityDashboard', () => {
  beforeEach(() => {
    stubVisibility(null);
    stubTrends(null);
    stubPersonaRankings(SINGLE_PERSONA_RANKINGS);
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult([buildKeywordGroup()]));
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      renderDashboard();

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/Track how visible your brand is/)).toBeInTheDocument();
    });

    it('offers all keywords, every group and every keyword in the scope selector', () => {
      renderDashboard();

      expect(renderedScopeOptionLabels('Analyze')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
    });

    it('loads all-keywords visibility and 30 days of daily history by default', () => {
      const visibilityHook = stubVisibility(null);
      const trendsHook = stubTrends(null);

      renderDashboard();

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenCalledWith({ kind: 'all' }, undefined);
      expect(trendsHook.fetchHistoricalTrends).toHaveBeenCalledWith({ kind: 'all' }, 'day', 30);
    });

    it('renders without fetching when there are no keywords', () => {
      const visibilityHook = stubVisibility(null);

      renderDashboard([]);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(visibilityHook.fetchVisibilityMetrics).not.toHaveBeenCalled();
    });

    it('shows no overview until visibility is loaded', () => {
      renderDashboard();

      expect(screen.queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument();
    });
  });

  describe('loading and errors', () => {
    it.each([
      ['visibility', { loading: true }, {}],
      ['trends', {}, { loading: true }],
    ])('shows the loading message while %s load', (_request, visibilityState, trendsState) => {
      stubVisibility(null, visibilityState);
      stubTrends(null, trendsState);

      renderDashboard();

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });

    it('hides the loading message once both requests are done', () => {
      renderDashboard();

      expect(screen.queryByText('Loading visibility data...')).not.toBeInTheDocument();
    });

    it('shows the visibility error once loading is over', () => {
      stubVisibility(null, { error: 'Unable to load visibility metrics' });

      renderDashboard();

      expect(screen.getByText('Unable to load visibility metrics')).toBeInTheDocument();
    });

    it('hides the visibility error while a new request loads', () => {
      stubVisibility(null, {
        loading: true,
        error: 'Unable to load visibility metrics',
      });

      renderDashboard();

      expect(screen.queryByText('Unable to load visibility metrics')).not.toBeInTheDocument();
    });

    it('shows a trends error in the history panel', () => {
      stubVisibility(visibility);
      stubTrends(null, { error: 'Failed to fetch historical trends' });

      renderDashboard();

      expect(historyPanel().getByText('History unavailable: Failed to fetch historical trends')).toBeInTheDocument();
    });
  });

  describe('overview', () => {
    beforeEach(() => {
      stubVisibility(visibility);
    });

    it('describes the selected scope above the overview', () => {
      renderDashboard();

      expect(scopeLine()).toHaveTextContent(/^All keywords · 1 of 2 keywords have analysis data/);
    });

    it('exports the rendered overview under the scope label', async () => {
      stubTrends(trends);
      mockExportVisibilityOverview.mockResolvedValue();

      renderDashboard();
      await clickExportToExcel();

      expect(mockExportVisibilityOverview).toHaveBeenCalledWith(visibility, trends, 'All keywords');
    });

    it('leaves the persona comparison out of a scope wider than one keyword', () => {
      renderDashboard();

      expect(screen.queryByText(TOO_FEW_PERSONAS)).not.toBeInTheDocument();
    });
  });

  describe('scope selection', () => {
    it('fetches the selected keyword visibility, history and persona rankings', async () => {
      const visibilityHook = stubVisibility(null);
      const trendsHook = stubTrends(null);
      const personaHook = stubPersonaRankings(null);

      await renderDashboardScoped('keyword:hotels');

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenLastCalledWith(HOTELS_SCOPE, undefined);
      expect(trendsHook.fetchHistoricalTrends).toHaveBeenLastCalledWith(HOTELS_SCOPE, 'day', 30);
      expect(personaHook.fetchPersonaRankings).toHaveBeenCalledWith('hotels');
    });

    it('fetches the selected keyword group', async () => {
      const visibilityHook = stubVisibility(null);

      await renderDashboardScoped('group:group-coruna');

      expect(visibilityHook.fetchVisibilityMetrics).toHaveBeenLastCalledWith({
        kind: 'group',
        groupId: 'group-coruna'
      }, undefined);
    });

    it('fetches no persona rankings for all keywords', () => {
      const personaHook = stubPersonaRankings(null);

      renderDashboard();

      expect(personaHook.fetchPersonaRankings).not.toHaveBeenCalled();
    });

    describe('with visibility loaded', () => {
      beforeEach(() => {
        stubVisibility(visibility);
      });

      it.each([
        ['all keywords', 'all', { kind: 'all' }, 90],
        ['a single keyword', 'keyword:hotels', HOTELS_SCOPE, 7],
      ] as const)('re-fetches the history of %s when the range changes', async (_scope, option, scope, days) => {
        const trendsHook = stubTrends(trends);

        await renderDashboardScoped(option);
        await clickRangeButton(days);

        expect(trendsHook.fetchHistoricalTrends).toHaveBeenLastCalledWith(scope, 'day', days);
      });

      it('adds the persona comparison for a single keyword', async () => {
        await renderDashboardScoped('keyword:hotels');

        expect(screen.getByText(TOO_FEW_PERSONAS)).toBeInTheDocument();
      });

      it.each<[string, string, Keyword[], KeywordGroup[], string]>([
        ['falls back to all keywords when the selected keyword is deleted', 'keyword:hotels', [SCOPE_KEYWORDS[1]], [], 'All keywords'],
        ['falls back to all keywords when the selected group is deleted', 'group:group-coruna', [], [OTHER_GROUP], 'All keywords'],
        ['keeps the selected keyword while keywords and groups are still loading', 'keyword:hotels', [], [], 'hotels'],
      ])('%s', async (_outcome, option, keywordsAfter, groupsAfter, scopeLabel) => {
        const { rerender } = await renderDashboardScoped(option);
        mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult(groupsAfter));
        rerender(<VisibilityDashboard keywords={keywordsAfter} />);

        expect(scopeLine().textContent?.split(' · ')[0]).toBe(scopeLabel);
      });
    });
  });
});
