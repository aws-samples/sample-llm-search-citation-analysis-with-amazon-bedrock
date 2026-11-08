import type { ReactNode } from 'react';
import type { SeoRequestState } from '../../hooks/useKeywordExplorerRequest';
import { ErrorAlert } from '../ui/ErrorAlert';
import {
  SkeletonRegion, SkeletonTable
} from '../ui/Skeleton';

export interface SeoRequestStatusProps<TResponse> {
  readonly state: SeoRequestState<TResponse>;
  /** Names the loading placeholder for assistive technology. */
  readonly loadingLabel: string;
  readonly columns: number;
  readonly rows?: number;
  readonly rowClassName?: string;
  /** Classes of the loading placeholder's frame. */
  readonly className?: string;
  readonly children: (response: TResponse) => ReactNode;
}

/** A table-shaped skeleton while an SEO lookup runs, its error, then its answer; nothing before the first request. */
export function SeoRequestStatus<TResponse>({
  state, loadingLabel, columns, rows = 8, rowClassName = 'h-8', className, children
}: SeoRequestStatusProps<TResponse>) {
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
      return (
        <SkeletonRegion label={loadingLabel} className={className}>
          <SkeletonTable rows={rows} columns={columns} rowClassName={rowClassName} />
        </SkeletonRegion>
      );
    case 'error':
      return <ErrorAlert message={state.message} />;
    case 'success':
      return <>{children(state.response)}</>;
  }
}
