import {
  exportTableToExcel, type TableExport
} from '../../../exporters/tableExcel';
import { ExportExcelButton } from '../../ui/ExportExcelButton';

interface Props<TRow> extends TableExport<TRow> {
  /** Hover text: what the file holds. */
  readonly title: string;
}

/** The right-aligned "Export to Excel" row above a Domain Overview table: the rows on screen, never a new paid call. */
export function DomainExportButton<TRow>({
  title, ...table
}: Props<TRow>) {
  return (
    <div className="flex justify-end">
      <ExportExcelButton onExport={() => exportTableToExcel(table)} failureLabel={`[seo] ${table.sheetName} Excel export failed:`}
        disabled={table.rows.length === 0} title={title} />
    </div>
  );
}
