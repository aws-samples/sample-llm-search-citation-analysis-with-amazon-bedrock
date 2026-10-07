import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useReportInsights } from '../../hooks/useReportInsights';
import { buildReportInsightsHookResult } from '../../hooks/useReportInsights-fixtures';
import type { ReportScope } from '../../types';
import {
  buildReportInsights, emptyReportInsights
} from '../../types/domain/insights-fixtures';
import {
  ALL_SCOPE, groupScope
} from '../ui/reportScope-fixtures';
import {
  InsightsSummary, NO_INSIGHTS
} from './InsightsSummary';
import {
  insightItemTexts, insightsPanel
} from './InsightsSummary-fixtures';
import { aboutButton } from './visibilityTables-fixtures';

vi.mock('../../hooks/useReportInsights', () => ({ useReportInsights: vi.fn() }));

type HookResult = ReturnType<typeof buildReportInsightsHookResult>;

function renderSummary(hook: HookResult = buildReportInsightsHookResult(buildReportInsights()), scope: ReportScope = groupScope('hotel-sol'), days = 30) {
  vi.mocked(useReportInsights).mockReturnValue(hook);
  return render(
    <MemoryRouter>
      <InsightsSummary scope={scope} days={days} />
    </MemoryRouter>,
  );
}

describe('InsightsSummary', () => {
  it('requests the insights of the selected scope over the history range', () => {
    renderSummary(buildReportInsightsHookResult(null), ALL_SCOPE, 90);

    expect(useReportInsights).toHaveBeenCalledWith({ kind: 'all' }, 90);
  });

  it('reads out the top three insights in the API order, each with its severity', () => {
    renderSummary();

    expect(insightItemTexts()).toStrictEqual([
      'highOpenAI: ranked first in 40.0% of answers, links to a tracked domain in 80.0%. Play: get ranked first.',
      'highAurora Miles: named in 9 answers at average position 4.78 (2.70 places behind your best brand), net sentiment +55.6 (36.3 points behind your best brand).',
      'mediumGoogle Gemini: ranked first in 60.0% of answers, links to a tracked domain in 20.0%. Play: get cited.',
    ]);
  });

  it('links to the custom report builder, where the insight blocks show the detail', () => {
    renderSummary();

    expect(insightsPanel().getByRole('link', { name: 'Open in reports' })).toHaveAttribute('href', '/reports/custom/new');
  });

  it('explains what the panel picks in its tooltip', () => {
    renderSummary();

    expect(aboutButton('Insights')).toHaveAccessibleDescription(/The three most pressing findings about this scope/u);
  });

  it('says there is no insight yet when the scope yields none', () => {
    renderSummary(buildReportInsightsHookResult(emptyReportInsights()));

    expect(insightsPanel().getByText(NO_INSIGHTS)).toBeInTheDocument();
    expect(insightItemTexts()).toStrictEqual([]);
  });

  it('says it is loading while the request is in flight', () => {
    renderSummary(buildReportInsightsHookResult(null, { loading: true }));

    expect(insightsPanel().getByText('Loading insights…')).toBeInTheDocument();
  });

  it('says the insights are unavailable, and why, when the request failed', () => {
    renderSummary(buildReportInsightsHookResult(null, { error: 'Failed to load visibility metrics' }));

    expect(insightsPanel().getByText('Insights unavailable: Failed to load visibility metrics')).toBeInTheDocument();
    expect(screen.queryByText(NO_INSIGHTS)).not.toBeInTheDocument();
  });
});
