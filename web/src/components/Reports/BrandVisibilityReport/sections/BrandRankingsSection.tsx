import type {
  BrandClassification,
  BrandLeaderboardRow,
  BrandTrends,
} from '../../../../types';
import {
  emphasisColumn,
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  type SectionFetchState,
  type TrendSectionProps,
  type VisibilitySectionProps,
  gateSection,
} from '../../layout';
import {
  BRAND_CLASSIFICATION_LABELS, brandKpiColumns, brandReachColumns
} from '../../layout/brandColumns';
import {
  ShareOfVoicePanel, ShareOfVoiceTrendPanel
} from './ReportChartPanels';

interface Props extends SectionFetchState {
  /** The leaderboard, best visibility score first; `null` until it is loaded. */
  readonly brands: readonly BrandLeaderboardRow[] | null;
  /** What the leaderboard covers, under the title. */
  readonly subtitle?: string;
  /** What to say when no answer named a brand. */
  readonly emptyMessage?: string;
  /** The share of voice per brand over time, charted next to the donut when given. */
  readonly brandTrends?: BrandTrends;
}

/** The subtitle of the leaderboard of one keyword's latest run. */
const KEYWORD_RANKINGS_SUBTITLE = 'Every brand the AI answers named for this keyword in its latest run, by visibility score. '
  + 'First-party rows are highlighted.';
const KEYWORD_RANKINGS_EMPTY = 'No brand mentions extracted for this keyword.';

/** The most brands a printed leaderboard lists; the API sorts them by visibility score. */
export const MAX_BRANDS = 15;

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function rankingColumns(): ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> {
  return [
    emphasisColumn('Brand', (brand) => brand.name),
    ...brandKpiColumns(),
    {
      header: 'Best position',
      info: 'The best place the brand reached in any answer (1 = named first). '
        + 'Answers where its place is unknown are left out.',
      render: (brand) => brand.best_position ?? '—',
    },
    ...brandReachColumns((brand) => brand.engines.join(', ')),
    {
      header: 'Type',
      render: (brand) => <ClassificationBadge classification={brand.classification} />,
    },
  ];
}

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
        columns={rankingColumns()}
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

/** The leaderboard of one keyword's latest run (`/visibility`). */
export function LatestRunRankingsSection({
  visibility, loading, error
}: VisibilitySectionProps) {
  return <BrandRankingsSection brands={visibility?.brands ?? null} loading={loading} error={error} />;
}

/** What the all-keywords leaderboard covers: the latest period of every keyword. */
const ALL_KEYWORDS_RANKINGS_SUBTITLE = 'Every brand the AI answers named in each keyword\'s latest period (the leading 10), '
  + 'by visibility score, and the share of voice of your brand and its leading competitors over time. First-party rows are highlighted.';

/** The leaderboard pooled over each keyword's latest period (`/trends`), with the share of voice over time. */
export function PooledRankingsSection({
  trends, loading, error
}: TrendSectionProps) {
  return (
    <BrandRankingsSection
      brands={trends?.latest_brands ?? null}
      brandTrends={trends?.brand_trends}
      loading={loading}
      error={error}
      subtitle={ALL_KEYWORDS_RANKINGS_SUBTITLE}
      emptyMessage="No brand mentions extracted in the latest periods."
    />
  );
}

function ClassificationBadge({ classification }: { readonly classification: BrandClassification }) {
  return (
    <span
      // Stryker disable next-line StringLiteral: Tailwind-only badge styling; the text below names the classification
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badgeStyles(classification)}`}
    >
      {BRAND_CLASSIFICATION_LABELS[classification]}
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
