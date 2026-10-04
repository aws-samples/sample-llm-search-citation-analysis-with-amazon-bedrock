import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExecutiveSummaryReport } from './ExecutiveSummaryReport';
import { getReportHeading } from '../../../test/reportHeading';
import {
  buildMover, buildOverview
} from '../layout/reportPayload-fixtures';
import {
  definitionTerms, VISIBILITY_DEFINITION_TERMS, sectionTitled, sectionTitles, statFigure
} from '../layout/reportQueries-fixtures';
import {
  buildRec, loadedOverview
} from './sections/reportsOverview-fixtures';
import {
  LATEST_BRANDS_SOV_CAPTION, chartCaption
} from '../BrandVisibilityReport/sections/reportChartPanels-fixtures';
import { SHARE_OF_VOICE_TITLE } from '../BrandVisibilityReport/sections/ReportChartPanels';

vi.mock('./useExecutiveSummary', () => ({useExecutiveSummary: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { useExecutiveSummary } from './useExecutiveSummary';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import {
  buildKeywordGroup, buildKeywordGroupsHookResult
} from '../../../hooks/useKeywordGroups-fixtures';

const mockUse = vi.mocked(useExecutiveSummary);

const POPULATED = {
  ...loadedOverview({
    top_improving: [buildMover('best running shoes', 8, 80)],
    top_declining: [buildMover('best hiking boots', -10, 30)],
    top_recommendations: [buildRec('Pitch hiking-gear-focused publishers', 'high')],
  }),
  ready: true,
};

function renderReport(path = '/reports/executive-summary') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExecutiveSummaryReport />
    </MemoryRouter>,
  );
}

describe('ExecutiveSummaryReport', () => {
  beforeEach(() => {
    mockUse.mockReturnValue(POPULATED);
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([buildKeywordGroup({
      id: 'hotel-sol',
      name: 'Hotel Sol (list)',
    })]));
  });

  it('renders the report H1', () => {
    renderReport();
    expect(getReportHeading(/Executive Summary/i)).toBeInTheDocument();
  });

  it('shows the headline, trend and share of voice, wins and gaps, next actions and definitions, in that order', () => {
    renderReport();

    expect(sectionTitles()).toStrictEqual([
      'Headline', 'Trend and share of voice', 'Top wins and gaps', 'Next actions', 'How these KPIs are measured',
    ]);
  });

  it('charts the share of voice of the latest leaderboard between the headline and the wins', () => {
    renderReport();

    expect(chartCaption(SHARE_OF_VOICE_TITLE, sectionTitled('Trend and share of voice'))).toBe(LATEST_BRANDS_SOV_CAPTION);
  });

  it('shows the overview KPIs in the headline', () => {
    renderReport();

    expect(statFigure('Visibility score').textContent).toBe('52.4');
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

  it('ends with the definition of every KPI and of the trend rule', () => {
    renderReport();

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITION_TERMS);
  });

  it('names a keyword group as the API describes the scope', () => {
    mockUse.mockReturnValue({
      ...POPULATED,
      data: buildOverview({
        scope: {
          kind: 'group',
          label: 'Hotel Sol',
          keyword_count: 4,
        },
      }),
    });

    renderReport('/reports/executive-summary?group=hotel-sol');

    expect(screen.getByText('The one-page state of brand visibility for "Hotel Sol" across AI search engines.')).toBeInTheDocument();
  });

  it('names a keyword group from the group list before the API answers', () => {
    mockUse.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      ready: false,
    });

    renderReport('/reports/executive-summary?group=hotel-sol');

    expect(screen.getByText('The one-page state of brand visibility for "Hotel Sol (list)" across AI search engines.')).toBeInTheDocument();
  });
});
