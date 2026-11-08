import type { SeoScopeParams } from '../../../../hooks/useSeoGeoRequest';
import { ExportAllButton } from '../../../ui/ExportAllButton';

/** The tables of the `seo-geo` export (its `table` parameter: the sheet the server writes). */
type SeoGeoExportTable = 'Keywords' | 'Traffic share';

interface SeoGeoExportToolbarProps {
  /** The report's market and group; without one (a custom report block) the table offers no export. */
  readonly scope: SeoScopeParams | undefined;
  readonly table: SeoGeoExportTable;
}

/**
 * A right-aligned "Export all" above a report table, left out of the printed report: the export
 * service writes every row of the table for the report's market and group (stored data, no
 * DataForSEO call).
 */
export function SeoGeoExportToolbar({
  scope, table
}: SeoGeoExportToolbarProps) {
  if (scope === undefined) return null;
  return (
    <div className="mb-3 flex justify-end print-hidden">
      <ExportAllButton view="seo-geo" params={{
        ...scope,
        table,
      }} />
    </div>
  );
}
