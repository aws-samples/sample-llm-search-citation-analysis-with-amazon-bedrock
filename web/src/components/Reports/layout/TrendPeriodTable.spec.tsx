import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { TrendDataPoint } from '../../../types';
import {
  MAX_TREND_ROWS, TREND_PERIOD_KPIS, TrendPeriodTable
} from './TrendPeriodTable';
import { ReportSection } from './ReportSection';
import {
  buildTrendPoint, buildTrendPoints
} from './reportPayload-fixtures';
import {
  headerTooltips, sectionTable
} from './reportQueries-fixtures';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { unknownKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';

function renderTable(points: readonly TrendDataPoint[]): void {
  render(
    <ReportSection title="History">
      <TrendPeriodTable points={points} />
    </ReportSection>,
  );
}

describe('TrendPeriodTable', () => {
  it('heads the table with the period, its runs and each period KPI', () => {
    renderTable([buildTrendPoint('2026-09-08')]);

    expect(sectionTable('History')[0]).toStrictEqual([
      'Period', 'Runs', 'Answers', 'Mention rate', 'Share of voice', 'Visibility score', 'Average position', 'Citation rate',
    ]);
  });

  it('writes each period with its runs and KPIs formatted by unit', () => {
    renderTable([buildTrendPoint('2026-09-08')]);

    expect(sectionTable('History')[1]).toStrictEqual(['2026-09-08', '2', '20', '60.0%', '25.0%', '52.4', '1.80', '30.0%']);
  });

  it('shows an unknown KPI of a period as a dash', () => {
    renderTable([buildTrendPoint('2026-09-08', { kpis: unknownKpis() })]);

    expect(sectionTable('History')[1].slice(2)).toStrictEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('explains the runs and every KPI column in a header tooltip', () => {
    renderTable([buildTrendPoint('2026-09-08')]);

    expect(headerTooltips('History').map(([header]) => header)).toStrictEqual([
      'Runs', ...TREND_PERIOD_KPIS.map((id) => KPI_DEFINITIONS[id].label),
    ]);
  });

  it('gives each KPI column the KPI definition as its tooltip', () => {
    renderTable([buildTrendPoint('2026-09-08')]);

    expect(headerTooltips('History').slice(1).map(([, text]) => text))
      .toStrictEqual(TREND_PERIOD_KPIS.map((id) => KPI_DEFINITIONS[id].definition));
  });

  it('lists every period of a short series', () => {
    renderTable(buildTrendPoints(5));

    expect(sectionTable('History').slice(1).map(([period]) => period)).toStrictEqual(['d-00', 'd-01', 'd-02', 'd-03', 'd-04']);
  });

  it('samples a long series down to the printable number of rows', () => {
    renderTable(buildTrendPoints(30));

    expect(screen.getAllByRole('row')).toHaveLength(MAX_TREND_ROWS + 1);
  });

  it('keeps the first and last period when sampling', () => {
    renderTable(buildTrendPoints(30));

    const periods = sectionTable('History').slice(1).map(([period]) => period);
    expect([periods[0], periods[periods.length - 1]]).toStrictEqual(['d-00', 'd-29']);
  });
});
