import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { HistoricalTrendsResponse } from '../../../types';
import { TrendHeadlineSection } from './TrendHeadlineSection';
import { KEYWORD_TRENDS_HEADING } from './KeywordTrendCounts';
import { OWNED_DOMAINS_MISSING } from './KpiHeadline';
import { NO_PREVIOUS_PERIOD } from './periodComparison';
import { buildTrendView } from './reportPayload-fixtures';
import {
  cardFigure, cardFootnote, plainStatCard, statFigure, statFootnote
} from './reportQueries-fixtures';
import { TREND_DEFINITION } from '../../../constants/kpiDefinitions';
import { buildKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';

function renderHeadline(overrides: Partial<HistoricalTrendsResponse> = {}): void {
  const view = buildTrendView(overrides);
  render(<TrendHeadlineSection kpis={view.latest} standing={view} counts={view.overall} />);
}

describe('TrendHeadlineSection KPIs', () => {
  it('says the KPIs pool each keyword\'s latest period and how many answers and keywords they cover', () => {
    renderHeadline();

    expect(screen.getByText('Each keyword\'s latest day in the last 30 days — 20 AI answers across 3 of 4 keywords.'))
      .toBeInTheDocument();
  });

  it('shows the pooled KPIs it is given', () => {
    renderHeadline({ latest: buildKpis({ mention_rate: 71.25 }) });

    expect(statFigure('Mention rate').textContent).toBe('71.3%');
  });

  it('writes each change against the previous period over the keywords measured in both', () => {
    renderHeadline({ period_type: 'week' });

    expect(statFootnote('Mention rate')).toBe('-10.0 pts vs previous week (3 keywords)');
  });

  it('says there is no earlier period before a second one', () => {
    renderHeadline({ change: null });

    expect(statFootnote('Share of voice')).toBe(NO_PREVIOUS_PERIOD);
  });

  it('asks for owned domains under the citation rate when none are set', () => {
    renderHeadline({ citations_configured: false });

    expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
  });
});

describe('TrendHeadlineSection keywords by trend', () => {
  const counts = {
    improving_count: 4,
    declining_count: 2,
    stable_count: 1,
  };

  it.each([
    ['Improving', '4', 'text-emerald-700'],
    ['Declining', '2', 'text-red-700'],
    ['Stable', '1', 'text-gray-900'],
  ])('counts the %s keywords as %s in their colour', (label, value, colour) => {
    renderHeadline({ overall: counts });

    const figure = cardFigure(plainStatCard(label));
    expect([figure.textContent, figure.classList.contains(colour)]).toStrictEqual([value, true]);
  });

  it('says the counts cover the keywords with data', () => {
    renderHeadline({ overall: counts });

    expect(cardFootnote(plainStatCard('Stable'))).toBe('of 3 keywords with data');
  });

  it('heads the counts with what they count and explains the trend rule in a tooltip', () => {
    renderHeadline();

    expect(screen.getByRole('heading', { name: new RegExp(KEYWORD_TRENDS_HEADING) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `About ${TREND_DEFINITION.label}` })).toHaveAccessibleDescription(TREND_DEFINITION.definition);
  });
});
