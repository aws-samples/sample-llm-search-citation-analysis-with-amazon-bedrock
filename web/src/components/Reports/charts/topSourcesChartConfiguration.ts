import type {
  ChartConfiguration, TooltipItem
} from 'chart.js';
import type { SourceRow } from '../../../types/domain/visibility';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import {
  EMERALD, INDIGO, resolveColour
} from './chartPalette';
import { chartOptions } from './chartOptions';
import { listInWords } from './chartSeries';

/** How many domains the chart ranks unless told otherwise. */
export const DEFAULT_TOP_SOURCES_LIMIT = 10;

const OWNED_DOMAINS_LABEL = 'Your domains';
const OTHER_DOMAINS_LABEL = 'Other domains';

/** The `limit` most cited domains, most cited first (ties in the given order). */
export function topSources(sources: readonly SourceRow[], limit: number): SourceRow[] {
  return [...sources].sort((left, right) => right.citations - left.citations).slice(0, Math.max(0, limit));
}

/** A bar's tooltip lines under its citation count: the domain's citation rate and citation share. */
export function sourceTooltipLines(bars: readonly SourceRow[]) {
  return (item: Pick<TooltipItem<'bar'>, 'dataIndex'>): string[] => {
    const source = bars[item.dataIndex];
    return [
      `${KPI_DEFINITIONS.citation_rate.label}: ${formatKpi('citation_rate', source.citation_rate)}`,
      `${KPI_DEFINITIONS.citation_share.label}: ${formatKpi('citation_share', source.citation_share)}`,
    ];
  };
}

/**
 * A horizontal bar of citations per domain. Owned and other domains are two
 * stacked datasets (each domain has a value in one of them only), so the
 * legend names the emerald and the indigo bars.
 */
export function buildTopSourcesChartConfiguration(
  bars: readonly SourceRow[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'bar'> {
  const citationsWhere = (owned: boolean) => bars.map((source) => (source.owned === owned ? source.citations : null));
  const options = chartOptions(theme, {
    x: themedAxis(theme, {
      stacked: true,
      beginAtZero: true,
      ticks: { precision: 0 },
    }),
    y: themedAxis(theme, { stacked: true }),
  });
  return {
    type: 'bar',
    data: {
      labels: bars.map((source) => source.domain),
      datasets: [
        {
          label: OWNED_DOMAINS_LABEL,
          data: citationsWhere(true),
          backgroundColor: resolveColour(EMERALD, isDark),
        },
        {
          label: OTHER_DOMAINS_LABEL,
          data: citationsWhere(false),
          backgroundColor: resolveColour(INDIGO, isDark),
        },
      ],
    },
    options: {
      ...options,
      indexAxis: 'y',
      plugins: {
        ...options.plugins,
        tooltip: {
          ...options.plugins.tooltip,
          callbacks: { afterLabel: sourceTooltipLines(bars) },
        },
      },
    },
  };
}

/** "Answers citing each of the 3 most cited domains: runnersworld.com 9, nike.com 6 (yours) and reddit.com 5." */
export function describeTopSources(bars: readonly SourceRow[]): string {
  if (bars.length === 0) return '';
  const domains = bars.map((source) => `${source.domain} ${source.citations}${source.owned ? ' (yours)' : ''}`);
  return `Answers citing each of the ${bars.length} most cited domains: ${listInWords(domains)}.`;
}
