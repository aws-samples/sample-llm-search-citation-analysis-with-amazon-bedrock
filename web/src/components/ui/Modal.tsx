import {
  useEffect, useId, useRef, type RefObject
} from 'react';
import { CloseIcon } from './Icons';
import { StrokeIcon } from './StrokeIcon';
import {
  CHECK_PATHS, CLOSE_PATHS, INFO_CIRCLE_PATHS 
} from './iconPaths';
import { useDialogFocus } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  size?: 'md' | 'xl' | '4xl' | '5xl' | '6xl';
  /**
   * `padded` (default) wraps the children in a padded, scrolling body. `flush` renders them
   * edge to edge in a column the dialog does not scroll, for dialogs that draw their own
   * header, scrolling panel and footer.
   */
  layout?: 'padded' | 'flush';
  /** Id of an element inside the children that names the dialog, when there is no `title`. */
  labelledBy?: string;
  /**
   * Control to focus when the dialog opens. Without it the first control inside gets
   * focus. Tab stays inside the dialog while it is on top, and focus returns to the
   * opener when it closes.
   */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Open dialogs holding the page scroll lock. Dialogs can stack (a confirmation
 * over a details dialog), so the page scrolls again only when the last one closes.
 */
const scrollLock = { holders: 0 };

/** Primary dialog button: dark on light, and white on the dark modal surface. */
const PRIMARY_BUTTON_COLORS = 'bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100';
const DANGER_BUTTON_COLORS = 'bg-red-600 hover:bg-red-700 text-white';
const BUTTON_FOCUS = 'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-800';

/** How the dialog box scrolls for each layout: the whole box, or a panel the children own. */
const LAYOUT_CLASSES = {
  padded: 'overflow-y-auto',
  flush: 'overflow-hidden flex flex-col',
};

function lockPageScroll(): () => void {
  scrollLock.holders += 1;
  document.body.style.overflow = 'hidden';
  return () => {
    scrollLock.holders -= 1;
    if (scrollLock.holders === 0) document.body.style.overflow = 'unset';
  };
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  size = 'md',
  layout = 'padded',
  labelledBy,
  initialFocus,
}: ModalProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocus(dialogRef, isOpen, initialFocus);
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    const unlockPageScroll = lockPageScroll();

    return () => {
      document.removeEventListener('keydown', handleEscape);
      unlockPageScroll();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    md: 'max-w-md',
    xl: 'max-w-xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
  };

  return (
    // `m-0!`: a caller's `space-y-*` wrapper would otherwise push this fixed overlay down.
    <div className="fixed inset-0 z-50 m-0! flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <dialog
        ref={dialogRef}
        open
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={title ? titleId : labelledBy}
        className={`relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 dark:[color-scheme:dark] ${sizeClasses[size]} w-full max-h-[90vh] ${LAYOUT_CLASSES[layout]} focus:outline-hidden animate-fadeIn`}
      >
        {title && (
          <div className={`px-6 py-4 border-b border-gray-200 dark:border-gray-700 ${showCloseButton ? 'pr-14' : ''}`}>
            <h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white break-words">{title}</h3>
          </div>
        )}

        {layout === 'flush' ? children : <div className="px-6 py-4 text-gray-900 dark:text-gray-100">{children}</div>}

        {showCloseButton && (
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
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
  confirmVariant?: 'danger' | 'primary';
}

export const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'OK',
  confirmVariant = 'primary',
}: ConfirmModalProps) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <MessageDialog title={title} message={message} isOpen={isOpen} onClose={onClose}>
      <div className="flex gap-3 justify-center">
        <button
          onClick={onClose}
          className={`px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${BUTTON_FOCUS}`}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${BUTTON_FOCUS} ${confirmVariant === 'danger' ? DANGER_BUTTON_COLORS : PRIMARY_BUTTON_COLORS}`}
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
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
    info: 'text-gray-600 dark:text-gray-300',
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
        className={`px-6 py-2 text-sm font-medium rounded-lg transition-colors ${BUTTON_FOCUS} ${PRIMARY_BUTTON_COLORS}`}
      >
        OK
      </button>
    </MessageDialog>
  );
};
