import { useEffect } from 'react';
import {
  useNavigate, useParams, useSearchParams
} from 'react-router-dom';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { GroupScopeSelector } from '../layout/GroupScopeSelector';
import { scopeFromSearch } from '../scopeReport/scopeReportRoute';
import type { ReportScope } from '../../../types';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useBrandConfig } from '../../../hooks/useBrandConfig';
import {
  ReportLayout, SectionPlaceholder 
} from '../layout';
import {
  REPORT_CONTROL_LABEL_CLASS, REPORT_CONTROL_SELECT_CLASS
} from '../layout/reportControls';
import { useCompetitorGap } from './useCompetitorGap';
import { HeadlineSection } from './sections/HeadlineSection';
import { OutrankedKeywordsSection } from './sections/OutrankedKeywordsSection';
import { OutreachTargetsSection } from './sections/OutreachTargetsSection';
import { rollupSlice } from './sections/rollupSection';
import { ExportAllButton } from '../../ui/ExportAllButton';
import { requestParams } from '../../../api/exports';

/**
 * Competitor Gap report. Per-competitor printable layout aimed at a
 * content / PR strategist deciding where to invest outreach budget.
 *
 * URL shapes:
 *   /reports/competitor                      -> auto-redirects to first
 *                                                configured competitor.
 *   /reports/competitor/:competitor          -> per-competitor rollup.
 *
 * Sources data from `/reports/competitor` (PR G), composed via the
 * `useCompetitorGap` hook which narrows the discriminated union from
 * the api client into a flat `currentRollup` shape that the section
 * components can consume directly.
 */
/**
 * The competitor the report may load: the URL's one only once the brand
 * config lists it. An unknown one (deleted, or a bookmark from another
 * config) is redirected away, and the API refuses it with a 400.
 */
function configuredSelection(selected: string | null, configured: readonly string[]): string | null {
  return selected !== null && configured.includes(selected) ? selected : null;
}

export function CompetitorGapReport() {
  const params = useParams<{ competitor?: string }>();
  const navigate = useNavigate();
  const {
    config, loading: configLoading
  } = useBrandConfig();

  const [searchParams] = useSearchParams();
  // `?group=<id>` narrows the rollup to one keyword group (2.45.0: the API honours the scope).
  const scope = scopeFromSearch(searchParams, null);
  const { groups } = useKeywordGroups();
  const configuredCompetitors = config?.tracked_brands?.competitors ?? [];
  const selected = params.competitor
    ? decodeURIComponent(params.competitor)
    : null;

  // Auto-pick the first configured competitor when the URL has no
  // selection. Same UX as the Keyword Deep Dive report's keyword
  // auto-pick behavior.
  useEffect(() => {
    if (!selected && configuredCompetitors.length > 0) {
      navigate(
        `/reports/competitor/${encodeURIComponent(configuredCompetitors[0])}`,
        { replace: true },
      );
    }
  }, [selected, configuredCompetitors, navigate]);

  // If the URL competitor doesn't match any configured one (deleted,
  // bookmark from before a config change, etc.), redirect home rather
  // than render a confusing empty state.
  useEffect(() => {
    if (
      selected
      && configuredCompetitors.length > 0
      && !configuredCompetitors.includes(selected)
    ) {
      navigate('/reports/competitor', { replace: true });
    }
  }, [selected, configuredCompetitors, navigate]);

  const data = useCompetitorGap(configuredSelection(selected, configuredCompetitors), scope);

  usePrintMode({ ready: Boolean(selected) && data.ready });

  // While the brand config loads, the report says it is selecting a competitor, not that none is configured.
  if (!configLoading && configuredCompetitors.length === 0) {
    return (
      <ReportLayout
        title="Competitor Gap"
        subtitle="No competitors configured. Add competitors in Settings > Brand Tracking to populate this report."
      >
        <SectionPlaceholder
          variant="empty"
          message="No competitors configured. Add competitors in Settings > Brand Tracking, then re-open this report."
        />
      </ReportLayout>
    );
  }

  if (!selected || !configuredCompetitors.includes(selected)) {
    return (
      <ReportLayout
        title="Competitor Gap"
        subtitle="Loading competitor selection…"
      >
        <SectionPlaceholder variant="loading" message="Selecting competitor…" />
      </ReportLayout>
    );
  }

  return (
    <ReportLayout
      title={`Competitor Gap — ${selected}`}
      name="Competitor Gap"
      subtitle="Where this competitor outranks us, who cites them but not us, and the outreach targets ordered by visibility lift."
      actions={(
        <div className="flex flex-wrap items-center gap-3">
          <GroupScopeSelector groups={groups} value={scope} onChange={(next) => navigate(competitorPath(selected, next))} />
          <CompetitorSwitcher
            selected={selected}
            competitors={configuredCompetitors}
            onChange={(next) => {
              navigate(competitorPath(next, scope));
            }}
          />
          <ExportAllButton view="competitor-gap" params={requestParams(data.request)} />
        </div>
      )}
    >
      <HeadlineSection
        competitor={selected}
        keywordsAnalyzed={data.keywordsAnalyzed}
        {...rollupSlice(data)}
      />
      <OutrankedKeywordsSection {...rollupSlice(data)} />
      <OutreachTargetsSection {...rollupSlice(data)} />
    </ReportLayout>
  );
}

/** The report of `competitor` over `scope`: `?group=` for a keyword group, nothing for every keyword. */
function competitorPath(competitor: string, scope: ReportScope): string {
  const path = `/reports/competitor/${encodeURIComponent(competitor)}`;
  return scope.kind === 'group' ? `${path}?group=${encodeURIComponent(scope.groupId)}` : path;
}

/** The competitor picker of the Competitor Gap report, and of custom reports with its blocks. */
export function CompetitorSwitcher({
  selected,
  competitors,
  onChange,
}: {
  readonly selected: string;
  readonly competitors: ReadonlyArray<string>;
  readonly onChange: (next: string) => void;
}) {
  return (
    <div className="w-full min-w-0 sm:w-80">
      <label htmlFor="competitor-select" className={REPORT_CONTROL_LABEL_CLASS}>
        Competitor
      </label>
      <select
        id="competitor-select"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className={REPORT_CONTROL_SELECT_CLASS}
      >
        {competitors.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
