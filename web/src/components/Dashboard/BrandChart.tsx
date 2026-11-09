import type { ChartConfiguration } from 'chart.js';
import type { BrandStat } from '../../types';
import { themedTooltip } from '../ui/chartTheme';
import type { ChartTheme } from '../ui/chartTheme';
import { useThemedChart } from './useThemedChart';
import { DashboardChartCard } from './DashboardChartCard';

interface BrandChartProps {data: BrandStat[];}

/** One distinct hue per named brand (cycled past eight), the same in both themes. */
const BRAND_PALETTE = [
  'rgba(139, 92, 246, 0.9)',
  'rgba(245, 158, 11, 0.9)',
  'rgba(16, 185, 129, 0.9)',
  'rgba(14, 165, 233, 0.9)',
  'rgba(244, 63, 94, 0.9)',
  'rgba(217, 70, 239, 0.9)',
  'rgba(20, 184, 166, 0.9)',
  'rgba(234, 88, 12, 0.9)',
];

/** The bucket of cited links whose URL names no tracked brand (`detect_brand_in_url`). */
const OTHER_BRAND = 'Other';

/** "Other" stays neutral so the named brands stand out: gray-200 on light, gray-600 on dark. */
const otherColor = (isDark: boolean): string => (isDark ? 'rgba(75, 85, 99, 0.9)' : 'rgba(229, 231, 235, 0.9)');

/** Named brands, most cited first, then "Other". */
function namedBrandsFirst(data: readonly BrandStat[]): BrandStat[] {
  const named = data.filter((d) => d.brand !== OTHER_BRAND).sort((left, right) => right.mention_count - left.mention_count);
  return [...named, ...data.filter((d) => d.brand === OTHER_BRAND)];
}

/** Named brands take the palette in order ("Other" is last, so the index is the named brand's rank). */
function brandColors(ordered: readonly BrandStat[], isDark: boolean): string[] {
  return ordered.map((d, index) => (
    d.brand === OTHER_BRAND ? otherColor(isDark) : BRAND_PALETTE[index % BRAND_PALETTE.length] ?? otherColor(isDark)
  ));
}

const BRAND_MENTIONS_EMPTY_ICON_PATHS = [
  'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z',
  'M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z',
];

const buildBrandChartConfiguration = (
  data: BrandStat[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'doughnut'> => {
  const ordered = namedBrandsFirst(data);
  return {
    type: 'doughnut',
    data: {
      labels: ordered.map((d) => d.brand),
      datasets: [
        {
          data: ordered.map((d) => d.mention_count),
          backgroundColor: brandColors(ordered, isDark),
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
  };
};

export const BrandChart = ({ data }: BrandChartProps) => {
  const {
    canvasRef, hasData 
  } = useThemedChart(data, buildBrandChartConfiguration);

  return (
    <DashboardChartCard
      title="Citations by Brand"
      description="Cited links whose URL names a tracked brand. Other: links that name none."
      canvasRef={canvasRef}
      hasData={hasData}
      emptyHint="Run an analysis to see brand stats"
      seeAll={{
        to: '/brands',
        label: 'See all brands',
      }}
      emptyIconPaths={BRAND_MENTIONS_EMPTY_ICON_PATHS}
    />
  );
};
