import type { ChartConfiguration } from 'chart.js';
import type { ProviderStat } from '../../types';
import { themedTooltip } from '../ui/chartTheme';
import type { ChartTheme } from '../ui/chartTheme';
import { useThemedChart } from './useThemedChart';
import { DashboardChartCard } from './DashboardChartCard';
import { CHART_BAR_PATHS } from '../ui/iconPaths';
import {
  providerColor, providerName
} from '../../constants/providers';

interface ProviderChartProps {data: ProviderStat[];}

/** slate-400: one neutral bar colour for every web-search provider, readable on both themes. */
const SEARCH_PROVIDER_RGB = '148, 163, 184';

/** An answer engine's own hue (the one its badges use), else the web-search grey. */
function providerBarColor(provider: string): string {
  return `rgba(${providerColor(provider)?.rgb ?? SEARCH_PROVIDER_RGB}, 0.85)`;
}

/** Most cited first, so the horizontal bars read top-down like a ranking. */
function mostCitedFirst(data: readonly ProviderStat[]): ProviderStat[] {
  return [...data].sort((left, right) => right.citation_count - left.citation_count);
}

const buildProviderChartConfiguration = (
  data: ProviderStat[],
  theme: ChartTheme,
): ChartConfiguration<'bar'> => {
  const ranked = mostCitedFirst(data);
  return {
    type: 'bar',
    data: {
      labels: ranked.map((d) => providerName(d.provider)),
      datasets: [
        {
          label: 'Citations',
          data: ranked.map((d) => d.citation_count),
          backgroundColor: ranked.map((d) => providerBarColor(d.provider)),
          borderRadius: 4,
        },
      ],
    },
    options: {
      // Horizontal bars keep the full provider names readable.
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: themedTooltip(theme),
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: theme.gridColor },
          ticks: { color: theme.textColor },
        },
        y: {
          grid: { display: false },
          ticks: { color: theme.textColor },
        },
      },
    },
  };
};

export const ProviderChart = ({ data }: ProviderChartProps) => {
  const {
    canvasRef, hasData 
  } = useThemedChart(data, buildProviderChartConfiguration);

  return (
    <DashboardChartCard
      title="Citations by Provider"
      description="AI engines in colour; web-search providers, which add links but write no answer, in grey."
      canvasRef={canvasRef}
      hasData={hasData}
      emptyHint="Run an analysis to see provider stats"
      seeAll={{
        to: '/citations',
        label: 'See all citations',
      }}
      emptyIconPaths={CHART_BAR_PATHS}
    />
  );
};
