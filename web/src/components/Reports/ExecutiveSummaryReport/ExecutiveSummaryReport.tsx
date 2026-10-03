import {
  useNavigate, useSearchParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import {
  KpiDefinitionsSection, ReportLayout
} from '../layout';
import type { ReportScope } from '../../../types';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';
import {
  ALL_SCOPE, describeReportScope 
} from '../../ui/reportScope';
import { useExecutiveSummary } from './useExecutiveSummary';
import { HeadlineSection } from './sections/HeadlineSection';
import { TrendSnapshotSection } from './sections/TrendSnapshotSection';
import { WinsAndGapsSection } from './sections/WinsAndGapsSection';
import { NextActionsSection } from './sections/NextActionsSection';

/**
 * Executive Summary report — the single-page deck a CMO or VP Marketing
 * would print before a quarterly business review. Sources its data from
 * `/reports/overview`, the consolidated aggregator endpoint, so it
 * doesn't replicate cross-keyword aggregation logic on the client.
 * `?group=<id>` narrows it to one keyword group (a hotel).
 *
 * Sections, in this order:
 *   1. Headline — every KPI with its change, and the keywords by trend.
 *   2. Trend and share of voice — the KPI lines and the share-of-voice donut.
 *   3. Top wins and gaps — three improvers, three decliners.
 *   4. Next actions — top three recommendations.
 *   5. How these KPIs are measured — the definitions, for print.
 *
 * Designed to print the state on the first page (sections 1+2) and what
 * to do about it on the second (sections 3+4, via `startNewPage` on
 * WinsAndGapsSection).
 */
export function ExecutiveSummaryReport() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { groups } = useKeywordGroups();
  const groupId = searchParams.get('group');
  const scope: ReportScope = groupId ? {
    kind: 'group',
    groupId 
  } : ALL_SCOPE;
  const data = useExecutiveSummary(undefined, scope);
  const overview = {
    data: data.data,
    loading: data.loading,
    error: data.error,
  };

  usePrintMode({ ready: data.ready });

  // The API names the scope it summarised; before it answers, the group list does.
  const scopeLabel = data.data?.scope.label ?? describeReportScope(scope, groups);
  const subtitle = scope.kind === 'group'
    ? `The one-page state of brand visibility for "${scopeLabel}" across AI search engines.`
    : 'The one-page state of brand visibility across AI search engines. For quarterly reviews and exec stand-ups.';

  return (
    <ReportLayout
      title="Executive Summary"
      subtitle={subtitle}
      actions={(
        <KeywordScopeSelector
          keywords={[]}
          groups={groups}
          value={scope}
          onChange={(next) => navigate(next.kind === 'group' ? `/reports/executive-summary?group=${encodeURIComponent(next.groupId)}` : '/reports/executive-summary')}
          label="Scope"
          className="min-w-[16rem]"
        />
      )}
    >
      <HeadlineSection {...overview} />
      <TrendSnapshotSection {...overview} />
      <WinsAndGapsSection {...overview} />
      <NextActionsSection {...overview} />
      <KpiDefinitionsSection definitions={VISIBILITY_DEFINITIONS} />
    </ReportLayout>
  );
}
