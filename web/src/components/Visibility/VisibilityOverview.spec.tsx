import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor, within
} from '@testing-library/react';
import { renderOverview } from './overviewRender-fixtures';
import {
  GROUP_ENGINES_CAPTION, GROUP_SHARE_OF_VOICE_CAPTION, GROUP_SOURCES_CAPTION, GROUP_TREND_CAPTION, buildKeywordRow, buildTrendsResponse,
  buildVisibility
} from './visibilityOverview-fixtures';
import {
  historyPanel, panelTitled, scopeLine
} from './visibilityTables-fixtures';
import { HISTORY_TITLE } from './VisibilityHistory';
import {
  ENGINES_TITLE, SOURCES_TITLE
} from './VisibilityChartPanels';
import {
  definitionTerms, VISIBILITY_DEFINITION_TERMS, headlineCardLabels, statFigure, statFootnote
} from '../Reports/layout/reportQueries-fixtures';
import { NO_PREVIOUS_RUN } from '../Reports/layout/periodComparison';
import { OWNED_DOMAINS_MISSING } from '../Reports/layout/KpiHeadline';
import { RUN_2 } from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import { formatDate } from '../../formatting/dateFormatter';

vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';

const REQUEST = {
  path: '/visibility',
  params: new URLSearchParams({
    group_id: 'hotel-sol',
    market_id: 'es',
    query_prompt_id: 'familia',
  }),
};

