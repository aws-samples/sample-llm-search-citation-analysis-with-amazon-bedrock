import type { ReactNode } from 'react';

interface Props {
  /**
   * Section heading rendered above the body content. Optional so callers can
   * supply their own heading layout when the default isn't appropriate
   * (e.g. when the heading needs a badge or action button alongside it).
   */
  readonly title?: string;
  /**
   * Short paragraph explaining what the section shows. Helps readers of a
   * printed report who don't have hover tooltips or click affordances.
   */
  readonly subtitle?: string;
  /**
   * When true, the section starts on a fresh page in the printed output.
   * Use sparingly — too many forced page breaks fragment the report.
   */
  readonly startNewPage?: boolean;
  readonly children: ReactNode;
}

/**
 * Standard wrapper for a report section.
 *
 * Two print concerns are baked in:
 * - `avoid-break-inside` keeps a section's heading attached to its body when
 *   the browser paginates the printout (no orphaned headings).
 * - Optional `page-break-before` lets a caller force a section onto a fresh
 *   page when its data is dense enough to justify a break.
 *
 * Both classes are defined in `web/src/index.css` under the `@media print`
 * block so they only have an effect on paper/PDF output; on screen the
 * section renders as a normal block with no break behavior.
 */
export function ReportSection({
  title,
  subtitle,
  startNewPage = false,
  children,
}: Props) {
  const breakClass = startNewPage ? 'page-break-before' : '';
  const wrapperClass = [
    'avoid-break-inside',
    'mb-8',
    breakClass,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={wrapperClass}>
      {title && (
        <header className="mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {subtitle}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
