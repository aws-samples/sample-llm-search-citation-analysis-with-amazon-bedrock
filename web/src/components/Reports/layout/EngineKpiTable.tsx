import type { EngineKpis } from '../../../types';
import { KPI_SPECS } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { engineName } from '../charts/engineKpiChartConfiguration';
import { kpiColumn } from './kpiColumn';
import {
  ReportTable, type ReportTableColumn
} from './ReportTable';

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function engineColumns(): ReadonlyArray<ReportTableColumn<EngineKpis>> {
  return [
    {
      header: 'AI engine',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-medium whitespace-nowrap',
      render: (engine) => engineName(engine.engine),
    },
    ...KPI_SPECS.map((spec) => kpiColumn<EngineKpis>(spec.id, (engine) => formatKpi(spec.id, engine.kpis[spec.id]))),
  ];
}

/** One row per AI engine with every KPI over that engine's answers alone, in the API order (engine name). */
export function EngineKpiTable({ engines }: { readonly engines: readonly EngineKpis[] }) {
  return (
    <ReportTable
      columns={engineColumns()}
      rows={engines}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(engine) => engine.engine}
    />
  );
}
