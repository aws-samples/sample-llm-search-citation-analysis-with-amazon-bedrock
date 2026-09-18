import {
  useNavigate, useSearchParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { ReportLayout } from '../layout';
import type { ReportScope } from '../../../types';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';
import {
  ALL_SCOPE, describeReportScope 
} from '../../ui/reportScope';
import { useExecutiveSummary } from './useExecutiveSummary';
import { HeadlineSection } from './sections/HeadlineSection';
import { WinsAndGapsSection } from './sections/WinsAndGapsSection';
import { NextActionsSection } from './sections/NextActionsSection';

/**
 * Executive Summary report — the single-page deck a CMO or VP Marketing
 * would print before a quarterly business review. Sources its data from
 * `/reports/overview`, the consolidated aggregator endpoint, so it
 * doesn't replicate cross-keyword aggregation logic on the client.
 * `?group=<id>` narrows it to one keyword group (a hotel).
 *
 * Three sections, in this order:
 *   1. Headline — overall score, 30-day movement, breadth.
 *   2. Top wins and gaps — three improvers, three decliners.
 *   3. Next actions — top three recommendations.
 *
 * Designed to fit on two printed pages: sections 1+2 on the first,
 * section 3 on the second (via `startNewPage` on NextActionsSection).
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

  usePrintMode({ ready: data.ready });

  const subtitle = scope.kind === 'group'
    ? `The one-page state of brand visibility for "${describeReportScope(scope, groups)}" across AI search engines.`
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
      <HeadlineSection
        data={data.data}
        loading={data.loading}
        error={data.error}
      />
      <WinsAndGapsSection
        data={data.data}
        loading={data.loading}
        error={data.error}
      />
      <NextActionsSection
        data={data.data}
        loading={data.loading}
        error={data.error}
      />
    </ReportLayout>
  );
}
