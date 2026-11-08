import type { ReactNode } from 'react';
import type { SiteAuditLoadState } from '../../../hooks/useSiteAuditLoad';
import { ErrorAlert } from '../../ui/ErrorAlert';

interface SiteAuditLoadedProps<T> {
  readonly state: SiteAuditLoadState<T>;
  /** Shown while the first answer is on its way (a skeleton shaped like the content). */
  readonly skeleton: ReactNode;
  readonly children: (value: T) => ReactNode;
}

/** The three states of a site-audit read: the skeleton, the error message, or the loaded content. */
export function SiteAuditLoaded<T>({
  state, skeleton, children
}: SiteAuditLoadedProps<T>) {
  if (state.status === 'success') return <>{children(state.value)}</>;
  return state.status === 'error' ? <ErrorAlert message={state.message} /> : <>{skeleton}</>;
}
