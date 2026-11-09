import type { CustomReport } from '../../../api/customReports';
import { ConfirmModal } from '../../ui/Modal';

interface Props {
  readonly report: CustomReport;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/** "Delete this report?": asked before a saved custom report is removed, from its editor or from the Reports page. */
export function DeleteReportModal({
  report, isOpen, onClose, onConfirm
}: Props) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete this report?"
      message={`"${report.title}" will be removed for everyone. This cannot be undone.`}
      confirmText="Delete report"
      confirmVariant="danger"
    />
  );
}
