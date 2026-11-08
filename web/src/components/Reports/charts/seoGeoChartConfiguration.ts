/**
 * The SEO vs GEO scatter: each keyword with data at its organic position
 * (x, "#1" left, `>10` in the last column) and AI mention rate (y, 0–100),
 * its bubble sized by search volume. One dataset per quadrant, coloured as
 * the quadrant badges, so the legend names them.
 */
import type {
  ChartConfiguration, TooltipItem
} from 'chart.js';
import {
  SEO_GEO_QUADRANTS, SEO_TOP_POSITION, type QuadrantDefinition
} from '../../../constants/seoGeoDefinitions';
import type {
  SeoGeoQuadrant, SeoGeoRow
} from '../../../types/api/seo';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import {
  AMBER, EMERALD, INDIGO, RED, resolveColour, type ThemedColour
} from './chartPalette';
import {
  chartOptions, percentAxis
} from './chartOptions';
import { listInWords } from './chartSeries';

/** The x of a keyword whose domains are not in the organic top 10. */
const BEYOND_TOP_X = SEO_TOP_POSITION + 1;
const MIN_RADIUS = 4;
const MAX_RADIUS = 18;

export interface SeoGeoPoint {
  readonly keyword: string;
  readonly quadrant: Exclude<SeoGeoQuadrant, 'no_data'>;
  /** Organic position, `BEYOND_TOP_X` when beyond the top 10. */
  readonly x: number;
  /** AI mention rate, percent. */
  readonly y: number;
  readonly volume: number | null;
}

const QUADRANT_COLOURS: Readonly<Record<SeoGeoPoint['quadrant'], ThemedColour>> = {
  both_strong: EMERALD,
  ai_gap: AMBER,
  seo_gap: INDIGO,
  both_weak: RED,
};

/** The rows that can be plotted: a quadrant other than no data, and a mention rate. */
export function seoGeoPoints(rows: readonly SeoGeoRow[]): SeoGeoPoint[] {
  return rows.flatMap((row): SeoGeoPoint[] => {
    if (row.quadrant === 'no_data' || row.ai_mention_rate === null) return [];
    return [{
      keyword: row.keyword,
      quadrant: row.quadrant,
      x: row.organic_position ?? BEYOND_TOP_X,
      y: row.ai_mention_rate,
      volume: row.search_volume,
    }];
  });
}

/** Bubble radius: the square root of the volume against the largest, so areas compare; the smallest size without one. */
export function bubbleRadius(volume: number | null, largest: number): number {
  if (volume === null || volume <= 0 || largest <= 0) return MIN_RADIUS;
  return MIN_RADIUS + ((MAX_RADIUS - MIN_RADIUS) * Math.sqrt(volume / largest));
}

function positionTick(value: number | string): string {
  return Number(value) === BEYOND_TOP_X ? `>${SEO_TOP_POSITION}` : `#${value}`;
}

/** A bubble's tooltip line: the keyword, its position and its mention rate. */
export function pointLabel(membersByDataset: readonly (readonly SeoGeoPoint[])[]) {
  return (item: Pick<TooltipItem<'bubble'>, 'datasetIndex' | 'dataIndex'>): string => {
    const members = item.datasetIndex < membersByDataset.length ? membersByDataset[item.datasetIndex] : [];
    if (item.dataIndex >= members.length) return '';
    const point = members[item.dataIndex];
    return `${point.keyword}: ${positionTick(point.x)}, ${point.y.toFixed(1)}%`;
  };
}

type PlottedQuadrant = QuadrantDefinition & { readonly id: SeoGeoPoint['quadrant'] };

function isPlotted(quadrant: QuadrantDefinition): quadrant is PlottedQuadrant {
  return quadrant.id !== 'no_data';
}

const PLOTTED_QUADRANTS: readonly PlottedQuadrant[] = SEO_GEO_QUADRANTS.filter(isPlotted);

export function buildSeoGeoChartConfiguration(
  points: SeoGeoPoint[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'bubble'> {
  const largest = Math.max(0, ...points.map((point) => point.volume ?? 0));
  const options = chartOptions(theme, {
    x: themedAxis(theme, {
      min: 0,
      max: BEYOND_TOP_X + 1,
      ticks: {
        stepSize: 1,
        callback: positionTick,
      },
      title: {
        display: true,
        text: 'Organic position',
        color: theme.textColor,
      },
    }),
    y: percentAxis(theme, {
      title: {
        display: true,
        text: 'AI mention rate (%)',
        color: theme.textColor,
      },
    }),
  });
  const membersByDataset = PLOTTED_QUADRANTS.map((quadrant) => points.filter((point) => point.quadrant === quadrant.id));
  const datasets = PLOTTED_QUADRANTS.map((quadrant, index) => ({
    label: quadrant.label,
    data: membersByDataset[index].map((point) => ({
      x: point.x,
      y: point.y,
      r: bubbleRadius(point.volume, largest),
    })),
    backgroundColor: resolveColour(QUADRANT_COLOURS[quadrant.id], isDark),
  }));
  return {
    type: 'bubble',
    data: { datasets },
    options: {
      ...options,
      plugins: {
        ...options.plugins,
        tooltip: {
          ...options.plugins.tooltip,
          callbacks: { label: pointLabel(membersByDataset) },
        },
      },
    },
  };
}

/** "8 keywords by organic position and AI mention rate, bubble size by search volume: 3 Both strong, 2 AI gap, 1 SEO gap and 2 Both weak." */
export function describeSeoGeoChart(points: readonly SeoGeoPoint[]): string {
  if (points.length === 0) return '';
  const counts = PLOTTED_QUADRANTS.map((quadrant) => `${points.filter((point) => point.quadrant === quadrant.id).length} ${quadrant.label}`);
  return `${points.length} keywords by organic position and AI mention rate, bubble size by search volume: ${listInWords(counts)}.`;
}
