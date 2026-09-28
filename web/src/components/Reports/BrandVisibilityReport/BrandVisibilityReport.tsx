import {
  useEffect, useState
} from 'react';
import {
  useNavigate, useParams, useSearchParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { ReportLayout } from '../layout';
import type {
  Keyword, ReportScope 
} from '../../../types';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';
import { describeReportScope } from '../../ui/reportScope';
import { useBrandVisibilityReport } from './useBrandVisibilityReport';
import { PerKeywordHeadlineSection } from './sections/PerKeywordHeadlineSection';
import { BrandRankingsSection } from './sections/BrandRankingsSection';
import { TrendHistorySection } from './sections/TrendHistorySection';
import { CrossKeywordHeadlineSection } from './sections/CrossKeywordHeadlineSection';
import { PerKeywordTableSection } from './sections/PerKeywordTableSection';
import { MoversSection } from './sections/MoversSection';
import { GroupKpiReport } from './GroupKpiReport';

/** The per-hotel report opens on the last 90 days (the API's default window). */
const DEFAULT_GROUP_REPORT_DAYS = 90;

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Brand Visibility report. Three URL shapes:
 *   - `/reports/visibility` — all-keywords overview
 *   - `/reports/visibility?group=<id>` — one keyword group (a hotel)
 *   - `/reports/visibility/:keyword` — per-keyword deep cut
 *
 * The URL is the mode switch. A scope selector at the top lets the user jump
 * between modes from inside the report (it's print-hidden so the PDF doesn't
 * carry the dropdown).
 *
 * The marketing-lead audience reads this for "are we winning, level, or
 * losing", so the per-keyword variant is anchored on the gap to
 * competitor average and the cross-keyword variants on improving vs
 * declining counts plus the group's history.
 */
export function BrandVisibilityReport({ keywords }: Props) {
  const params = useParams<{ keyword?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { groups } = useKeywordGroups();

  const selectedKeyword = params.keyword ? decodeURIComponent(params.keyword) : null;
  const selectedGroupId = searchParams.get('group');
  const scope: ReportScope = resolveScope(selectedKeyword, selectedGroupId);
  const [days, setDays] = useState(DEFAULT_GROUP_REPORT_DAYS);

  // Auto-redirect: if the user navigated to /reports/visibility/:keyword
  // with a slug that no longer matches any tracked keyword, fall back to
  // the all-keywords overview rather than render a confusing empty state.
  useEffect(() => {
    if (
      selectedKeyword
      && keywords.length > 0
      && !keywords.some((k) => k.keyword === selectedKeyword)
    ) {
      navigate('/reports/visibility', { replace: true });
    }
  }, [selectedKeyword, keywords, navigate]);

  const data = useBrandVisibilityReport(scope, days);

  usePrintMode({ ready: data.ready });

  const subtitle = subtitleFor(scope, describeReportScope(scope, groups));

  return (
    <ReportLayout
      title="Brand Visibility"
      subtitle={subtitle}
      actions={(
        <KeywordScopeSelector
          keywords={[...keywords]}
          groups={groups}
          value={scope}
          onChange={(next) => navigate(pathFor(next))}
          className="min-w-[16rem]"
        />
      )}
    >
      {scope.kind === 'keyword' && <KeywordSections data={data} />}
      {scope.kind === 'group' && (
        <GroupKpiReport
          history={data.groupHistory}
          loading={data.groupHistoryLoading}
          error={data.groupHistoryError}
          days={days}
          onDaysChange={setDays}
        />
      )}
      {scope.kind === 'all' && <AllKeywordsSections data={data} />}
    </ReportLayout>
  );
}

type ReportData = ReturnType<typeof useBrandVisibilityReport>;

interface SectionsProps {readonly data: ReportData;}

/** One keyword: headline against competitors, brand rankings, score history. */
function KeywordSections({ data }: SectionsProps) {
  const headlineLoading = data.visibilityLoading || data.trendsLoading;
  return (
    <>
      <PerKeywordHeadlineSection
        trends={data.trends}
        visibility={data.visibility}
        error={data.visibilityError ?? data.trendsError}
        loading={headlineLoading}
      />
      <BrandRankingsSection
        visibility={data.visibility}
        loading={data.visibilityLoading}
        error={data.visibilityError}
      />
      <TrendHistorySection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
    </>
  );
}

/** Every keyword: improving / declining counts, history, movers, per-keyword table. */
function AllKeywordsSections({ data }: SectionsProps) {
  return (
    <>
      <CrossKeywordHeadlineSection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
      <TrendHistorySection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
      <MoversSection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
      <PerKeywordTableSection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
    </>
  );
}

function resolveScope(keyword: string | null, groupId: string | null): ReportScope {
  if (keyword) return {
    kind: 'keyword',
    keyword 
  };
  if (groupId) return {
    kind: 'group',
    groupId 
  };
  return { kind: 'all' };
}

function pathFor(scope: ReportScope): string {
  if (scope.kind === 'keyword') return `/reports/visibility/${encodeURIComponent(scope.keyword)}`;
  if (scope.kind === 'group') return `/reports/visibility?group=${encodeURIComponent(scope.groupId)}`;
  return '/reports/visibility';
}

function subtitleFor(scope: ReportScope, label: string): string {
  if (scope.kind === 'keyword') return `Per-keyword visibility for "${label}"`;
  if (scope.kind === 'group') return `Keyword group "${label}" — citation rate, share of voice and prominence per run`;
  return 'Cross-keyword visibility overview';
}
