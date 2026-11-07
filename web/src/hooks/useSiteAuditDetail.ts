import {
  useCallback, useEffect
} from 'react';
import { fetchAudit } from '../api/seoAudits';
import type {
  AuditStatus, SiteAuditDetail
} from '../types/api/seoAudits';
import {
  useSiteAuditLoad, type SiteAuditLoad
} from './useSiteAuditLoad';

/** How often a queued or running audit is read again (the detail route is a single DynamoDB read). */
export const AUDIT_POLL_MS = 5_000;

const ACTIVE: readonly AuditStatus[] = ['queued', 'running'];

export function isActiveAudit(status: AuditStatus): boolean {
  return ACTIVE.includes(status);
}

/** One audit, polled every `AUDIT_POLL_MS` while it is queued or running; `null` loads nothing. */
export function useSiteAuditDetail(auditId: string | null): SiteAuditLoad<SiteAuditDetail> {
  const load = useCallback(
    async (signal: AbortSignal) => (await fetchAudit(auditId ?? '', { signal })).audit,
    [auditId]
  );
  const detail = useSiteAuditLoad(auditId, load);
  const {
    state, reload 
  } = detail;
  const active = state.status === 'success' && isActiveAudit(state.value.status);
  const lastRead = state.status === 'success' ? state.value : null;

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(reload, AUDIT_POLL_MS);
    return () => clearTimeout(timer);
  }, [active, lastRead, reload]);

  return detail;
}
