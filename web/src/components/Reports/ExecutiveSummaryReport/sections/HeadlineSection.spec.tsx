import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ReportsOverviewResponse } from '../../../../api/reports';
import { HeadlineSection } from './HeadlineSection';
import { NO_PREVIOUS_PERIOD } from '../../layout/periodComparison';
import { OWNED_DOMAINS_MISSING } from '../../layout/KpiHeadline';
import {
  buildOverview, buildPeriodChange
} from '../../layout/reportPayload-fixtures';
import {
  cardFigure, cardFootnote, plainStatCard, statFigure, statFootnote
} from '../../layout/reportQueries-fixtures';
import { buildKpis } from '../../BrandVisibilityReport/groupKpiHistory-fixtures';
import { loadedOverview } from './reportsOverview-fixtures';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

function renderHeadline(overrides: Partial<ReportsOverviewResponse> = {}): void {
  render(<HeadlineSection {...loadedOverview(overrides)} />);
}

describe('HeadlineSection — KPIs', () => {
  it('shows the overview KPIs on the headline cards', () => {
    renderHeadline({ kpis: buildKpis({ visibility_score: 65.44 }) });

    expect(statFigure('Visibility score').textContent).toBe('65.4');
  });

  it('writes each change against the previous period over the keywords compared', () => {
    renderHeadline({ change: buildPeriodChange({ keywords_compared: 7 }) });

    expect(statFootnote('Visibility score')).toBe('-8.2 pts vs previous day (7 keywords)');
  });

  it('says there is no earlier period before a second one', () => {
    renderHeadline({ change: null });

    expect(statFootnote('Visibility score')).toBe(NO_PREVIOUS_PERIOD);
  });

  it.each([
    [false, OWNED_DOMAINS_MISSING],
    [true, '+1.2 pts vs previous day (3 keywords)'],
  ])('writes under the citation rate, with owned domains configured %s, "%s"', (configured, footnote) => {
    renderHeadline({ citations_configured: configured });

    expect(statFootnote('Citation rate')).toBe(footnote);
  });

  it('says how many answers and keywords the KPIs cover', () => {
    renderHeadline({
      keywords_analyzed: 10,
      keywords_with_data: 8,
    });

    expect(screen.getByText('Each keyword\'s latest day in the last 30 days — 20 AI answers across 8 of 10 keywords.')).toBeInTheDocument();
  });
});

describe('HeadlineSection — keyword breadth', () => {
  it('counts the improving, declining and stable keywords from the summary', () => {
    renderHeadline({
      summary: {
        improving_count: 3,
        declining_count: 2,
        stable_count: 5,
      },
    });

    expect(['Improving', 'Declining', 'Stable'].map((label) => cardFigure(plainStatCard(label)).textContent)).toStrictEqual(['3', '2', '5']);
  });

  it('says the counts cover the keywords with data', () => {
    renderHeadline({ keywords_with_data: 10 });

    expect(cardFootnote(plainStatCard('Improving'))).toBe('of 10 keywords with data');
  });
});

describe('HeadlineSection — placeholder states', () => {
  it.each(sectionPlaceholderCases('Loading executive summary…'))('renders the $name', ({
    state, text
  }) => {
    render(<HeadlineSection data={null} {...state} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ['there is no overview yet', null],
    ['no keyword has data', buildOverview({ keywords_with_data: 0 })],
  ])('asks for an analysis when %s', (_label, data) => {
    render(<HeadlineSection data={data} loading={false} error={null} />);
    expect(screen.getByText('No analysis data yet. Run an analysis to populate the executive summary.')).toBeInTheDocument();
  });
});
