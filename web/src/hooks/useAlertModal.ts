import {
  useCallback, useState
} from 'react';

/**
 * State for `ui/Modal`'s `AlertModal` (bugs.md 4.4 — this exact shape plus a
 * `showAlert` helper was previously copied into five components).
 */
export interface AlertState {
  isOpen: boolean;
  title: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

const CLOSED_ALERT: AlertState = {
  isOpen: false,
  title: '',
  message: '',
  variant: 'info',
};

/**
 * Owns the alert-modal state for a component rendering `<AlertModal>`.
 * `closeAlert` keeps the last title/message/variant so the closing modal
 * does not blank mid-fade, matching every previous copy.
 */
export function useAlertModal() {
  const [alertModal, setAlertModal] = useState<AlertState>(CLOSED_ALERT);

  const showAlert = useCallback(
    (title: string, message: string, variant: AlertState['variant']) => {
      setAlertModal({
        isOpen: true,
        title,
        message,
        variant,
      });
    },
    []
  );

  const closeAlert = useCallback(() => {
    setAlertModal((previous) => ({
      ...previous,
      isOpen: false,
    }));
  }, []);

  return {
    alertModal,
    showAlert,
    closeAlert,
  };
}
