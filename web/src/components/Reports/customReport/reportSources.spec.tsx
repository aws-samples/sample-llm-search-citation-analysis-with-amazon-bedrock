import type { ReactNode } from 'react';
import {
  describe, expect, it, vi
} from 'vitest';
import { render } from '@testing-library/react';
import { useBrandConfig } from '../../../hooks/useBrandConfig';
import { useCompetitorGap } from '../CompetitorGapReport/useCompetitorGap';
import { useExecutiveSummary } from '../ExecutiveSummaryReport/useExecutiveSummary';
import { useScopeReportData } from '../scopeReport/useScopeReportData';
import {
  buildScopeReport, loadingScopeReport
} from '../scopeReport/scopeReport-fixtures';
import {
  buildCompetitorSource, buildReportSources
} from './customReportPages-fixtures';
import {
  pickCompetitor, ReportSourcesMissingError, ReportSourcesProvider, sourcesReady, type SourceId
} from './reportSources';
import {
  BrandConfigProbe, buildInsightsSource, loadingInsightsSource, mockBrandConfigWith, ReportSourcesProbe
} from './reportSources-fixtures';
import { useReportInsights } from '../../../hooks/useReportInsights';
import { buildReportInsightsHookResult } from '../../../hooks/useReportInsights-fixtures';

vi.mock('../scopeReport/useScopeReportData', () => ({ useScopeReportData: vi.fn() }));
vi.mock('../ExecutiveSummaryReport/useExecutiveSummary', () => ({ useExecutiveSummary: vi.fn() }));
vi.mock('../../../hooks/useReportInsights', () => ({ useReportInsights: vi.fn() }));
vi.mock('../CompetitorGapReport/useCompetitorGap', () => ({ useCompetitorGap: vi.fn() }));
vi.mock('../../../hooks/useBrandConfig', () => ({ useBrandConfig: vi.fn() }));

const INPUTS = {
  scope: { kind: 'all' },
  days: 90,
  competitor: 'Hotel Luna',
} as const;

/** A provider of the source `source` over `INPUTS`, around `probe`. */
function renderProvider(source: SourceId, probe: ReactNode) {
  return render(
    <ReportSourcesProvider sources={new Set([source])} inputs={INPUTS}>
      {probe}
    </ReportSourcesProvider>,
  );
}

describe('ReportSourcesProvider', () => {
  it('provides only the sources it was asked for', () => {
    vi.mocked(useScopeReportData).mockReturnValue(buildScopeReport());
    const { container } = renderProvider('scope', <ReportSourcesProbe />);

    expect(container).toHaveTextContent('scope');
    expect(useExecutiveSummary).not.toHaveBeenCalled();
  });

  it('feeds the scope source the reader\u2019s scope and period', () => {
    vi.mocked(useScopeReportData).mockReturnValue(buildScopeReport());
    renderProvider('scope', <ReportSourcesProbe />);

    expect(useScopeReportData).toHaveBeenCalledWith({ kind: 'all' }, 90);
  });

  it('shows the competitor asked for in the URL when it is configured', () => {
    vi.mocked(useBrandConfig).mockReturnValue(mockBrandConfigWith(['Hotel Sol', 'Hotel Luna']));
    vi.mocked(useCompetitorGap).mockReturnValue(buildCompetitorSource().gap);
    const { container } = renderProvider('competitor', <BrandConfigProbe />);

    expect(container).toHaveTextContent('Hotel Luna');
    expect(useCompetitorGap).toHaveBeenCalledWith('Hotel Luna');
  });

  it('feeds the insights source the reader\u2019s scope and period', () => {
    vi.mocked(useReportInsights).mockReturnValue(buildReportInsightsHookResult(null));
    const { container } = renderProvider('insights', <ReportSourcesProbe />);

    expect(container).toHaveTextContent('insights');
    expect(useReportInsights).toHaveBeenCalledWith({ kind: 'all' }, 90);
  });

  it('refuses to be read outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());

    expect(() => render(<ReportSourcesProbe />)).toThrow(ReportSourcesMissingError);
    expect(() => render(<ReportSourcesProbe />)).toThrow('useReportSources must be called inside ReportSourcesProvider');
  });
});

describe('sourcesReady', () => {
  it('is ready when the report needs no source', () => {
    expect(sourcesReady(buildReportSources())).toBe(true);
  });

  it('waits while a mounted source is loading', () => {
    expect(sourcesReady(buildReportSources({ scope: loadingScopeReport() }))).toBe(false);
  });

  it('is ready once every mounted source settled', () => {
    expect(sourcesReady(buildReportSources({
      scope: buildScopeReport(),
      competitor: buildCompetitorSource(),
      insights: buildInsightsSource(),
    }))).toBe(true);
  });

  it('waits while the insights source is loading', () => {
    expect(sourcesReady(buildReportSources({ insights: loadingInsightsSource() }))).toBe(false);
  });
});

describe('pickCompetitor', () => {
  it('keeps the competitor asked for when it is configured', () => {
    expect(pickCompetitor(['Hotel Sol', 'Hotel Luna'], 'Hotel Luna')).toBe('Hotel Luna');
  });

  it('falls back to the first competitor for one no longer configured', () => {
    expect(pickCompetitor(['Hotel Sol', 'Hotel Luna'], 'Hotel Mar')).toBe('Hotel Sol');
  });

  it('picks none when no competitor is configured', () => {
    expect(pickCompetitor([], 'Hotel Luna')).toBeNull();
  });
});
