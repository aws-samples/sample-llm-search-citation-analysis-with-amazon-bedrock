import {
  exportTableToExcel, type TableExport
} from '../../../../exporters/tableExcel';
import { ExportExcelButton } from '../../../ui/ExportExcelButton';

/** A right-aligned "Export to Excel" above a report table, left out of the printed report. */
export function SeoGeoExcelToolbar<TRow>({ table }: { readonly table: TableExport<TRow> }) {
  return (
    <div className="mb-3 flex justify-end print-hidden">
      <ExportExcelButton
        title="Every row of this table"
        disabled={table.rows.length === 0}
        failureLabel={`[seo] ${table.sheetName} Excel export failed:`}
        onExport={() => exportTableToExcel(table)}
      />
    </div>
  );
}
