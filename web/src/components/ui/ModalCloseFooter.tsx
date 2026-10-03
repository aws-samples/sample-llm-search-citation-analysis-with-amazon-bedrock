interface ModalCloseFooterProps {
  readonly onClose: () => void;
  /** Horizontal padding of the footer bar, matching the dialog's header. */
  readonly paddingClassName?: string;
}

/** Bottom bar of a full-size detail dialog: a rule and a right-aligned Close button. */
export const ModalCloseFooter = ({
  onClose, paddingClassName = 'px-6'
}: ModalCloseFooterProps) => (
  <div className={`${paddingClassName} py-4 border-t border-gray-200 flex justify-end`}>
    <button
      onClick={onClose}
      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
    >
      Close
    </button>
  </div>
);
