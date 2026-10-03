interface RefreshTextButtonProps {
  readonly onRefresh: () => Promise<unknown>;
  readonly disabled: boolean;
  /** Layout classes, each followed by a space (e.g. `"self-start "`). */
  readonly layoutClassName?: string;
}

/** Grey "Refresh" button of a panel header. */
export const RefreshTextButton = ({
  onRefresh, disabled, layoutClassName = ''
}: RefreshTextButtonProps) => (
  <button
    type="button"
    onClick={() => { void onRefresh(); }}
    disabled={disabled}
    className={`${layoutClassName}rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50`}
  >
    Refresh
  </button>
);
