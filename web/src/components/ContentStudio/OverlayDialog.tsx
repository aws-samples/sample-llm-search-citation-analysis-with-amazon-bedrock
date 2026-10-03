import type { ReactNode } from 'react';

interface OverlayDialogProps {
  /** Called when the dimmed backdrop is clicked. */
  readonly onDismiss: () => void;
  /** Classes of the white panel (width, padding, overflow). */
  readonly panelClassName: string;
  readonly children: ReactNode;
}

/** Scrollable full-screen overlay with a dimmed backdrop and a centred white panel. */
export const OverlayDialog = ({
  onDismiss, panelClassName, children
}: OverlayDialogProps) => (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/50 transition-opacity" onClick={onDismiss} />

      <div className={`relative bg-white rounded-xl shadow-xl ${panelClassName}`}>
        {children}
      </div>
    </div>
  </div>
);
