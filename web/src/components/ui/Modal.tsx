import { useEffect } from 'react';
import { CloseIcon } from './Icons';
import { StrokeIcon } from './StrokeIcon';
import {
  CHECK_PATHS, CLOSE_PATHS, INFO_CIRCLE_PATHS 
} from './iconPaths';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '4xl';
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  size = 'md',
}: ModalProps) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '4xl': 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <dialog
        open
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${sizeClasses[size]} w-full max-h-[90vh] overflow-y-auto animate-fadeIn`}
      >
        {title && (
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 id="modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          </div>
        )}

        <div className="px-6 py-4 text-gray-900 dark:text-gray-100">{children}</div>

        {showCloseButton && (
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            <CloseIcon />
          </button>
        )}
      </dialog>
    </div>
  );
};

interface MessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  icon?: React.ReactNode;
  /** The dialog's buttons, under the message. */
  children: React.ReactNode;
}

/** Centred title and message (with an optional icon above) in a modal without a close button. */
const MessageDialog = ({
  isOpen, onClose, title, message, icon, children
}: MessageDialogProps) => (
  <Modal isOpen={isOpen} onClose={onClose} showCloseButton={false}>
    <div className="text-center">
      {icon}
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
      {children}
    </div>
  </Modal>
);

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'danger' | 'primary';
}

export const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
}: ConfirmModalProps) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const confirmButtonClass =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-gray-900 hover:bg-gray-800 text-white';

  return (
    <MessageDialog isOpen={isOpen} onClose={onClose} title={title} message={message}>
      <div className="flex gap-3 justify-center">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {cancelText}
        </button>
        <button
          onClick={handleConfirm}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${confirmButtonClass}`}
        >
          {confirmText}
        </button>
      </div>
    </MessageDialog>
  );
};

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
}

export const AlertModal = ({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
}: AlertModalProps) => {
  const iconColors = {
    success: 'text-emerald-600',
    error: 'text-red-600',
    info: 'text-gray-600',
  };

  const iconPaths = {
    success: CHECK_PATHS,
    error: CLOSE_PATHS,
    info: INFO_CIRCLE_PATHS,
  };

  return (
    <MessageDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      message={message}
      icon={(
        <div className={iconColors[variant]}>
          <StrokeIcon className="w-12 h-12 mx-auto mb-4" paths={iconPaths[variant]} />
        </div>
      )}
    >
      <button
        onClick={onClose}
        className="px-6 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
      >
        OK
      </button>
    </MessageDialog>
  );
};
