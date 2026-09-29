/**
 * The KPIs a chart can draw on its 0–100 axis: the percentages and the
 * visibility score. Counts, the average position and the net sentiment
 * (−100…+100) have other scales and are left to tables.
 */
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../constants/kpiDefinitions';
import type { BrandKpis } from '../../../types/domain/groupKpiHistory';
import { formatKpi } from '../../../formatting/kpiFormatter';
import type { ThemedColour } from './chartPalette';
import {
  listInWords, type ChartSeries
} from './chartSeries';

/** Every KPI on a 0–100 scale, in report order. */
export const CHART_KPI_IDS = [
  'mention_rate',
  'share_of_voice',
  'top_1_share',
  'top_3_share',
  'visibility_score',
  'citation_rate',
  'citation_share',
  'engine_coverage',
  'keyword_coverage',
] as const satisfies readonly KpiId[];

export type ChartKpiId = (typeof CHART_KPI_IDS)[number];

/**
 * One colour per KPI in each theme, the same on every chart. The first five
 * match the per-group KPI chart (`groupKpiChartConfiguration.ts`).
 */
export const KPI_COLOURS: Readonly<Record<ChartKpiId, ThemedColour>> = {
  mention_rate: {
    light: 'rgb(17, 24, 39)',
    dark: 'rgb(229, 231, 235)',
  },
  share_of_voice: {
    light: 'rgb(217, 119, 6)',
    dark: 'rgb(251, 191, 36)',
  },
  top_1_share: {
    light: 'rgb(5, 150, 105)',
    dark: 'rgb(52, 211, 153)',
  },
  top_3_share: {
    light: 'rgb(13, 148, 136)',
    dark: 'rgb(45, 212, 191)',
  },
  visibility_score: {
    light: 'rgb(109, 40, 217)',
    dark: 'rgb(167, 139, 250)',
  },
  citation_rate: {
    light: 'rgb(37, 99, 235)',
    dark: 'rgb(96, 165, 250)',
  },
  citation_share: {
    light: 'rgb(3, 105, 161)',
    dark: 'rgb(125, 211, 252)',
  },
  engine_coverage: {
    light: 'rgb(225, 29, 72)',
    dark: 'rgb(251, 113, 133)',
  },
  keyword_coverage: {
    light: 'rgb(192, 38, 211)',
    dark: 'rgb(232, 121, 249)',
  },
};

/** A labelled set of KPIs: a period of a trend, an AI engine. */
export interface KpiCategory {
  readonly label: string;
  readonly kpis: BrandKpis;
}

/** One series per KPI of `ids` over `categories`; none without a category. */
export function kpiSeries(categories: readonly KpiCategory[], ids: readonly ChartKpiId[]): Array<ChartSeries<ChartKpiId>> {
  if (categories.length === 0) return [];
  return ids.map((id) => ({
    key: id,
    label: KPI_DEFINITIONS[id].label,
    colour: KPI_COLOURS[id],
    points: categories.map((category) => ({
      label: category.label,
      value: category.kpis[id],
    })),
  }));
}

/** The KPI labels of `ids` in words: "Mention rate, Visibility score and Citation rate". */
export function kpiLabelsInWords(ids: readonly ChartKpiId[]): string {
  return listInWords(ids.map((id) => KPI_DEFINITIONS[id].label));
}

/**
 * Each series' value at point `index`, formatted as its KPI: "Mention rate 60.0%, Visibility score 52.4".
 * Every `kpiSeries` line has a point per category, so `index` is in range for each.
 */
export function kpiValuesInWords(series: ReadonlyArray<ChartSeries<ChartKpiId>>, index: number): string {
  return series.map((line) => `${line.label} ${formatKpi(line.key, line.points[index].value)}`).join(', ');
}
