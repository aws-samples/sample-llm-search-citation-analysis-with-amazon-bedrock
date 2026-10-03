import {
  Link, useNavigate, useParams, useSearchParams
} from 'react-router-dom';
import type { CustomReport } from '../../../api/customReports';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { usePrintMode } from '../../../hooks/usePrintMode';
import type { Keyword } from '../../../types';
import {
  Button, PencilIcon
} from '../../ui';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';
import { describeReportScope } from '../../ui/reportScope';
import { CompetitorSwitcher } from '../CompetitorGapReport/CompetitorGapReport';
import {
  ReportLayout, SectionPlaceholder
} from '../layout';
import {
  PeriodSelector, scopeLabelOf
} from '../scopeReport/ScopeReport';
import { scopeFromSearch } from '../scopeReport/scopeReportRoute';
import { sourcesFor } from './blockCatalog';
import { keyedBlocks } from './blockOrder';
import {
  customReportDays, customReportEditPath, customReportViewPath, type ReportViewSettings
} from './customReportRoute';
import { ReportBlockView } from './ReportBlockView';
import {
  ReportSourcesProvider, sourcesReady, useReportSources, type CompetitorSource
} from './reportSources';
import { useCustomReports } from './useCustomReports';

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

interface MissingReportProps {
  readonly message: string;
  readonly variant: 'loading' | 'error' | 'empty';
}

function MissingReport({
  message, variant
}: MissingReportProps) {
  return (
    <ReportLayout title="Custom report">
      <SectionPlaceholder variant={variant} message={message} />
      {variant !== 'loading' && (
        <Link to="/reports" className="text-sm font-medium text-gray-700 underline hover:text-gray-900">
          Back to Reports
        </Link>
      )}
    </ReportLayout>
  );
}

/**
 * A saved custom report (`/reports/custom/:id`): its blocks in their saved
 * order, for the scope, period and competitor in the URL (every keyword,
 * the saved period and the first configured competitor by default).
 */
export function CustomReportView({ keywords }: Props) {
  const { id } = useParams<{ id: string }>();
  const {
    reports, loading, error
  } = useCustomReports();
  const report = reports.find((saved) => saved.id === id);

  if (loading) return <MissingReport variant="loading" message="Loading the report…" />;
  if (error !== null) return <MissingReport variant="error" message={error} />;
  if (report === undefined) return <MissingReport variant="empty" message="This report no longer exists. It may have been deleted." />;
  return <SavedReport report={report} keywords={keywords} />;
}

interface SavedReportProps {
  readonly report: CustomReport;
  readonly keywords: ReadonlyArray<Keyword>;
}

function SavedReport({
  report, keywords
}: SavedReportProps) {
  const [searchParams] = useSearchParams();
  const view: ReportViewSettings = {
    scope: scopeFromSearch(searchParams),
    days: customReportDays(searchParams, report.days),
    competitor: searchParams.get('competitor'),
  };
  return (
    <ReportSourcesProvider sources={sourcesFor(report.blocks, view.scope)} inputs={view}>
      <ReportPage report={report} keywords={keywords} />
    </ReportSourcesProvider>
  );
}

interface CompetitorPickerProps {
  readonly competitor: CompetitorSource | null;
  readonly onChange: (competitor: string) => void;
}

/** The competitor picker, for a report with Competitor Gap blocks once a competitor is configured. */
function CompetitorPicker({
  competitor, onChange
}: CompetitorPickerProps) {
  const selected = competitor?.selected ?? null;
  return competitor !== null && selected !== null
    ? <CompetitorSwitcher selected={selected} competitors={competitor.competitors} onChange={onChange} />
    : null;
}

function ReportPage({
  report, keywords
}: SavedReportProps) {
  const navigate = useNavigate();
  const { groups } = useKeywordGroups();
  const sources = useReportSources();
  const view = sources.inputs;
  const { competitor } = sources;

  usePrintMode({ ready: sourcesReady(sources) });

  const show = (next: Partial<ReportViewSettings>) => navigate(customReportViewPath(report.id, report.days, {
    ...view,
    ...next,
  }));
  const scopeLabel = sources.scope === null ? describeReportScope(view.scope, groups) : scopeLabelOf(sources.scope, view.scope, groups);

  return (
    <ReportLayout
      title={report.title}
      subtitle={`${scopeLabel} · last ${view.days} days`}
      actions={(
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <KeywordScopeSelector
            keywords={[...keywords]}
            groups={groups}
            value={view.scope}
            onChange={(scope) => show({ scope })}
            className="min-w-[16rem]"
          />
          <PeriodSelector days={view.days} onChange={(days) => show({ days })} />
          <CompetitorPicker competitor={competitor} onChange={(selected) => show({ competitor: selected })} />
          <Button variant="secondary" leadingIcon={<PencilIcon className="h-4 w-4" />} onClick={() => navigate(customReportEditPath(report.id))}>
            Edit report
          </Button>
        </div>
      )}
    >
      {keyedBlocks(report.blocks).map(({
        key, block
      }) => <ReportBlockView key={key} block={block} sources={sources} />)}
    </ReportLayout>
  );
}
