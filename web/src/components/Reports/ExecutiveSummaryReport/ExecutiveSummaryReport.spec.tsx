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
  definitionTerms, sectionTitles, statFigure
} from '../layout/reportQueries-fixtures';
import { buildRec } from './sections/reportsOverview-fixtures';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';

vi.mock('./useExecutiveSummary', () => ({useExecutiveSummary: vi.fn()}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));

import { useExecutiveSummary } from './useExecutiveSummary';

const mockUse = vi.mocked(useExecutiveSummary);

const POPULATED = {
  data: buildOverview({
    top_improving: [buildMover('best running shoes', 8, 80)],
    top_declining: [buildMover('best hiking boots', -10, 30)],
    top_recommendations: [buildRec('Pitch hiking-gear-focused publishers', 'high')],
  }),
  loading: false,
  error: null,
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
  });

  it('renders the report H1', () => {
    renderReport();
    expect(getReportHeading(/Executive Summary/i)).toBeInTheDocument();
  });

  it('shows the headline, wins and gaps, next actions and definitions, in that order', () => {
    renderReport();

    expect(sectionTitles()).toStrictEqual(['Headline', 'Top wins and gaps', 'Next actions', 'How these KPIs are measured']);
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

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => entry.label));
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
});
