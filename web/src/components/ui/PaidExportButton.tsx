/**
 * "Export to Excel" above a table paged from DataForSEO: opens `PaidExportModal`, where the user picks the rows
 * and sees the price before any request. Disabled while there is no page on screen (`modal` null) or `disabled`.
 */
import { useState } from 'react';
import { Button } from './Button';
import { EXPORT_EXCEL_LABEL } from './ExportExcelButton';
import {
  PaidExportModal, type PaidExportProps
} from './PaidExportModal';

interface Props<TRow> {
  readonly modal: PaidExportProps<TRow> | null;
  readonly disabled?: boolean;
}

const PAID_EXPORT_HINT = 'Choose how many rows to export from DataForSEO';

export function PaidExportButton<TRow>({
  modal, disabled = false
}: Props<TRow>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" title={PAID_EXPORT_HINT} disabled={disabled || modal === null}
        onClick={() => setOpen(true)}>
        {EXPORT_EXCEL_LABEL}
      </Button>
      {modal !== null && <PaidExportModal {...modal} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
