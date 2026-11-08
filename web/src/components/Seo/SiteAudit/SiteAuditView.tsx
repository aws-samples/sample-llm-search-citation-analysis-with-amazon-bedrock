/**
 * Site audit: crawl the brand's own site and report SEO and AI-readiness issues.
 *
 * Admins start (and cancel) audits; every signed-in user reads them. The list and the reports are free reads
 * (no paid API), so they load on mount; an audit starts only after the confirmation dialog.
 */
import {
  useCallback, useState, type ReactNode
} from 'react';
import {
  isSeoApiConfigured, seoErrorMessage
} from '../../../api/seo';
import { startAudit } from '../../../api/seoAudits';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { isActiveAudit } from '../../../hooks/useSiteAuditDetail';
import { useSiteAuditList } from '../../../hooks/useSiteAuditList';
import type {
  AuditListResponse, SiteAudit
} from '../../../types/api/seoAudits';
import { NOT_SET_UP_TITLE } from '../../KeywordResearch/explorer/KeywordExplorer';
import { CenteredEmpty } from '../../ui/CenteredState';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import { GlobeIcon } from '../../ui';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import { SiteAuditLoaded } from './SiteAuditLoaded';
import { SiteAuditReport } from './SiteAuditReport';
import { SiteAuditStartForm } from './SiteAuditStartForm';
import {
  STATUS_LABELS, formatAuditDate
} from './siteAuditFormat';

const SiteAuditNotSetUp = () => (
  <section aria-label="Site audit setup" className="rounded-lg border border-gray-200 bg-white p-6">
    <h3 className="mb-2 text-base font-semibold text-gray-900">{NOT_SET_UP_TITLE}</h3>
    <p className="text-sm text-gray-600">The site audit runs in the SEO stack: deploy <code>CitationAnalysisSeoStack</code> and rebuild the dashboard.</p>
  </section>
);

function AuditHistory({
  audits, selectedId, onSelect
}: {
  readonly audits: readonly SiteAudit[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void 
}) {
  return (
    <nav aria-label="Recent audits" className="flex flex-wrap gap-2">
      {audits.map((audit) => (
        <button
          key={audit.audit_id}
          type="button"
          aria-pressed={audit.audit_id === selectedId}
          onClick={() => onSelect(audit.audit_id)}
          className={`rounded-lg border px-3 py-1.5 text-left text-xs ${audit.audit_id === selectedId ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'}`}
        >
          <span className="block font-medium text-gray-900">{audit.start_url}</span>
          <span className="text-gray-500">{STATUS_LABELS[audit.status]} · {formatAuditDate(audit.started_at)}</span>
        </button>
      ))}
    </nav>
  );
}

function ConfiguredSiteAudit() {
  const { isAdmin } = useIsAdmin();
  const {
    state, reload 
  } = useSiteAuditList();
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const start = useCallback(async (startUrl: string, maxPages: number) => {
    setStarting(true);
    setStartError(null);
    try {
      const { audit } = await startAudit({
        start_url: startUrl,
        max_pages: maxPages,
      });
      setSelected(audit.audit_id);
      reload();
    } catch (failure) {
      setStartError(seoErrorMessage(failure));
    } finally {
      setStarting(false);
    }
  }, [reload]);

  return (
    <div className="space-y-4">
      <PageHeaderCard title="Site Audit" relaxed={false}
        description="Crawls one of the brand's sites and lists the technical SEO and AI-readiness issues of each page." />
      <SiteAuditLoaded
        state={state}
        skeleton={<SkeletonRegion label="Loading audits" className="bg-white rounded-lg border border-gray-200"><SkeletonTable rows={3} columns={3} /></SkeletonRegion>}
      >
        {(list) => (
          <AuditWorkspace
            list={list}
            isAdmin={isAdmin}
            selected={selected}
            onSelect={setSelected}
            onSettled={reload}
            startForm={(running) => (
              <SiteAuditStartForm
                sites={list.sites}
                maxPagesChoices={list.max_pages_choices}
                starting={starting}
                error={startError}
                disabledReason={running ? 'An audit is running; wait for it or cancel it.' : null}
                onStart={(url, pages) => void start(url, pages)}
              />
            )}
          />
        )}
      </SiteAuditLoaded>
    </div>
  );
}

interface AuditWorkspaceProps {
  readonly list: AuditListResponse;
  readonly isAdmin: boolean;
  readonly selected: string | null;
  readonly onSelect: (auditId: string) => void;
  readonly onSettled: () => void;
  /** The start form, told whether an audit is already running. */
  readonly startForm: (running: boolean) => ReactNode;
}

function AuditWorkspace({
  list, isAdmin, selected, onSelect, onSettled, startForm,
}: AuditWorkspaceProps) {
  const { audits } = list;
  const shownId = selected ?? (audits.length > 0 ? audits[0].audit_id : null);
  const running = audits.some((audit) => isActiveAudit(audit.status));
  return (
    <div className="space-y-4">
      {isAdmin && startForm(running)}
      {audits.length > 0 && <AuditHistory audits={audits} selectedId={shownId} onSelect={onSelect} />}
      {shownId === null
        ? <CenteredEmpty icon={<GlobeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />} title="No audits yet"
          hint={isAdmin ? 'Start an audit of one of the brand’s sites.' : 'An Admin can start an audit of the brand’s site.'} />
        : <SiteAuditReport key={shownId} auditId={shownId} isAdmin={isAdmin} onSettled={onSettled} />}
    </div>
  );
}

export function SiteAuditView() {
  if (!isSeoApiConfigured()) return <SiteAuditNotSetUp />;
  return <ConfiguredSiteAudit />;
}
