import type { ReactNode } from 'react';

interface StrokeIconProps {
  /** Tailwind size (and colour) classes; the icon inherits `currentColor`. */
  readonly className?: string;
  /** One `d` attribute per `<path>`, drawn in order. */
  readonly paths: readonly string[];
  readonly strokeWidth?: 1.5 | 2;
  readonly 'aria-hidden'?: boolean | 'true';
  readonly role?: string;
  /** Rendered before the paths (an accessible `<title>`). */
  readonly children?: ReactNode;
}

/**
 * The 24×24 outline SVG every icon in the app is drawn with: `currentColor`
 * stroke, round caps and joins. It adds no `aria-hidden`/`role` of its own,
 * so callers that pair it with visible text render exactly what they pass.
 */
export const StrokeIcon = ({
  className, paths, strokeWidth = 1.5, children, ...aria
}: StrokeIconProps) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...aria}>
    {children}
    {paths.map((d) => (
      <path key={d} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    ))}
  </svg>
);
