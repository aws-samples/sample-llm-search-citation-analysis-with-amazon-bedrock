import { providerName } from '../../../constants/providers';
import type { ReportTableColumn } from '../layout';

/** The column naming each row's AI engine by its display name: the first column of every per-engine insights table. */
export function engineColumn<Row extends { readonly engine: string }>(): ReportTableColumn<Row> {
  return {
    header: 'AI engine',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-medium whitespace-nowrap',
    render: (row) => providerName(row.engine),
  };
}
