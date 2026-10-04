import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { KPI_SPECS } from '../../../constants/kpiDefinitions';
import { EngineKpiTable } from './EngineKpiTable';
import { buildVisibility } from './reportPayload-fixtures';
import {
  headerTooltips, sectionTable
} from './reportQueries-fixtures';
import { ReportSection } from './ReportSection';

const TITLE = 'KPIs per AI engine';

function renderTable(): void {
  render(
    <ReportSection title={TITLE}>
      <EngineKpiTable engines={buildVisibility().engines} />
    </ReportSection>,
  );
}

describe('EngineKpiTable', () => {
  it('heads a column for every KPI after the engine', () => {
    renderTable();

    expect(sectionTable(TITLE)[0]).toStrictEqual(['AI engine', ...KPI_SPECS.map((spec) => spec.label)]);
  });

  it('explains every KPI column with its definition', () => {
    renderTable();

    expect(headerTooltips(TITLE)).toStrictEqual(KPI_SPECS.map((spec) => [spec.label, spec.definition]));
  });
});
