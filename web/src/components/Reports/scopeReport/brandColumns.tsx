import type {
  BrandClassification, BrandLeaderboardRow, VisibilityResponse
} from '../../../types';
import type { KpiId } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { kpiColumn } from '../layout/kpiColumn';
import type { ReportTableColumn } from '../layout/ReportTable';

/** The KPIs a leaderboard row carries for its brand. */
export type BrandRowKpi = Extract<KpiId, keyof BrandLeaderboardRow>;

const TYPE_LABELS: Readonly<Record<BrandClassification, string>> = {
  first_party: 'Your brand',
  competitor: 'Competitor',
  other: 'Other',
};

// Stryker disable next-line ObjectLiteral: the badge palette is Tailwind-only; the classification label carries the meaning
const TYPE_STYLES: Readonly<Record<BrandClassification, string>> = {
  // Stryker disable next-line StringLiteral: first-party badge colors are presentation-only
  first_party: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  // Stryker disable next-line StringLiteral: competitor badge colors are presentation-only
  competitor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  // Stryker disable next-line StringLiteral: other-brand badge colors are presentation-only
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

/** The look of the badge saying whose a brand is. */
// Stryker disable next-line BlockStatement: Tailwind-only badge styling
function badgeClassName(classification: BrandClassification): string {
  // Stryker disable next-line StringLiteral: Tailwind-only badge styling
  return `ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[classification]}`;
}

/** The brand's name, with a badge saying whose it is. */
export const BRAND_COLUMN: ReportTableColumn<BrandLeaderboardRow> = {
  header: 'Brand',
  // Stryker disable next-line StringLiteral: Tailwind-only cell styling
  cellClassName: 'font-medium whitespace-nowrap',
  render: (brand) => (
    <>
      {brand.name}
      <span className={badgeClassName(brand.classification)}>
        {TYPE_LABELS[brand.classification]}
      </span>
    </>
  ),
};

/** A column of one of the brand's KPIs, headed by the KPI with its definition. */
export function brandKpiColumn(id: BrandRowKpi): ReportTableColumn<BrandLeaderboardRow> {
  return kpiColumn<BrandLeaderboardRow>(id, (brand) => formatKpi(id, brand[id]));
}

/** Tints your own brands' rows, so they stand out on screen and on paper. */
export function firstPartyRowClass(brand: BrandLeaderboardRow): string {
  return brand.classification === 'first_party' ? 'bg-emerald-50 dark:bg-emerald-950/20' : '';
}

/** The key of a leaderboard row. */
// Stryker disable next-line BlockStatement: React row key only; the rendered rows are identical
export function brandRowKey(brand: BrandLeaderboardRow): string {
  return brand.name;
}

/** What a brand table says while the answers name no brand; `null` once they name one. */
export function noBrandNamed({ brands }: VisibilityResponse): string | null {
  return brands.length === 0 ? 'The answers name no brand yet.' : null;
}
