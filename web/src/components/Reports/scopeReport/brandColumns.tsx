import type {
  BrandClassification, BrandLeaderboardRow, VisibilityResponse
} from '../../../types';
import { BRAND_TYPE_BADGE } from '../../../constants/brandTypeBadge';
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


/** The look of the badge saying whose a brand is. */
// Stryker disable next-line BlockStatement: Tailwind-only badge styling
function badgeClassName(classification: BrandClassification): string {
  // Stryker disable next-line StringLiteral: Tailwind-only badge styling
  return `ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BRAND_TYPE_BADGE[classification]}`;
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
  return brand.classification === 'first_party' ? 'bg-violet-50 dark:bg-violet-950/20' : '';
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
