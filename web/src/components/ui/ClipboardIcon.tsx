import { DUPLICATE_PATHS } from './iconPaths';
import { StrokeIcon } from './StrokeIcon';

interface ClipboardIconProps {
  /** Tailwind size (and colour) classes; the icon inherits `currentColor`. */
  readonly className: string;
}

/**
 * Clipboard outline drawn inline next to a copy button's label. Unlike the
 * `Icons.tsx` library it carries no `aria-hidden`/`role` handling: every
 * caller pairs it with visible or screen-reader-only text.
 */
export const ClipboardIcon = ({ className }: ClipboardIconProps) => (
  <StrokeIcon className={className} paths={DUPLICATE_PATHS} />
);
