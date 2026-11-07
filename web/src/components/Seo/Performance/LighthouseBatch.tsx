/**
 * Batch Lighthouse (Admin): the latest finished audit's homepage plus one page per URL template, at most 10
 * pages, each on mobile and desktop. The paid call count is confirmed before anything starts.
 */
import { useState } from 'react';
import type { SiteAuditLoadState } from '../../../hooks/useSiteAuditLoad';
import type { LighthouseSample } from '../../../types/api/seoPerformance';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ConfirmModal } from '../../ui/Modal';
import {
  SkeletonLines, SkeletonRegion
} from '../../ui/Skeleton';

interface LighthouseBatchProps {
  readonly sample: SiteAuditLoadState<LighthouseSample>;
  readonly isAdmin: boolean;
  readonly busy: boolean;
  readonly onRun: (auditId: string) => void;
}

function SampleBody({
  sample, isAdmin, busy, onRun
}: Omit<LighthouseBatchProps, 'sample'> & { readonly sample: LighthouseSample }) {
  const [confirming, setConfirming] = useState(false);
  const { audit } = sample;
  if (audit === null || sample.pages.length === 0) {
    return <p className="text-sm text-gray-600">Run a site audit first: the batch measures the pages it crawled.</p>;
  }
  return (
    <>
      <p className="text-sm text-gray-700">
        {String(sample.pages.length)} pages from the audit of {audit.start_url ?? 'the site'} on mobile and desktop:
        {` ${String(sample.target_count)} runs.`}
      </p>
      <ul className="list-disc pl-5 text-sm text-gray-700 break-all">
        {sample.pages.map((page) => <li key={page}>{page}</li>)}
      </ul>
      {isAdmin
        ? <Button onClick={() => { setConfirming(true); }} disabled={busy}>Test the audit&apos;s sample pages</Button>
        : <p className="text-xs text-gray-500">An Admin can run the batch.</p>}
      <ConfirmModal
        title="Test the audit's sample pages?"
        message={`This starts ${String(sample.target_count)} paid DataForSEO calls, one Lighthouse run per page and device. Asking again within 15 minutes reuses them. Continue?`}
        confirmText="Start runs"
        isOpen={confirming}
        onConfirm={() => { onRun(audit.audit_id); }}
        onClose={() => { setConfirming(false); }}
      />
    </>
  );
}

export function LighthouseBatch(props: LighthouseBatchProps) {
  const { sample } = props;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3" aria-label="Audit sample">
      <h3 className="text-base font-semibold text-gray-900">Audit sample pages</h3>
      {sample.status === 'loading' && (
        <SkeletonRegion label="Loading the audit sample"><SkeletonLines lines={3} /></SkeletonRegion>
      )}
      {sample.status === 'error' && <ErrorAlert message={sample.message} />}
      {sample.status === 'success' && <SampleBody {...props} sample={sample.value} />}
    </section>
  );
}
