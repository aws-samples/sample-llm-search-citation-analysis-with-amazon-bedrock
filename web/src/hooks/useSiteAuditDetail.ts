import { useCallback } from 'react';
import { fetchAudit } from '../api/seoAudits';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import type {
  AuditStatus, SiteAuditDetail
} from '../types/api/seoAudits';
import {
  useSiteAuditLoad, type SiteAuditLoad
} from './useSiteAuditLoad';
import { useLiveRefresh } from './useLiveRefresh';

const ACTIVE: readonly AuditStatus[] = ['queued', 'running'];

const SEO_CHANNEL = deploymentChannel('seo');

export function isActiveAudit(status: AuditStatus): boolean {
  return ACTIVE.includes(status);
}

/** Whether `event` says a step of audit `auditId` ran (`seo-job.changed`, `lambda/seo-jobs/seo-jobs.py`). */
export function isAuditEvent(event: LiveEvent, auditId: string): boolean {
  return eventField(event, 'feature') === 'audit' && eventField(event, 'id') === auditId;
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

  useLiveRefresh(
    active ? SEO_CHANNEL : null,
    () => {
      reload();
      return Promise.resolve();
    },
    (event) => auditId !== null && isAuditEvent(event, auditId)
  );

  return detail;
}
