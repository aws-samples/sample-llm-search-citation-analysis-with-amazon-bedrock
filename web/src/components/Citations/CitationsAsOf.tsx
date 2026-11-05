import type { CitationsPage } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';

interface CitationsAsOfProps {readonly totals: CitationsPage | null;}

/**
 * When the figures were computed: a page served from the citation rollup
 * says when the rollup was built; a live page read while the rollup is
 * rebuilt says so. Nothing for a plain live page or an older API build.
 */
export function CitationsAsOf({ totals }: CitationsAsOfProps) {
  if (totals?.source === 'rollup' && typeof totals.as_of === 'string') {
    return <p className="text-xs text-gray-500">Figures as of {formatDate(totals.as_of)}.</p>;
  }
  if (totals?.stale === true) {
    return <p className="text-xs text-gray-500">The precomputed figures are being refreshed; this page was read live.</p>;
  }
  return null;
}
