import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { VisibilityHeadlineSection } from './VisibilityHeadlineSection';
import type { VisibilityHeadlineProps } from './visibilityHeadline';
import { OWNED_DOMAINS_MISSING } from './KpiHeadline';
import { NO_PREVIOUS_RUN } from './periodComparison';
import {
  buildPeriodChange, buildTrendView, buildVisibility
} from './reportPayload-fixtures';
import {
  statFigure, statFootnote
} from './reportQueries-fixtures';
import {
  buildKpis, RUN_2
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';

const EMPTY = 'Nothing for this keyword yet.';

function renderHeadline(overrides: Partial<VisibilityHeadlineProps> = {}): void {
  render(
    <VisibilityHeadlineSection
      visibility={buildVisibility({ change: buildPeriodChange({ keywords_compared: 1 }) })}
      trends={buildTrendView()}
      loading={false}
      error={null}
      emptyMessage={EMPTY}
      {...overrides}
    />,
  );
}

describe('VisibilityHeadlineSection', () => {
  it('names the latest run and the answers and engines its KPIs come from', () => {
    renderHeadline();

    expect(screen.getByText(`Latest run of ${new Date(RUN_2).toLocaleString()} — 20 AI answers from 4 engines.`)).toBeInTheDocument();
  });

  it('shows the KPIs of the latest run', () => {
    renderHeadline({ visibility: buildVisibility({ kpis: buildKpis({ visibility_score: 77.04 }) }) });

    expect(statFigure('Visibility score').textContent).toBe('77.0');
  });

  it('writes each change against the previous run', () => {
    renderHeadline();

    expect(statFootnote('Visibility score')).toBe('-8.2 pts vs previous run (1 keyword)');
  });

  it.each([
    ['the trend has a change', buildTrendView({ change: buildPeriodChange() })],
    ['the trend request failed', null],
  ])('says there is no earlier run when the keyword was analysed once, even if %s', (_label, trends) => {
    renderHeadline({ visibility: buildVisibility({ change: null }), trends });

    expect(statFootnote('Mention rate')).toBe(NO_PREVIOUS_RUN);
  });

  it('asks for owned domains under the citation rate when none are set', () => {
    renderHeadline({ visibility: buildVisibility({ citations_configured: false }) });

    expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
  });

  it.each([
    ['no visibility answer yet', null],
    ['no answered run of the keyword', buildVisibility({ keywords_with_data: 0 })],
  ])('shows the empty message when there is %s', (_label, visibility) => {
    renderHeadline({ visibility });

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it('shows the loading state while either request loads', () => {
    renderHeadline({
      visibility: null,
      loading: true,
    });

    expect(screen.getByText('Loading visibility…')).toBeInTheDocument();
  });

  it('shows the error of a failed request', () => {
    renderHeadline({
      visibility: null,
      error: 'Network down',
    });

    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});
