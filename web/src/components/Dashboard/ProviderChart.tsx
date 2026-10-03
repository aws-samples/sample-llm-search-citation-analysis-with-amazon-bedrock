import type { ChartConfiguration } from 'chart.js';
import type { ProviderStat } from '../../types';
import { themedTooltip } from '../ui/chartTheme';
import type { ChartTheme } from '../ui/chartTheme';
import { useThemedChart } from './useThemedChart';
import { DashboardChartCard } from './DashboardChartCard';
import { CHART_BAR_PATHS } from '../ui/iconPaths';

interface ProviderChartProps {data: ProviderStat[];}

const PROVIDER_PALETTE = [
  'rgba(200, 162, 200, 0.85)',
  'rgba(100, 149, 237, 0.85)',
  'rgba(134, 239, 172, 0.85)',
  'rgba(251, 146, 60, 0.85)',
];

const buildProviderChartConfiguration = (
  data: ProviderStat[],
  theme: ChartTheme,
): ChartConfiguration<'bar'> => ({
  type: 'bar',
  data: {
    labels: data.map((d) => d.provider),
    datasets: [
      {
        label: 'Citations',
        data: data.map((d) => d.citation_count),
        backgroundColor: PROVIDER_PALETTE,
        borderRadius: 4,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: themedTooltip(theme),
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: theme.gridColor },
        ticks: { color: theme.textColor },
      },
      x: {
        grid: { display: false },
        ticks: { color: theme.textColor },
      },
    },
  },
});

export const ProviderChart = ({ data }: ProviderChartProps) => {
  const {
    canvasRef, hasData 
  } = useThemedChart(data, buildProviderChartConfiguration);

  return (
    <DashboardChartCard
      title="Citations by Provider"
      canvasRef={canvasRef}
      hasData={hasData}
      emptyHint="Run an analysis to see provider stats"
      emptyIconPaths={CHART_BAR_PATHS}
    />
  );
};