describe('VisibilityOverview', () => {
  describe('scope line', () => {
    it('names the scope, its keywords with data and the latest run', () => {
      renderOverview();

      expect(scopeLine().textContent).toBe(
        `Hotel Sol · 1 of 2 keywords have analysis data · latest run ${formatDate(RUN_2)}`
      );
    });

    it('says there is no run yet when no keyword was analysed', () => {
      renderOverview({
        visibility: buildVisibility({
          timestamp: null,
          keywords_with_data: 0,
        }),
      });

      expect(scopeLine().textContent).toBe('Hotel Sol · 0 of 2 keywords have analysis data · no analysis run yet');
    });

    it('never claims only the first keywords are included when the scope is truncated', () => {
      renderOverview({ visibility: buildVisibility({ keywords_truncated: true }) });

      expect(scopeLine()).not.toHaveTextContent('only the first');
    });
  });

  describe('headline', () => {
    it('shows the four headline KPIs as cards', () => {
      renderOverview();

      expect(headlineCardLabels()).toStrictEqual(['Mention rate', 'Share of voice', 'Visibility score', 'Citation rate']);
    });

    it('shows the citation rate, not the keyword coverage, on the citation rate card', () => {
      renderOverview();

      expect(statFigure('Citation rate')).toHaveTextContent('30.0%');
    });

    it('drops the old provider coverage and prominence cards', () => {
      renderOverview();

      expect(screen.queryByText(/Provider coverage|Prominence/)).not.toBeInTheDocument();
    });

    it('shows each change against the previous run over the keywords compared', () => {
      renderOverview();

      expect(statFootnote('Mention rate')).toBe('-10.0 pts vs previous run (1 keyword)');
    });

    it.each([
      ['trends are not loaded', null],
      ['the trend has a change', buildTrendsResponse()],
    ])('says there is no earlier run when the keywords were analysed once, even if %s', (_condition, trends) => {
      renderOverview({
        visibility: buildVisibility({ change: null }),
        trends 
      });

      expect(statFootnote('Visibility score')).toBe(NO_PREVIOUS_RUN);
    });

    it('asks for owned domains on the citation rate card until they are configured', () => {
      renderOverview({ visibility: buildVisibility({ citations_configured: false }) });

      expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
    });
  });

  describe('panels', () => {
    it('shows the headline, history, keywords, share of voice, leaderboard, engines, domains and definitions in that order', () => {
      renderOverview();

      expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toStrictEqual([
        'Headline',
        HISTORY_TITLE,
        'Keywords in this scope',
        'Share of voice',
        'Brand leaderboard',
        ENGINES_TITLE,
        SOURCES_TITLE,
        'How these KPIs are measured',
      ]);
    });

    it.each([
      ['Share of voice', GROUP_SHARE_OF_VOICE_CAPTION],
      [ENGINES_TITLE, GROUP_ENGINES_CAPTION],
      [SOURCES_TITLE, GROUP_SOURCES_CAPTION],
    ])('charts the %s of the visibility answer', (panel, caption) => {
      renderOverview();

      expect(within(panelTitled(panel)).getByRole('figure')).toHaveTextContent(caption);
    });

    it('charts the KPI history of the trends', () => {
      renderOverview();

      expect(historyPanel().getByRole('figure')).toHaveTextContent(GROUP_TREND_CAPTION);
    });

    it('counts every domain the answers cite under the domains table', () => {
      renderOverview({ visibility: buildVisibility({ sources_total: 40 }) });

      expect(within(panelTitled(SOURCES_TITLE)).getByText('Showing 3 of 40 cited domains')).toBeInTheDocument();
    });

    it('lists one keyword row for a single-keyword scope', () => {
      renderOverview({ visibility: buildVisibility({ keywords: [buildKeywordRow()] }) });

      expect(within(screen.getByRole('table', { name: 'Keywords in this scope' })).getAllByRole('row')).toHaveLength(2);
    });

    it('passes a trends error on to the history panel', () => {
      renderOverview({
        trends: null,
        trendsError: 'Failed to fetch historical trends',
      });

      expect(historyPanel().getByText('History unavailable: Failed to fetch historical trends')).toBeInTheDocument();
    });

    it('shows scope-specific panels before the definitions', () => {
      renderOverview({ children: <p>Persona comparison</p> });

      expect(screen.getByText('Persona comparison').nextElementSibling).toBe(panelTitled('How these KPIs are measured'));
    });

    it('defines every KPI and the change rule in the definitions block', () => {
      renderOverview();

      expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITION_TERMS);
    });
  });

  describe('export', () => {
    it('exports every keyword row of the visibility request', async () => {
      renderOverview({ request: REQUEST });

      await chooseExportFormat('xlsx');

      expect(mockStartExport).toHaveBeenCalledWith({
        view: 'keyword-visibility',
        params: {
          group_id: 'hotel-sol',
          market_id: 'es',
          query_prompt_id: 'familia',
        },
        format: 'xlsx',
      });
    });

    it.each([
      ['brand-leaderboard', 'Brand leaderboard'],
      ['engines', ENGINES_TITLE],
      ['sources', SOURCES_TITLE],
    ])('exports the %s of the visibility request from its panel', async (view, panel) => {
      renderOverview({ request: REQUEST });

      fireEvent.click(within(panelTitled(panel)).getByRole('button', { name: 'Export all' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));

      await waitFor(() => expect(mockStartExport).toHaveBeenCalledWith({
        view,
        params: {
          group_id: 'hotel-sol',
          market_id: 'es',
          query_prompt_id: 'familia',
        },
        format: 'csv',
      }));
    });

    it('exports the KPI history of the trends request', async () => {
      renderOverview({
        request: REQUEST,
        trendsRequest: {
          path: '/trends',
          params: new URLSearchParams({
            group_id: 'hotel-sol',
            period: 'day',
            days: '30',
          }),
        },
      });

      fireEvent.click(historyPanel().getByRole('button', { name: 'Export all' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));

      await waitFor(() => expect(mockStartExport).toHaveBeenCalledWith({
        view: 'trend-periods',
        params: {
          days: '30',
          group_id: 'hotel-sol',
          period: 'day',
        },
        format: 'xlsx',
      }));
    });

    it('cannot export before the view has its request', () => {
      renderOverview();

      expect(screen.getAllByRole('button', { name: 'Export all' })[0]).toBeDisabled();
    });
  });
});
