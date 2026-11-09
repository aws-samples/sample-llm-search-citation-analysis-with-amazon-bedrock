import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ReportsOverviewResponse } from '../../../../api/reports';
import { HeadlineSection } from './HeadlineSection';
import { itShowsPeriodHeadlineGaps } from '../../layout/kpiHeadline-fixtures';
import {
  buildOverview, buildPeriodChange
} from '../../layout/reportPayload-fixtures';
import {
  cardFigure, cardFootnote, plainStatCard, statFigure, statFootnote
} from '../../layout/reportQueries-fixtures';
import { buildKpis } from '../../BrandVisibilityReport/groupKpiHistory-fixtures';
import { loadedOverview } from './reportsOverview-fixtures';
import { itRendersSectionPlaceholders } from '../../layout/sectionPlaceholders-fixtures';

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

  it('writes the citation rate change once owned domains are configured', () => {
    renderHeadline({ citations_configured: true });

    expect(statFootnote('Citation rate')).toBe('+1.2 pts vs previous day (3 keywords)');
  });

  it('says how many answers and keywords the KPIs cover', () => {
    renderHeadline({
      keywords_analyzed: 10,
      keywords_with_data: 8,
    });

    expect(screen.getByText('Each keyword\'s latest day in the last 30 days — 20 AI answers across 8 of 10 keywords.')).toBeInTheDocument();
  });
});

describe('HeadlineSection — KPIs without a comparison or owned domains', () => {
  itShowsPeriodHeadlineGaps(renderHeadline);
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
  itRendersSectionPlaceholders(HeadlineSection, 'Loading executive summary…');

  it.each([
    ['there is no overview yet', null],
    ['no keyword has data', buildOverview({ keywords_with_data: 0 })],
  ])('asks for an analysis when %s', (_label, data) => {
    render(<HeadlineSection data={data} loading={false} error={null} />);
    expect(screen.getByText('No analysis data yet. Run an analysis to populate the executive summary.')).toBeInTheDocument();
  });
});
