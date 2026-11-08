import {
  useMemo, type ReactNode
} from 'react';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from '../../Reports/charts/ChartFigure';
import type {
  BacklinksNewLostPoint, BacklinksTrendPoint, TrackedBacklinkDomain
} from '../../../types/api/seoBacklinks';
import {
  authoritySeries,
  buildAuthorityChartConfiguration,
  buildGrowthChartConfiguration,
  buildNewLostChartConfiguration,
  describeAuthority,
  describeGrowth,
  describeNewLost,
  lastMonths,
} from './backlinksChartConfiguration';

function ChartCard({
  title, description, children
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      {children}
    </section>
  );
}

/** "Backlink growth" and "New vs lost" over the last 12 months (domain and subdomain scopes only). */
export function BacklinksHistoryCharts({
  trends, newLost
}: {
  readonly trends: readonly BacklinksTrendPoint[];
  readonly newLost: readonly BacklinksNewLostPoint[];
}) {
  const growth = useMemo(() => lastMonths(trends), [trends]);
  const changes = useMemo(() => lastMonths(newLost), [newLost]);
  const growthChart = useThemedChart(growth, buildGrowthChartConfiguration);
  const changesChart = useThemedChart(changes, buildNewLostChartConfiguration);
  const description = 'Last 12 months · includes subdomains';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Backlink growth" description={description}>
        <ChartFigure
          canvasRef={growthChart.canvasRef}
          hasData={growthChart.hasData}
          caption={describeGrowth(growth)}
          emptyText="No history for this target yet."
          heightClassName="h-64"
        />
      </ChartCard>
      <ChartCard title="New vs lost" description={description}>
        <ChartFigure
          canvasRef={changesChart.canvasRef}
          hasData={changesChart.hasData}
          caption={describeNewLost(changes)}
          emptyText="No history for this target yet."
          heightClassName="h-64"
        />
      </ChartCard>
    </div>
  );
}

/** Rank of every tracked domain per weekly snapshot: yours against your competitors'. */
export function AuthorityChart({ domains }: { readonly domains: readonly TrackedBacklinkDomain[] }) {
  const series = useMemo(() => authoritySeries(domains), [domains]);
  const chart = useThemedChart(series, buildAuthorityChartConfiguration);
  return (
    <ChartFigure
      canvasRef={chart.canvasRef}
      hasData={chart.hasData}
      caption={describeAuthority(series)}
      emptyText="No snapshots yet. Take one now, or turn on the weekly snapshot."
    />
  );
}
