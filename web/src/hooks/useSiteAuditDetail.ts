import { useCallback } from 'react';
import { fetchAudit } from '../api/seoAudits';
import type {
  AuditStatus, SiteAuditDetail
} from '../types/api/seoAudits';
import {
  useSiteAuditLoad, type SiteAuditLoad
} from './useSiteAuditLoad';
import { useSeoJobRefresh } from './useSeoJobRefresh';

const ACTIVE: readonly AuditStatus[] = ['queued', 'running'];

export function isActiveAudit(status: AuditStatus): boolean {
  return ACTIVE.includes(status);
}

/**
 * One audit; `null` loads nothing. While it is queued or running it listens to the SEO channel and reads the
 * audit again when a step of it ran, and once on every (re)connect to catch up (TENETS.md tenet 8).
 */
export function useSiteAuditDetail(auditId: string | null): SiteAuditLoad<SiteAuditDetail> {
  const load = useCallback(
    async (signal: AbortSignal) => (await fetchAudit(auditId ?? '', { signal })).audit,
    [auditId]
  );
  const detail = useSiteAuditLoad(auditId, load);
  const {
    state, reload 
  } = detail;
  const active = auditId !== null && state.status === 'success' && isActiveAudit(state.value.status);

  useSeoJobRefresh('audit', active ? auditId : null, () => {
    reload();
    return Promise.resolve();
  });

  return detail;
}
