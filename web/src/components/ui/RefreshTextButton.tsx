import { StrokeIcon } from './StrokeIcon';
import { REFRESH_PATHS } from './iconPaths';

interface RefreshTextButtonProps {
  readonly onRefresh: () => unknown;
  readonly disabled?: boolean;
  /** A refresh is in flight: the button is disabled and its icon spins. */
  readonly loading?: boolean;
  /** Draws the refresh arrows before the text. */
  readonly showIcon?: boolean;
  /** Layout classes, each followed by a space (e.g. `"self-start "`). */
  readonly layoutClassName?: string;
}

/** Grey "Refresh" button of a panel header. */
export const RefreshTextButton = ({
  onRefresh, disabled = false, loading = false, showIcon = false, layoutClassName = ''
}: RefreshTextButtonProps) => (
  <button
    type="button"
    onClick={() => { onRefresh(); }}
    disabled={disabled || loading}
    aria-busy={loading}
    className={`${layoutClassName}inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50`}
  >
    {showIcon && <StrokeIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} paths={REFRESH_PATHS} />}
    Refresh
  </button>
);
