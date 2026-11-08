/**
 * The pages one issue type affects, 50 at a time, in a dialog, with an Excel export of the pages loaded so far.
 * Crawled URLs are shown as links only when they are plain http(s) addresses (`safeHref`), since they come from
 * the audited site.
 */
import { useAffectedPages } from '../../../hooks/useSiteAuditIssues';
import { safeHref } from '../../../infrastructure/urlSafety';
import type {
  AuditIssue, IssueTypeEntry
} from '../../../types/api/seoAudits';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ExportExcelButton } from '../../ui/ExportExcelButton';
import { SkeletonLines } from '../../ui/Skeleton';
import {
  exportAffectedPagesExcel, issueDetailText
} from './siteAuditExcel';

const MAX_DETAIL_CHARS = 160;

/** A short readable form of an issue's details (`issueDetailText`), cut to 160 characters. */
function detailText(details: Record<string, unknown>): string {
  const text = issueDetailText(details);
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
}

function PageRow({ issue }: { readonly issue: AuditIssue }) {
  const href = safeHref(issue.page_url);
  return (
    <li className="py-2 border-t border-gray-100 text-sm">
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-gray-900 underline break-all">{issue.page_url}</a>
        : <span className="break-all">{issue.page_url}</span>}
      {Object.keys(issue.details).length > 0 && <p className="text-xs text-gray-500 break-all">{detailText(issue.details)}</p>}
    </li>
  );
}

interface AffectedPagesDrawerProps {
  readonly auditId: string;
  /** The audited site's start URL, whose host names the export file. */
  readonly startUrl: string;
  readonly entry: IssueTypeEntry | null;
  readonly onClose: () => void;
}

export function AffectedPagesDrawer({
  auditId, startUrl, entry, onClose
}: AffectedPagesDrawerProps) {
  const pages = useAffectedPages(auditId, entry?.issue_type ?? null);
  return (
    <Modal isOpen={entry !== null} onClose={onClose} title={entry?.title ?? ''} size="4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm text-gray-600">{entry?.how_to_fix}</p>
          <ExportExcelButton
            onExport={() => exportAffectedPagesExcel(pages.items, entry?.title ?? '', startUrl)}
            failureLabel="[seo] Site audit affected pages Excel export failed:" disabled={pages.items.length === 0}
            title={pages.hasMore ? 'The pages loaded so far (Load more adds the next ones)' : 'The affected pages'}
          />
        </div>
        <ul aria-label="Affected pages">
          {pages.items.map((issue) => <PageRow key={`${issue.page_url}|${JSON.stringify(issue.details)}`} issue={issue} />)}
        </ul>
        {pages.loading && <SkeletonLines lines={3} />}
        <ErrorAlert message={pages.error} />
        {pages.hasMore && !pages.loading && <Button variant="secondary" size="sm" onClick={pages.loadMore}>Load more</Button>}
      </div>
    </Modal>
  );
}
