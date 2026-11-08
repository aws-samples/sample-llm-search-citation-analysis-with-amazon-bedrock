import type { ReactNode } from 'react';
import {
  Link, useInRouterContext
} from 'react-router-dom';

interface SeeAllLinkProps {
  /** The full view: an app path (`/citation-gaps`) or an in-page anchor (`#brand-leaderboard`). */
  readonly to: string;
  readonly children: ReactNode;
}

const SEE_ALL_CLASS = 'print-hidden text-sm font-medium text-gray-700 underline hover:text-gray-900 dark:text-gray-300 dark:hover:text-white';

/**
 * The "See all" of a widget that keeps its top N (2.45.0 wave 5): the way to the view listing
 * every row. A router link inside the app, a plain link elsewhere (an anchor, a test without a
 * router). Screen only.
 */
export function SeeAllLink({
  to, children
}: SeeAllLinkProps) {
  const routed = useInRouterContext();
  if (!routed || to.startsWith('#')) return <a href={to} className={SEE_ALL_CLASS}>{children}</a>;
  return <Link to={to} className={SEE_ALL_CLASS}>{children}</Link>;
}
