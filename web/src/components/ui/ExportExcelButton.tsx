/**
 * "Export to Excel" beside a table: runs `onExport`, reads "Exporting…" meanwhile, and logs a failure under
 * `failureLabel`. Disabled while there is nothing to export.
 */
import { Button } from './Button';
import { useExportAction } from './useExportAction';

export const EXPORT_EXCEL_LABEL = 'Export to Excel';

interface Props {
  readonly onExport: () => Promise<void>;
  /** The console prefix of a failed export, e.g. `[seo] Backlinks export failed:`. */
  readonly failureLabel: string;
  readonly disabled?: boolean;
  /** Hover text, e.g. what the file holds ("The 50 rows of this page"). */
  readonly title?: string;
}

export function ExportExcelButton({
  onExport, failureLabel, disabled = false, title
}: Props) {
  const {
    exporting, handleExport
  } = useExportAction(onExport, failureLabel);
  return (
    <Button type="button" variant="secondary" size="sm" title={title} disabled={disabled || exporting}
      onClick={() => void handleExport()}>
      {exporting ? 'Exporting…' : EXPORT_EXCEL_LABEL}
    </Button>
  );
}
