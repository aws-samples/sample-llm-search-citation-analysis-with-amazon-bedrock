/** Progress of a queued or running audit, read again by the report as its steps run; Admins may cancel it. */
import type { SiteAudit } from '../../../types/api/seoAudits';
import { Button } from '../../ui';
import { STATUS_LABELS } from './siteAuditFormat';

interface SiteAuditProgressProps {
  readonly audit: SiteAudit;
  readonly canCancel: boolean;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  discovery: 'Reading robots.txt and sitemaps',
  crawl: 'Crawling pages',
  finalize: 'Checking links, duplicates and AI readiness',
};

export function SiteAuditProgress({
  audit, canCancel, cancelling, onCancel,
}: SiteAuditProgressProps) {
  const total = Math.max(audit.pages_total ?? 0, audit.pages_crawled, 1);
  const percent = Math.min(100, Math.round((audit.pages_crawled / total) * 100));
  return (
    <section aria-label="Audit progress" className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{STATUS_LABELS[audit.status]}: {audit.start_url}</p>
          <p className="text-sm text-gray-500">{PHASE_LABELS[audit.phase ?? ''] ?? 'Starting'}</p>
        </div>
        {canCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel audit'}
          </Button>
        )}
      </div>
      <progress aria-label="Pages crawled" max={total} value={audit.pages_crawled} className="h-2 w-full accent-gray-900">
        {percent}%
      </progress>
      <p className="text-sm text-gray-600">
        {audit.pages_crawled.toLocaleString()} of {total.toLocaleString()} pages crawled (limit {audit.max_pages.toLocaleString()})
      </p>
    </section>
  );
}
