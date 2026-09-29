import type {
  BrandClassification,
  BrandLeaderboardRow,
  BrandTrends,
} from '../../../../types';
import type { KpiId } from '../../../../constants/kpiDefinitions';
import { formatKpi } from '../../../../formatting/kpiFormatter';
import {
  kpiColumn,
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';
import {
  ShareOfVoicePanel, ShareOfVoiceTrendPanel
} from './ReportChartPanels';

interface Props {
  /** The leaderboard, best visibility score first; `null` until it is loaded. */
  readonly brands: readonly BrandLeaderboardRow[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** What the leaderboard covers, under the title. */
  readonly subtitle?: string;
  /** What to say when no answer named a brand. */
  readonly emptyMessage?: string;
  /** The share of voice per brand over time, charted next to the donut when given. */
  readonly brandTrends?: BrandTrends;
}

/** The subtitle of the leaderboard of one keyword's latest run. */
export const KEYWORD_RANKINGS_SUBTITLE = 'Every brand the AI answers named for this keyword in its latest run, by visibility score. '
  + 'First-party rows are highlighted.';
export const KEYWORD_RANKINGS_EMPTY = 'No brand mentions extracted for this keyword.';

/** The most brands a printed leaderboard lists; the API sorts them by visibility score. */
export const MAX_BRANDS = 15;

/** The KPIs of each brand, in column order. */
const BRAND_KPIS = ['visibility_score', 'mention_rate', 'share_of_voice', 'average_position'] as const satisfies readonly KpiId[];

export const BEST_POSITION_INFO = 'The best place the brand reached in any answer (1 = named first). '
  + 'Answers where its place is unknown are left out.';

const COLUMNS: ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> = [
  {
    header: 'Brand',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-medium',
    render: (brand) => brand.name,
  },
  ...BRAND_KPIS.map((id) => kpiColumn<BrandLeaderboardRow>(id, (brand) => formatKpi(id, brand[id]))),
  {
    header: 'Best position',
    info: BEST_POSITION_INFO,
    render: (brand) => brand.best_position ?? '—',
  },
  {
    header: 'Engines',
    info: 'The AI engines whose answers name the brand.',
    render: (brand) => brand.engines.join(', '),
  },
  {
    header: 'Keywords',
    info: 'How many keywords\' answers name the brand.',
    render: (brand) => brand.keywords,
  },
  {
    header: 'Type',
    render: (brand) => <ClassificationBadge classification={brand.classification} />,
  },
];

/**
 * Brand leaderboard: every brand the AI answers named in the scope, each
 * measured with the same formulas as the tracked brand
 * (`docs/kpi-definitions.md`, per-brand leaderboards), under a share-of-voice
 * donut (and, when given, the share of voice per brand over time).
 * First-party rows are tinted so they stand out from competitors and other
 * brands in print.
 */
export function BrandRankingsSection({
  brands, loading, error, subtitle = KEYWORD_RANKINGS_SUBTITLE, emptyMessage = KEYWORD_RANKINGS_EMPTY, brandTrends
}: Props) {
  const gate = gateSection({
    title: 'Brand rankings',
    loading,
    loadingMessage: 'Loading brand rankings…',
    error,
    value: brands,
  });
  if (!gate.ready) return gate.placeholder;

  if (gate.value.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Brand rankings"
        variant="empty"
        message={emptyMessage}
      />
    );
  }

  // Stryker disable next-line StringLiteral: Tailwind-only layout; the same charts render either way
  const chartsClass = brandTrends ? 'mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2' : 'mb-4';
  return (
    <ReportSection title="Brand rankings" subtitle={subtitle}>
      <div className={chartsClass}>
        <ShareOfVoicePanel brands={gate.value} />
        {brandTrends && <ShareOfVoiceTrendPanel trends={brandTrends} />}
      </div>
      <ReportTable
        columns={COLUMNS}
        rows={gate.value.slice(0, MAX_BRANDS)}
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        rowKey={(brand) => brand.name}
        rowClassName={firstPartyRowClass}
      />
    </ReportSection>
  );
}

function firstPartyRowClass(brand: BrandLeaderboardRow): string {
  return brand.classification === 'first_party' ? 'bg-emerald-50 dark:bg-emerald-950/20' : '';
}

const CLASSIFICATION_LABELS: Record<BrandClassification, string> = {
  first_party: 'first-party',
  competitor: 'competitor',
  other: 'other',
};

function ClassificationBadge({ classification }: { readonly classification: BrandClassification }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badgeStyles(classification)}`}
    >
      {CLASSIFICATION_LABELS[classification]}
    </span>
  );
}

function badgeStyles(c: BrandClassification): string {
  if (c === 'first_party') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  }
  if (c === 'competitor') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}
