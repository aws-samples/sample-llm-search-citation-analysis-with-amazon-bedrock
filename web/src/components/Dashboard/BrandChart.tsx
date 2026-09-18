import type { ChartConfiguration } from 'chart.js';
import type { BrandStat } from '../../types';
import { themedTooltip } from '../ui/chartTheme';
import type { ChartTheme } from '../ui/chartTheme';
import { useThemedChart } from './useThemedChart';
import { DashboardChartCard } from './DashboardChartCard';

interface BrandChartProps {data: BrandStat[];}

const BRAND_PALETTE_LIGHT = [
  'rgba(17, 24, 39, 0.9)',
  'rgba(55, 65, 81, 0.9)',
  'rgba(251, 191, 36, 0.85)',
  'rgba(167, 139, 250, 0.85)',
  'rgba(156, 163, 175, 0.9)',
];

const BRAND_PALETTE_DARK = [
  'rgba(229, 231, 235, 0.9)',
  'rgba(156, 163, 175, 0.9)',
  'rgba(251, 191, 36, 0.85)',
  'rgba(167, 139, 250, 0.85)',
  'rgba(107, 114, 128, 0.9)',
];

const BRAND_MENTIONS_EMPTY_ICON_PATHS = [
  'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z',
  'M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z',
];

const buildBrandChartConfiguration = (
  data: BrandStat[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'doughnut'> => ({
  type: 'doughnut',
  data: {
    labels: data.map((d) => d.brand),
    datasets: [
      {
        data: data.map((d) => d.mention_count),
        backgroundColor: isDark ? BRAND_PALETTE_DARK : BRAND_PALETTE_LIGHT,
        borderWidth: 0,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 12,
          padding: 16,
          font: { size: 11 },
          color: theme.textColor,
        },
      },
      tooltip: themedTooltip(theme),
    },
  },
});

export const BrandChart = ({ data }: BrandChartProps) => {
  const {
    canvasRef, hasData 
  } = useThemedChart(data, buildBrandChartConfiguration);

  return (
    <DashboardChartCard
      title="Brand Mentions"
      canvasRef={canvasRef}
      hasData={hasData}
      emptyHint="Run an analysis to see brand stats"
      emptyIconPaths={BRAND_MENTIONS_EMPTY_ICON_PATHS}
    />
  );
};
