/**
 * How the page performance tab reads Lighthouse numbers: score bands, metric thresholds and units.
 *
 * Score bands are Lighthouse's own (90-100 good, 50-89 needs improvement, 0-49 poor). Metric thresholds are
 * the published "good" and "poor" limits of each metric; LCP, CLS and INP are the Core Web Vitals, TTFB,
 * FCP and TBT are lab diagnostics that explain them (a lab run has no user, so INP is often missing).
 */
import type {
  LighthouseMetrics, LighthouseScores
} from '../../../types/api/seoPerformance';

export type Rating = 'good' | 'needs-improvement' | 'poor';

export const RATING_LABELS: Record<Rating, string> = {
  good: 'Good',
  'needs-improvement': 'Needs improvement',
  poor: 'Poor',
};

export const RATING_CLASSES: Record<Rating, string> = {
  good: 'bg-gray-100 text-emerald-800',
  'needs-improvement': 'bg-gray-100 text-amber-800',
  poor: 'bg-red-100 text-red-800',
};

export const SCORE_LABELS: Record<keyof LighthouseScores, string> = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  best_practices: 'Best practices',
  seo: 'SEO',
};

export interface MetricDefinition {
  readonly key: keyof LighthouseMetrics;
  readonly label: string;
  /** Good up to and including `good`; poor above `poor`. */
  readonly good: number;
  readonly poor: number;
  readonly unit: 'ms' | 'unitless';
  readonly coreWebVital: boolean;
}

export const METRICS: readonly MetricDefinition[] = [
  {
    key: 'lcp_ms',
    label: 'Largest Contentful Paint',
    good: 2500,
    poor: 4000,
    unit: 'ms',
    coreWebVital: true
  },
  {
    key: 'cls',
    label: 'Cumulative Layout Shift',
    good: 0.1,
    poor: 0.25,
    unit: 'unitless',
    coreWebVital: true
  },
  {
    key: 'inp_ms',
    label: 'Interaction to Next Paint',
    good: 200,
    poor: 500,
    unit: 'ms',
    coreWebVital: true
  },
  {
    key: 'ttfb_ms',
    label: 'Server response time (TTFB)',
    good: 800,
    poor: 1800,
    unit: 'ms',
    coreWebVital: false
  },
  {
    key: 'fcp_ms',
    label: 'First Contentful Paint',
    good: 1800,
    poor: 3000,
    unit: 'ms',
    coreWebVital: false
  },
  {
    key: 'tbt_ms',
    label: 'Total Blocking Time',
    good: 200,
    poor: 600,
    unit: 'ms',
    coreWebVital: false
  },
];

export function scoreRating(score: number): Rating {
  if (score >= 90) return 'good';
  return score >= 50 ? 'needs-improvement' : 'poor';
}

export function metricRating(value: number, metric: MetricDefinition): Rating {
  if (value <= metric.good) return 'good';
  return value <= metric.poor ? 'needs-improvement' : 'poor';
}

/** `2.1 s` above a second, `420 ms` below; CLS with two decimals; `–` when not measured. */
export function formatMetric(value: number | null, unit: MetricDefinition['unit']): string {
  if (value === null) return '–';
  if (unit === 'unitless') return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${String(Math.round(value))} ms`;
}

/** The threshold note of a metric: `good ≤ 2.5 s · poor > 4.0 s`. */
export function thresholdNote(metric: MetricDefinition): string {
  return `good ≤ ${formatMetric(metric.good, metric.unit)} · poor > ${formatMetric(metric.poor, metric.unit)}`;
}

/** What fixing an audit saves, e.g. `saves ~350 ms · 120 KB`; empty when the report gives no estimate. */
export function savingsText(ms: number | null, bytes: number | null): string {
  const parts: string[] = [];
  if (ms !== null && ms > 0) parts.push(`~${formatMetric(ms, 'ms')}`);
  if (bytes !== null && bytes > 0) parts.push(`${String(Math.round(bytes / 1024))} KB`);
  return parts.length > 0 ? `saves ${parts.join(' · ')}` : '';
}

export function deviceLabel(device: 'mobile' | 'desktop'): string {
  return device === 'mobile' ? 'Mobile' : 'Desktop';
}

/** A piece of an audit description: plain text, or the text of a Markdown link and its target. */
export interface DescriptionPart {
  readonly text: string;
  readonly href?: string;
}

/** The first `[text](target)` at or after `from`, scanned with indexOf (linear, no regex backtracking). */
function nextLink(description: string, from: number): {
  start: number;
  end: number;
  part: DescriptionPart 
} | null {
  const start = description.indexOf('[', from);
  if (start < 0) return null;
  const middle = description.indexOf('](', start);
  const end = middle < 0 ? -1 : description.indexOf(')', middle);
  if (end < 0) return null;
  const text = description.slice(start + 1, middle);
  const href = description.slice(middle + 2, end);
  if (text === '' || text.includes('[') || href === '' || /\s/.test(href)) return nextLink(description, start + 1);
  return {
    start,
    end: end + 1,
    part: {
      text,
      href,
    },
  };
}

/** Lighthouse descriptions carry Markdown links ("[Learn more](https://…)"): split them out, in order. */
export function descriptionParts(description: string, from = 0): DescriptionPart[] {
  if (from >= description.length) return [];
  const link = nextLink(description, from);
  if (link === null) return [{ text: description.slice(from) }];
  const before = link.start > from ? [{ text: description.slice(from, link.start) }] : [];
  return [...before, link.part, ...descriptionParts(description, link.end)];
}
