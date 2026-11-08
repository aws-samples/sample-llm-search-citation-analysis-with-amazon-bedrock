import type { ReactNode } from 'react';
import {
  SkeletonLines, SkeletonRegion
} from './Skeleton';

interface ComputingStateProps {
  /** What is being computed, e.g. "visibility figures" (default "figures"). */
  readonly subject?: string;
  /** Skeleton shaped like the content (defaults to a few text lines). */
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * Shown while a `202` view job computes a scoped answer no snapshot holds (2.45.0): the
 * skeleton of the content plus a line saying the complete figures are being computed. The data
 * hook keeps polling (`api/viewJobs.ts`) and the view swaps this for the figures when they arrive.
 */
export function ComputingState({
  subject = 'figures', children, className = ''
}: ComputingStateProps) {
  const text = `Computing the complete ${subject} for every keyword of this scope… This can take a few minutes; the page updates by itself.`;
  return (
    <SkeletonRegion label={text} className={className}>
      <p aria-hidden="true" className="mb-3 text-sm text-gray-600">{text}</p>
      {children ?? <SkeletonLines lines={4} />}
    </SkeletonRegion>
  );
}
