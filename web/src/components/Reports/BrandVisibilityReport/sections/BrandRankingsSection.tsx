import type {
  BrandClassification,
  BrandVisibilityMetric,
  VisibilityMetricsResponse,
} from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';

interface Props {
  readonly visibility: VisibilityMetricsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const MAX_BRANDS = 15;

const COLUMNS: ReadonlyArray<ReportTableColumn<BrandVisibilityMetric>> = [
  {
    header: 'Brand',
    cellClassName: 'font-medium',
    render: (brand) => brand.name,
  },
  {
    header: 'Score',
    render: (brand) => brand.visibility_score.toFixed(1),
  },
  {
    header: 'Share of voice',
    render: (brand) => `${brand.share_of_voice.toFixed(1)}%`,
  },
  {
    header: 'Best rank',
    render: (brand) => brand.best_rank ?? '—',
  },
  {
    header: 'Mentions',
    render: (brand) => brand.total_mentions,
  },
  {
    header: 'Providers',
    render: (brand) => brand.provider_count,
  },
  {
    header: 'Type',
    render: (brand) => <ClassificationBadge classification={brand.classification} />,
  },
];

/**
 * Per-keyword brand rankings: every brand the AI engines mentioned for this
 * keyword, with score, share of voice, best rank, mentions, providers, and
 * classification. First-party rows are tinted to make them visually
 * distinguishable from competitor and other-third-party rows in print.
 */
export function BrandRankingsSection({
  visibility, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Brand rankings',
    loading,
    loadingMessage: 'Loading brand rankings…',
    error,
    value: visibility,
  });
  if (!gate.ready) return gate.placeholder;

  const brands = gate.value.brands.slice(0, MAX_BRANDS);
  if (brands.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Brand rankings"
        variant="empty"
        message="No brand mentions extracted for this keyword."
      />
    );
  }

  return (
    <ReportSection
      title="Brand rankings"
      subtitle="All brands the AI engines mentioned for this keyword. First-party rows are highlighted."
    >
      <ReportTable
        columns={COLUMNS}
        rows={brands}
        rowKey={(brand) => brand.name}
        rowClassName={firstPartyRowClass}
      />
    </ReportSection>
  );
}

function firstPartyRowClass(brand: BrandVisibilityMetric): string {
  return brand.classification === 'first_party' ? 'bg-emerald-50 dark:bg-emerald-950/20' : '';
}

function ClassificationBadge({ classification }: { readonly classification: BrandClassification }) {
  const styles = badgeStyles(classification);
  const label = classification === 'first_party'
    ? 'first-party'
    : classification;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}
    >
      {label}
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
