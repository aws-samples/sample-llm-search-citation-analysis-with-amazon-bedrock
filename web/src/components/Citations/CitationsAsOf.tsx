import type { CitationsPage } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';

interface CitationsAsOfProps {readonly totals: CitationsPage | null;}

/**
 * When the figures were computed: a page served from the citation rollup (or,
 * since 2.45.0, a scope snapshot) says when it was built; a stale snapshot shown
 * while it is rebuilt says it is updating (the page refetches until it is
 * current); a live page read while the rollup is rebuilt says so. Nothing for a
 * plain live page or an older API build.
 */
export function CitationsAsOf({ totals }: CitationsAsOfProps) {
  const precomputed = totals?.source === 'rollup' || totals?.source === 'snapshot';
  if (precomputed && totals.stale === true) {
    return (
      <output className="block text-xs text-blue-700">
        {`Updating to the latest keyword changes… These figures are from ${typeof totals.as_of === 'string' ? formatDate(totals.as_of) : 'the previous build'}.`}
      </output>
    );
  }
  if (precomputed && typeof totals.as_of === 'string') {
    return <p className="text-xs text-gray-500">Figures as of {formatDate(totals.as_of)}.</p>;
  }
  if (totals?.stale === true) {
    return <p className="text-xs text-gray-500">The precomputed figures are being refreshed; this page was read live.</p>;
  }
  return null;
}
