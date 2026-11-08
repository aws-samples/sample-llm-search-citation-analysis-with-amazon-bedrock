/**
 * One audit: its progress while queued or running (polled), its failure, or its summary, AI-readiness panel and
 * issues once completed. A cancelled audit shows what it had found before it stopped, if anything.
 *
 * "Export all" (once summarized) writes the issue types, the pages of every issue type and the robots.txt AI
 * crawler access on the server (`seo-site-audit`, stored data).
 */
import {
  useEffect, useRef, useState
} from 'react';
import { cancelAudit } from '../../../api/seoAudits';
import { seoErrorMessage } from '../../../api/seo';
import {
  isActiveAudit, useSiteAuditDetail
} from '../../../hooks/useSiteAuditDetail';
import type { SiteAuditDetail } from '../../../types/api/seoAudits';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ExportAllButton } from '../../ui/ExportAllButton';
import {
  SkeletonCards, SkeletonRegion
} from '../../ui/Skeleton';
import { SiteAuditIssues } from './SiteAuditIssues';
import { SiteAuditLoaded } from './SiteAuditLoaded';
import { SiteAuditProgress } from './SiteAuditProgress';
import { SiteAuditSummary } from './SiteAuditSummary';
import { STATUS_LABELS } from './siteAuditFormat';

interface SiteAuditReportProps {
  readonly auditId: string;
  readonly isAdmin: boolean;
  /** Called once the audit stops (finished, failed or cancelled), so the history can refresh. */
  readonly onSettled: () => void;
}

function FinishedAudit({ audit }: { readonly audit: SiteAuditDetail }) {
  if (audit.status === 'failed') {
    return <ErrorAlert message={`The audit failed during ${audit.phase ?? 'start'} (${audit.error_code ?? 'unknown error'}). Pages crawled before the failure are not summarized; start a new audit.`} />;
  }
  if (audit.summary === null) {
    return <p className="text-sm text-gray-600">{STATUS_LABELS[audit.status]} before any results were summarized.</p>;
  }
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ExportAllButton view="seo-site-audit" params={{ audit_id: audit.audit_id }} />
      </div>
      <SiteAuditSummary audit={audit} summary={audit.summary} readiness={audit.ai_readiness} />
      <SiteAuditIssues audit={audit} />
    </div>
  );
}

export function SiteAuditReport({
  auditId, isAdmin, onSettled,
}: SiteAuditReportProps) {
  const {
    state, reload 
  } = useSiteAuditDetail(auditId);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const wasActive = useRef(false);
  const active = state.status === 'success' && isActiveAudit(state.value.status);

  useEffect(() => {
    if (wasActive.current && !active) onSettled();
    wasActive.current = active;
  }, [active, onSettled]);

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelAudit(auditId);
      reload();
    } catch (failure) {
      setCancelError(seoErrorMessage(failure));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <SiteAuditLoaded state={state} skeleton={<SkeletonRegion label="Loading audit"><SkeletonCards count={4} /></SkeletonRegion>}>
      {(audit) => (active
        ? (
          <div className="space-y-2">
            <SiteAuditProgress audit={audit} canCancel={isAdmin} cancelling={cancelling} onCancel={() => void cancel()} />
            <ErrorAlert message={cancelError} />
          </div>
        )
        : <FinishedAudit audit={audit} />)}
    </SiteAuditLoaded>
  );
}
