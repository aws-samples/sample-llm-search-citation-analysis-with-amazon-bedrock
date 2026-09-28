import type { ReactNode } from 'react';
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../constants/kpiDefinitions';
import type { ReportTableColumn } from './ReportTable';

/**
 * A table column showing one KPI: headed by the KPI's label (or `header`, for
 * a variant such as "Mention rate change") with its definition in a tooltip.
 */
export function kpiColumn<Row>(
  id: KpiId,
  render: (row: Row) => ReactNode,
  header: string = KPI_DEFINITIONS[id].label,
): ReportTableColumn<Row> {
  return {
    header,
    info: KPI_DEFINITIONS[id].definition,
    render,
  };
}
