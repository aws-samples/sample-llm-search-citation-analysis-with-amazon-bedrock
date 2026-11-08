/**
 * "Export" above a table paged from DataForSEO: opens `PaidExportModal`, where the user picks the rows and sees the
 * price before the server export is queued. Disabled while there is no page on screen (`modal` null) or `disabled`.
 */
import { useState } from 'react';
import { Button } from './Button';
import {
  PaidExportModal, type PaidExportProps
} from './PaidExportModal';

interface Props {
  readonly modal: PaidExportProps | null;
  readonly disabled?: boolean;
}

export const PAID_EXPORT_LABEL = 'Export';
const PAID_EXPORT_HINT = 'Choose how many rows to export from DataForSEO';

export function PaidExportButton({
  modal, disabled = false
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" title={PAID_EXPORT_HINT} disabled={disabled || modal === null}
        onClick={() => setOpen(true)}>
        {PAID_EXPORT_LABEL}
      </Button>
      {modal !== null && <PaidExportModal {...modal} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
