import { useEffect } from 'react';
import {
  useNavigate, useParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { useBrandConfig } from '../../../hooks/useBrandConfig';
import {
  ReportLayout, SectionPlaceholder 
} from '../layout';
import { useCompetitorGap } from './useCompetitorGap';
import { HeadlineSection } from './sections/HeadlineSection';
import { OutrankedKeywordsSection } from './sections/OutrankedKeywordsSection';
import { OutreachTargetsSection } from './sections/OutreachTargetsSection';

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
export function CompetitorGapReport() {
  const params = useParams<{ competitor?: string }>();
  const navigate = useNavigate();
  const { config } = useBrandConfig();

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

  const data = useCompetitorGap(selected);

  usePrintMode({ ready: Boolean(selected) && data.ready });

  if (configuredCompetitors.length === 0) {
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

  if (!selected) {
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
      subtitle="Where this competitor outranks us, who cites them but not us, and the outreach targets ordered by visibility lift."
      actions={(
        <CompetitorSwitcher
          selected={selected}
          competitors={configuredCompetitors}
          onChange={(next) => {
            navigate(`/reports/competitor/${encodeURIComponent(next)}`);
          }}
        />
      )}
    >
      <HeadlineSection
        competitor={selected}
        rollup={data.rollup}
        keywordsAnalyzed={data.keywordsAnalyzed}
        loading={data.loading}
        error={data.error}
      />
      <OutrankedKeywordsSection
        rollup={data.rollup}
        loading={data.loading}
        error={data.error}
      />
      <OutreachTargetsSection
        rollup={data.rollup}
        loading={data.loading}
        error={data.error}
      />
    </ReportLayout>
  );
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
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="competitor-select" className="text-gray-600 dark:text-gray-400">
        Competitor:
      </label>
      <select
        id="competitor-select"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
      >
        {competitors.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
