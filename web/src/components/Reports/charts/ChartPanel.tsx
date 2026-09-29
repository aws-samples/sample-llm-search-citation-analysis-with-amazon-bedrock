import {
  useId, type ReactNode
} from 'react';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface Props {
  readonly title: string;
  /** What the chart shows, behind an "i" button next to the title (hidden in print). */
  readonly info?: string;
  /** A visible line under the title, for printed reports. */
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A titled card around a chart, so the reports and the Visibility tab lay
 * their charts out the same way; kept on one printed page.
 */
export function ChartPanel({
  title, info, subtitle, children, className
}: Props) {
  const headingId = useId();
  const panelClass = [
    'avoid-break-inside rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800',
    className,
  ].filter(Boolean).join(' ');

  return (
    <section aria-labelledby={headingId} className={panelClass}>
      <div className="flex items-center">
        <h3 id={headingId} className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {info && <InfoTooltip label={title} text={info} />}
      </div>
      {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
