import { useCallback } from 'react';
import { listAudits } from '../api/seoAudits';
import type { AuditListResponse } from '../types/api/seoAudits';
import {
  useSiteAuditLoad, type SiteAuditLoad
} from './useSiteAuditLoad';

const LIST_KEY = 'audits';

/** Recent audits and the owned sites an audit may start from (a free read, loaded on mount). */
export function useSiteAuditList(): SiteAuditLoad<AuditListResponse> {
  const load = useCallback((signal: AbortSignal) => listAudits({ signal }), []);
  return useSiteAuditLoad(LIST_KEY, load);
}
