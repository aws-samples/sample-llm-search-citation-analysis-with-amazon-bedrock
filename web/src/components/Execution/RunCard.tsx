import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Inline link to another page of the dashboard. */
const PAGE_LINK_CLASS = 'font-medium text-blue-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500';

export const PageLink = ({
  to, children
}: {
  readonly to: string;
  readonly children: ReactNode 
}) => (
  <Link to={to} className={PAGE_LINK_CLASS}>{children}</Link>
);

interface RunCardProps {
  /** Id of the card's heading, which names the card's region. */
  readonly titleId: string;
  /** The heading content (a status dot and words, or a plain title). */
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children?: ReactNode;
  /** Bottom bar under a border, like a dialog footer. */
  readonly footer?: ReactNode;
}

/**
 * A Run Analysis card in the Schedule page pattern: an `h2` and a muted line
 * under it, then the body and an optional footer bar, each under a border.
 */
export const RunCard = ({
  titleId, title, description, children, footer
}: RunCardProps) => (
  <section aria-labelledby={titleId} className="bg-white rounded-lg border border-gray-200">
    <div className="p-4 sm:p-6 border-b border-gray-200">
      <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="text-sm text-gray-500 mt-0.5">{description}</div>
    </div>
    {children !== undefined && <div className="p-4 sm:p-6">{children}</div>}
    {footer !== undefined && <div className="px-4 sm:px-6 py-4 border-t border-gray-200">{footer}</div>}
  </section>
);
