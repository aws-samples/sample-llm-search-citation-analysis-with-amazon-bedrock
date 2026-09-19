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
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
    />
  </svg>
);
