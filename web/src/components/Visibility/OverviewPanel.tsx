import {
  useId, type ReactNode
} from 'react';
import { InfoTooltip } from '../ui/InfoTooltip';

interface Props {
  /** The heading; also names the region for assistive technology. */
  readonly title: string;
  /** How the panel's figure is measured, in an "i" tooltip next to the heading. */
  readonly info?: string;
  /** Controls shown at the heading's right, e.g. range buttons. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** One card of the Visibility tab: a named region with a heading, optional tooltip and actions. */
export function OverviewPanel({
  title, info, actions, children
}: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center">
          <h3 id={headingId} className="text-lg font-medium">{title}</h3>
          {info !== undefined && <InfoTooltip label={title} text={info} />}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
