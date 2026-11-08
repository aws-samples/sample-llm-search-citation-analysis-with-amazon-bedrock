import { ConfirmModal } from '../ui/Modal';

/** A paid action (saving or running a snapshot schedule) waiting for the Admin's yes. */
export interface PaidConfirmation {
  title: string;
  message: string;
  confirmText: string;
  action: () => Promise<void>;
}

/** The confirmation of `pending`; closed while nothing paid is waiting. */
export const PaidScheduleConfirm = ({
  pending, onClose
}: {
  readonly pending: PaidConfirmation | null;
  readonly onClose: () => void;
}) => (
  <ConfirmModal
    isOpen={pending !== null}
    onClose={onClose}
    onConfirm={() => void pending?.action()}
    title={pending?.title ?? ''}
    message={pending?.message ?? ''}
    confirmText={pending?.confirmText ?? 'Continue'}
  />
);
