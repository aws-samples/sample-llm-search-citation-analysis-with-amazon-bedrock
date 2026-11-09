import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { ExportToast } from '../../hooks/useExports';
import { CloseIcon } from '../ui';

/** How long a toast stays before it dismisses itself. */
export const TOAST_DISMISS_MS = 8_000;

const TONE_CLASSES: Record<ExportToast['tone'], string> = {
  info: 'border-gray-200 bg-white text-gray-900',
  success: 'border-gray-200 bg-white text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

interface ToastProps {
  readonly toast: ExportToast;
  readonly onDismiss: (toastId: string) => void;
}

function Toast({
  toast, onDismiss
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <li className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm ${TONE_CLASSES[toast.tone]}`}>
      <div className="flex-1">
        <p>{toast.message}</p>
        <Link to="/exports" className="font-medium underline" onClick={() => onDismiss(toast.id)}>Open Exports</Link>
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100">
        <CloseIcon className="w-4 h-4" />
      </button>
    </li>
  );
}

interface ExportToastsProps {
  readonly toasts: readonly ExportToast[];
  readonly onDismiss: (toastId: string) => void;
}

/** The export toasts, bottom right, announced politely to screen readers. Screen only. */
export function ExportToasts({
  toasts, onDismiss
}: ExportToastsProps) {
  if (toasts.length === 0) return null;
  return (
    <ul aria-live="polite" className="print-hidden fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </ul>
  );
}
