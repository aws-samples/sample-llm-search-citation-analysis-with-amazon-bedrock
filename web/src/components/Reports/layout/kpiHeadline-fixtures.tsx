import { render } from '@testing-library/react';
import type { BrandKpis } from '../../../types/domain/groupKpiHistory';
import {
  buildKpis, GROUP_DELTAS, GROUP_TRENDS
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  KpiHeadline, type KpiComparison
} from './KpiHeadline';
import { ReportSection } from './ReportSection';

/**
 * Each headline card of `buildKpis()` compared through `GROUP_DELTAS` and
 * `GROUP_TRENDS`: its KPI, caption, figure, change and the colour of its trend.
 */
export const HEADLINE_CARDS = [
  ['mention_rate', 'Mention rate', '60.0%', '-10.0 pts', 'text-red-700'],
  ['share_of_voice', 'Share of voice', '25.0%', '+5.0 pts', 'text-emerald-700'],
  ['visibility_score', 'Visibility score', '52.4', '-8.2 pts', 'text-red-700'],
  ['citation_rate', 'Citation rate', '30.0%', '+1.2 pts', 'text-gray-900'],
] as const;

/** The caption of every headline card, left to right. */
export const HEADLINE_LABELS = HEADLINE_CARDS.map(([, label]) => label);

/** Every row of the KPI table of `buildKpis()` compared through `GROUP_DELTAS` and `GROUP_TRENDS`: KPI, value, change, trend. */
export const KPI_TABLE_ROWS = [
  ['Answers', '20', '0', '—'],
  ['Mentions', '12', '-2', '—'],
  ['Mention rate', '60.0%', '-10.0 pts', 'Declining'],
  ['Share of voice', '25.0%', '+5.0 pts', 'Improving'],
  ['Average position', '1.80', '+0.50', 'Declining'],
  ['Top-1 share', '40.0%', '+3.0 pts', 'Improving'],
  ['Top-3 share', '55.0%', '+1.5 pts', 'Stable'],
  ['Visibility score', '52.4', '-8.2 pts', 'Declining'],
  ['Citations', '6', '+1', '—'],
  ['Citation rate', '30.0%', '+1.2 pts', 'Stable'],
  ['Citation share', '12.5%', '-2.5 pts', 'Declining'],
  ['Net sentiment', '+15.0', '+10.0 pts', 'Improving'],
  ['Engine coverage', '75.0%', '+0.8 pts', 'Stable'],
  ['Keyword coverage', '80.0%', '-20.0 pts', 'Declining'],
];

export const COMPARISON_LABEL = 'vs previous day (3 keywords)';

/** `GROUP_DELTAS` and `GROUP_TRENDS`, labelled as a day-over-day change. */
const DAY_COMPARISON: KpiComparison = {
  deltas: GROUP_DELTAS,
  trends: GROUP_TRENDS,
  label: COMPARISON_LABEL,
};

export const NO_COMPARISON_NOTE = 'Nothing to compare with';

interface Options {
  readonly kpis?: BrandKpis;
  readonly comparison?: KpiComparison | null;
  readonly citationsConfigured?: boolean;
}

/** Mount `KpiHeadline` in a "Headline" section: `buildKpis()` compared day over day, owned domains set, unless told otherwise. */
export function renderKpiHeadline({
  kpis = buildKpis(), comparison = DAY_COMPARISON, citationsConfigured = true
}: Options = {}): void {
  render(
    <ReportSection title="Headline">
      <KpiHeadline
        kpis={kpis}
        comparison={comparison}
        noComparisonNote={NO_COMPARISON_NOTE}
        citationsConfigured={citationsConfigured}
      />
    </ReportSection>,
  );
}
