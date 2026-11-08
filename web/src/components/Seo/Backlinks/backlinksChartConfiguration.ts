/**
 * The three Backlinks charts: "Backlink growth" (backlinks on the left axis,
 * referring domains on the right), "New vs lost" (new and lost backlinks per
 * month), both over the last 12 months of the overview's history, and
 * "Authority over time" (rank of each tracked domain per weekly snapshot,
 * your domains in emerald, competitors in amber shades). Unknown values are
 * gaps, never zero.
 */
import type { ChartConfiguration } from 'chart.js';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import {
  AMBER, CLASSIFICATION_SHADES, EMERALD, INDIGO, RED, resolveColour, type ThemedColour
} from '../../Reports/charts/chartPalette';
import { chartOptions } from '../../Reports/charts/chartOptions';
import { lineChartConfiguration } from '../../Reports/charts/lineChartConfiguration';
import {
  valuesAt, type ChartSeries
} from '../../Reports/charts/chartSeries';
import type {
  BacklinksNewLostPoint, BacklinksTrendPoint, TrackedBacklinkDomain
} from '../../../types/api/seoBacklinks';

const MONTHS_SHOWN = 12;

/** The last element of `items`, or `undefined` when it is empty. */
function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

/** The last 12 points of `points` (already oldest first). */
export function lastMonths<T extends { readonly date: string }>(points: readonly T[]): T[] {
  return points.slice(-MONTHS_SHOWN);
}

function line(label: string, data: Array<number | null>, colour: string, yAxisID = 'y') {
  return {
    label,
    data,
    borderColor: colour,
    backgroundColor: colour,
    borderWidth: 2,
    pointRadius: 3,
    spanGaps: false,
    tension: 0.2,
    yAxisID,
  };
}

interface MonthlyLine<TPoint> {
  readonly label: string;
  readonly value: (point: TPoint) => number | null;
  readonly colour: ThemedColour;
  /** `y1` draws the line on the right-hand axis. */
  readonly axis?: 'y' | 'y1';
}

/** One line per `lines` entry over the months of `points` (`YYYY-MM` labels). */
function monthlyLines<TPoint extends { readonly date: string }>(
  points: readonly TPoint[], lines: ReadonlyArray<MonthlyLine<TPoint>>, isDark: boolean
): ChartConfiguration<'line'>['data'] {
  return {
    labels: points.map((point) => point.date.slice(0, 7)),
    datasets: lines.map((entry) => line(entry.label, points.map(entry.value), resolveColour(entry.colour, isDark), entry.axis)),
  };
}

export function buildGrowthChartConfiguration(
  points: BacklinksTrendPoint[], theme: ChartTheme, isDark: boolean
): ChartConfiguration<'line'> {
  const countAxis = (position: 'left' | 'right', extra: Record<string, unknown> = {}) => themedAxis(theme, {
    ...extra,
    position,
    beginAtZero: true,
  });
  return {
    type: 'line',
    data: monthlyLines(points, [
      {
        label: 'Backlinks',
        value: (point) => point.backlinks,
        colour: INDIGO,
      },
      {
        label: 'Referring domains',
        value: (point) => point.referring_domains,
        colour: EMERALD,
        axis: 'y1',
      },
    ], isDark),
    options: chartOptions(theme, {
      x: themedAxis(theme),
      y: countAxis('left'),
      y1: countAxis('right', { grid: { drawOnChartArea: false } }),
    }),
  };
}

export function buildNewLostChartConfiguration(
  points: BacklinksNewLostPoint[], theme: ChartTheme, isDark: boolean
): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: monthlyLines(points, [
      {
        label: 'New backlinks',
        value: (point) => point.new_backlinks,
        colour: EMERALD,
      },
      {
        label: 'Lost backlinks',
        value: (point) => point.lost_backlinks,
        colour: RED,
      },
    ], isDark),
    options: chartOptions(theme, {
      x: themedAxis(theme),
      y: themedAxis(theme, { beginAtZero: true }),
    }),
  };
}

/** One rank series per tracked domain with at least one snapshot; your domains are drawn thicker. */
export function authoritySeries(domains: readonly TrackedBacklinkDomain[]): ChartSeries[] {
  const shades = {
    owned: CLASSIFICATION_SHADES.first_party,
    competitor: CLASSIFICATION_SHADES.competitor 
  };
  const used = {
    owned: 0,
    competitor: 0 
  };
  return domains.filter((domain) => domain.snapshots.length > 0).map((domain) => {
    const palette = shades[domain.role];
    const colour = palette[used[domain.role] % palette.length] ?? AMBER;
    used[domain.role] += 1;
    return {
      key: domain.domain,
      label: domain.competitor === null ? domain.domain : `${domain.domain} (${domain.competitor})`,
      colour,
      emphasised: domain.role === 'owned',
      points: domain.snapshots.map((point) => ({
        label: point.snapshot_at.slice(0, 10),
        value: point.rank,
      })),
    };
  });
}

/** Ranks are 0-100, so the shared percentage-axis line chart draws them, on dates in time order. */
export function buildAuthorityChartConfiguration(
  series: ChartSeries[], theme: ChartTheme, isDark: boolean
): ChartConfiguration<'line'> {
  const configuration = lineChartConfiguration(series, theme, isDark);
  const labels = (configuration.data.labels ?? []).map(String).sort((left, right) => left.localeCompare(right));
  return {
    ...configuration,
    data: {
      ...configuration.data,
      labels,
      datasets: configuration.data.datasets.map((dataset, index) => ({
        ...dataset,
        data: valuesAt(series[index], labels),
      })),
    },
  };
}

export function describeGrowth(points: readonly BacklinksTrendPoint[]): string {
  const latest = lastOf(points);
  if (latest === undefined) return '';
  return `Backlinks and referring domains over ${points.length} months; latest ${latest.date}: `
    + `${latest.backlinks ?? 'unknown'} backlinks, ${latest.referring_domains ?? 'unknown'} referring domains.`;
}

export function describeNewLost(points: readonly BacklinksNewLostPoint[]): string {
  const latest = lastOf(points);
  if (latest === undefined) return '';
  return `New and lost backlinks over ${points.length} months; latest ${latest.date}: `
    + `${latest.new_backlinks ?? 'unknown'} new, ${latest.lost_backlinks ?? 'unknown'} lost.`;
}

export function describeAuthority(series: readonly ChartSeries[]): string {
  return series.map((entry) => {
    const latest = lastOf(entry.points);
    return `${entry.label}: rank ${latest?.value ?? 'unknown'} on ${latest?.label ?? 'no date'}`;
  }).join('; ');
}
