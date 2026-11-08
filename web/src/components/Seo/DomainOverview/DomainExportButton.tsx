import type { ViewParams } from '../../../api/exports';
import { ExportAllButton } from '../../ui/ExportAllButton';

interface Props {
  /** The `seo-domain-tables` sheet the export holds. */
  readonly table: 'SERP competitors' | 'Traffic snapshots';
  /** What the table on screen was read with; `null` while there is nothing to export. */
  readonly params: ViewParams | null;
}

/**
 * The right-aligned export above a Domain Overview table: a server export (Exports center) of the answer on
 * screen, read from the SEO API's cache or stored snapshots, never a new paid call.
 */
export function DomainExportButton({
  table, params
}: Props) {
  return (
    <div className="flex justify-end">
      <ExportAllButton view="seo-domain-tables" params={params === null ? null : {
        ...params,
        table,
      }} />
    </div>
  );
}
