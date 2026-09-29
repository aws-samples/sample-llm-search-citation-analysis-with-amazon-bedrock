/**
 * The series model the multi-series charts draw: one dataset per series,
 * one category (x label, or y label for horizontal bars) per point label.
 */
import type { ThemedColour } from './chartPalette';

export interface SeriesPoint {
  readonly label: string;
  /** `null` is drawn as a gap. */
  readonly value: number | null;
}

export interface ChartSeries<TKey extends string = string> {
  /** What the series measures: a KPI id, a brand, a sentiment. */
  readonly key: TKey;
  /** The legend label. */
  readonly label: string;
  readonly colour: ThemedColour;
  /** Drawn thicker than the others (the tracked brand). */
  readonly emphasised?: boolean;
  readonly points: readonly SeriesPoint[];
}

/** Every point label of `series`, in order of first appearance. */
export function seriesLabels(series: readonly ChartSeries[]): string[] {
  return [...new Set(series.flatMap((line) => line.points.map((point) => point.label)))];
}

/** The value of `line` at every label, `null` where it has no point. */
export function valuesAt(line: ChartSeries, labels: readonly string[]): Array<number | null> {
  const byLabel = new Map(line.points.map((point) => [point.label, point.value]));
  return labels.map((label) => byLabel.get(label) ?? null);
}

/** "A", "A and B", "A, B and C". */
export function listInWords(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "2 periods from 2026-09-01 to 2026-09-08", or "1 period (2026-09-08)". */
export function periodsInWords(labels: readonly string[]): string {
  if (labels.length === 1) return `1 period (${labels[0]})`;
  return `${labels.length} periods from ${labels[0]} to ${labels[labels.length - 1]}`;
}
