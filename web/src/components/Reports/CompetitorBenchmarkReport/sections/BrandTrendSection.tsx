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
export const BRAND_TREND_METRICS: readonly BrandTrendMetric[] = ['share_of_voice', 'mention_rate', 'visibility_score'];

/** The tracked brand's name in the latest leaderboard, for the chart legend. */
function trackedName(brands: readonly BrandLeaderboardRow[]): string | undefined {
  return brands.find((brand) => brand.classification === 'first_party')?.name;
}

interface MetricToggleProps {
  readonly metric: BrandTrendMetric;
  readonly onChange: (metric: BrandTrendMetric) => void;
}

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
          className={`rounded-full border px-3 py-1 text-xs font-medium ${id === metric
            ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
            : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
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
