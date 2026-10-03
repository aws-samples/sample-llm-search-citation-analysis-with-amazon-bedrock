import { useState } from 'react';
import type { BrandLeaderboardRow } from '../../../../types';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';
import {
  BrandTrendChart, type BrandTrendMetric
} from '../../charts';
import {
  trendWindow, TrendSection, type ScopeSectionProps
} from '../../scopeReport';

/** The metrics the chart can draw, in toggle order. */
const BRAND_TREND_METRICS: readonly BrandTrendMetric[] = ['share_of_voice', 'mention_rate', 'visibility_score'];

/** The tracked brand's name in the latest leaderboard, for the chart legend. */
function trackedName(brands: readonly BrandLeaderboardRow[]): string | undefined {
  return brands.find((brand) => brand.classification === 'first_party')?.name;
}

interface MetricToggleProps {
  readonly metric: BrandTrendMetric;
  readonly onChange: (metric: BrandTrendMetric) => void;
}

/** A metric button; `aria-pressed` marks the chosen one and drives its look. */
// Stryker disable next-line StringLiteral: Tailwind-only styling; aria-pressed carries the chosen metric
const TOGGLE_CLASS = 'rounded-full border px-3 py-1 text-xs font-medium border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300 aria-pressed:border-gray-900 aria-pressed:bg-gray-900 aria-pressed:text-white dark:aria-pressed:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-gray-900';

function MetricToggle({
  metric, onChange
}: MetricToggleProps) {
  return (
    <fieldset className="print-hidden mb-3 flex flex-wrap gap-2">
      <legend className="sr-only">Metric</legend>
      {BRAND_TREND_METRICS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === metric}
          onClick={() => onChange(id)}
          className={TOGGLE_CLASS}
        >
          {KPI_DEFINITIONS[id].label}
        </button>
      ))}
    </fieldset>
  );
}

/** Your brand against its leading competitors over the period, by share of voice, mention rate or visibility score. */
export function BrandTrendSection({ report }: ScopeSectionProps) {
  const [metric, setMetric] = useState<BrandTrendMetric>('share_of_voice');

  return (
    <TrendSection
      report={report}
      title="Brands over time"
      subtitle={`${KPI_DEFINITIONS[metric].label} of your brand and its leading competitors, ${trendWindow(report)}.`}
    >
      {(trends) => (
        <>
          <MetricToggle metric={metric} onChange={setMetric} />
          <BrandTrendChart trends={trends.brand_trends} metric={metric} trackedLabel={trackedName(trends.latest_brands)} />
        </>
      )}
    </TrendSection>
  );
}
