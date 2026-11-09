/**
 * Cell contents shared by the data tables (`DataTable`): chips, Google
 * position badges, 0-100 score chips, compact numbers with the exact figure
 * in a tooltip, and truncated external links that only open http(s) URLs.
 */
import type { ReactNode } from 'react';
import { safeHref } from '../../infrastructure';
import type { DataColumn } from './DataTable';
import {
  UNKNOWN_VALUE, compactText, compactUsdText, integerText, usdText
} from './numberFormat';

export type ChipTone = 'neutral' | 'green' | 'blue' | 'indigo' | 'purple' | 'amber' | 'red';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  green: 'bg-gray-50 text-emerald-700 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  indigo: 'bg-gray-50 text-blue-700 border-gray-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  amber: 'bg-gray-50 text-amber-700 border-gray-200',
  red: 'bg-red-50 text-red-700 border-red-200',
};

/** A small rounded label: a flag, a status or a tier. */
export function Chip({
  tone = 'neutral', title, children
}: {
  readonly tone?: ChipTone;
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}

function Unknown({ title }: { readonly title?: string }) {
  return <span className="text-gray-500" title={title}>{UNKNOWN_VALUE}</span>;
}

/** The tones a Google position takes. */
export type PositionTone = Extract<ChipTone, 'green' | 'blue' | 'amber' | 'neutral'>;

/** The tone of a Google position: top 3 green, first page blue, second page amber, deeper neutral. */
export function positionTone(position: number): PositionTone {
  if (position <= 3) return 'green';
  if (position <= 10) return 'blue';
  if (position <= 20) return 'amber';
  return 'neutral';
}

/** A Google position as a badge (`3`); a dash when unknown. */
export function PositionBadge({
  position, title
}: {
  readonly position: number | null;
  readonly title?: string;
}) {
  if (position === null) return <Unknown title={title} />;
  return (
    <span title={title ?? `Position ${position}`}
      className={`inline-flex min-w-[2rem] justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${CHIP_TONES[positionTone(position)]}`}>
      {position}
    </span>
  );
}

/** The tone of a 0-100 difficulty-like score: under 30 green, under 70 amber, else red. */
export function scoreTone(score: number): ChipTone {
  if (score < 30) return 'green';
  if (score < 70) return 'amber';
  return 'red';
}

/** A 0-100 score (keyword difficulty, spam risk) as a toned chip; a dash when unknown. */
export function ScoreChip({
  value, label
}: {
  readonly value: number | null;
  /** Names the score in the tooltip: "Keyword difficulty". */
  readonly label: string;
}) {
  if (value === null) return <Unknown title={`${label} unknown`} />;
  const rounded = Math.round(value);
  return <Chip tone={scoreTone(rounded)} title={`${label}: ${rounded} / 100`}><span className="tabular-nums">{rounded}</span></Chip>;
}

/** A count, compact from 10,000 (`1.2M`) with the exact figure as its tooltip. */
export function CompactNumber({
  value, currency = false
}: {
  readonly value: number | null | undefined;
  readonly currency?: boolean;
}) {
  const shown = currency ? compactUsdText(value) : compactText(value);
  const exact = currency ? usdText(value) : integerText(value);
  if (shown === UNKNOWN_VALUE) return <Unknown />;
  return <span title={shown === exact ? undefined : exact}>{shown}</span>;
}

/**
 * An external link cut to one line (the full URL is its tooltip). A URL that
 * is not http(s) is shown as text, never as a link.
 */
export function UrlCell({
  url, text, className = 'max-w-[14rem] xl:max-w-xs'
}: {
  readonly url: string | null;
  /** What the cell reads (a path, a host); the URL itself by default. */
  readonly text?: string | null;
  /** Width cap of the truncated text. */
  readonly className?: string;
}) {
  if (url === null) return <Unknown />;
  const label = text ?? url;
  const href = safeHref(url);
  const classes = `block truncate ${className}`;
  if (href === undefined) return <span className={`${classes} text-gray-700`} title={url}>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={url}
      className={`${classes} text-gray-900 hover:underline`}>
      {label}
    </a>
  );
}

/** A "Page" column: each row's URL as a wide one-line link, its text read by `text` (a path). */
export function pageColumn<TRow, TKey extends string = string>(
  url: (row: TRow) => string | null, text: (row: TRow) => string | null,
): DataColumn<TRow, TKey> {
  return {
    id: 'page',
    header: 'Page',
    render: (row) => <UrlCell url={url(row)} text={text(row)} className="max-w-[18rem] sm:max-w-md" />,
  };
}
