/**
 * The issue types a finished audit found, grouped by severity (critical first), each with its explanation and
 * how to fix it, a "View pages" button that opens the affected pages, and an Excel export of the list.
 */
import { useState } from 'react';
import { useSiteAuditIssueTypes } from '../../../hooks/useSiteAuditIssues';
import type {
  IssueTypeEntry, SiteAudit
} from '../../../types/api/seoAudits';
import { Button } from '../../ui';
import { ExportExcelButton } from '../../ui/ExportExcelButton';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import { AffectedPagesDrawer } from './AffectedPagesDrawer';
import { SiteAuditLoaded } from './SiteAuditLoaded';
import { exportIssueTypesExcel } from './siteAuditExcel';
import {
  GROUP_LABELS, SEVERITY_BADGES, SEVERITY_LABELS, SEVERITY_ORDER
} from './siteAuditFormat';

function IssueCard({
  entry, onOpen
}: {
  readonly entry: IssueTypeEntry;
  readonly onOpen: (entry: IssueTypeEntry) => void 
}) {
  return (
    <li className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs ${SEVERITY_BADGES[entry.severity]}`}>{SEVERITY_LABELS[entry.severity]}</span>
        <span className="text-xs text-gray-500">{GROUP_LABELS[entry.group]}</span>
        <h4 className="text-sm font-semibold text-gray-900">{entry.title}</h4>
        <span className="ml-auto text-sm text-gray-600">{entry.pages.toLocaleString()} pages</span>
        <Button variant="secondary" size="sm" onClick={() => onOpen(entry)} aria-label={`View pages: ${entry.title}`}>
          View pages
        </Button>
      </div>
      <p className="text-sm text-gray-600">{entry.explanation}</p>
      <p className="text-sm text-gray-800"><span className="font-medium">How to fix: </span>{entry.how_to_fix}</p>
    </li>
  );
}

function IssueList({
  audit, entries
}: {
  readonly audit: SiteAudit;
  readonly entries: readonly IssueTypeEntry[] 
}) {
  const [open, setOpen] = useState<IssueTypeEntry | null>(null);
  if (entries.length === 0) return <p className="text-sm text-gray-600">No issues found.</p>;
  return (
    <>
      <div className="flex justify-end">
        <ExportExcelButton onExport={() => exportIssueTypesExcel(entries, audit.start_url)}
          failureLabel="[seo] Site audit issues Excel export failed:" title="Every issue type of this audit" />
      </div>
      {SEVERITY_ORDER.map((severity) => {
        const ofSeverity = entries.filter((entry) => entry.severity === severity);
        if (ofSeverity.length === 0) return null;
        return (
          <section key={severity} aria-label={`${SEVERITY_LABELS[severity]} issues`} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">{SEVERITY_LABELS[severity]} ({ofSeverity.length})</h3>
            <ul className="space-y-2">{ofSeverity.map((entry) => <IssueCard key={entry.issue_type} entry={entry} onOpen={setOpen} />)}</ul>
          </section>
        );
      })}
      <AffectedPagesDrawer auditId={audit.audit_id} startUrl={audit.start_url} entry={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function SiteAuditIssues({ audit }: { readonly audit: SiteAudit }) {
  const { state } = useSiteAuditIssueTypes(audit.audit_id);
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">Issues</h3>
      <SiteAuditLoaded
        state={state}
        skeleton={(
          <SkeletonRegion label="Loading issues" className="bg-white rounded-lg border border-gray-200">
            <SkeletonTable rows={5} columns={3} rowClassName="h-12" />
          </SkeletonRegion>
        )}
      >
        {(entries) => <IssueList audit={audit} entries={entries} />}
      </SiteAuditLoaded>
    </div>
  );
}
