import type {
  BrandClassification, BrandLeaderboardRow
} from '../../types';
import { EMPTY_KPI } from '../../formatting/kpiFormatter';
import {
  ReportTable, type ReportTableColumn
} from '../Reports/layout';
import {
  BRAND_CLASSIFICATION_LABELS, brandKpiColumns, brandReachColumns
} from '../Reports/layout/brandColumns';
import { OverviewPanel } from './OverviewPanel';

// Stryker disable next-line ObjectLiteral: the badge palette is Tailwind-only; the classification label carries the meaning
const CLASSIFICATION_BADGES: Readonly<Record<BrandClassification, string>> = {
  // Stryker disable next-line StringLiteral: first-party badge colors are presentation-only
  first_party: 'bg-green-100 text-green-800',
  // Stryker disable next-line StringLiteral: competitor badge colors are presentation-only
  competitor: 'bg-red-100 text-red-800',
  // Stryker disable next-line StringLiteral: other-brand badge colors are presentation-only
  other: 'bg-gray-100 text-gray-800',
};

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function leaderboardColumns(): ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> {
  return [
    {
      header: 'Brand',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-medium text-gray-900',
      render: (brand) => brand.name,
    },
    ...brandKpiColumns(),
    {
      header: 'Best position',
      info: 'The best place the brand reached in any answer (1 = named first).',
      render: (brand) => brand.best_position ?? EMPTY_KPI,
    },
    ...brandReachColumns((brand) => (
      <div className="flex flex-wrap gap-1">
        {brand.engines.map((engine) => (
          <span key={engine} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{engine}</span>
        ))}
      </div>
    )),
    {
      header: 'Type',
      render: (brand) => (
        // Stryker disable next-line StringLiteral: Tailwind-only badge styling; the label below names the classification
        <span className={`px-2 py-1 rounded text-xs ${CLASSIFICATION_BADGES[brand.classification]}`}>
          {BRAND_CLASSIFICATION_LABELS[brand.classification]}
        </span>
      ),
    },
  ];
}

function firstPartyHighlight(brand: BrandLeaderboardRow): string {
  return brand.classification === 'first_party' ? 'bg-green-50' : '';
}

/**
 * Every brand the scope's answers name, with the tracked-brand formulas
 * applied to each alone, best visibility score first. First-party rows are
 * highlighted.
 */
export function BrandLeaderboard({ brands }: { readonly brands: readonly BrandLeaderboardRow[] }) {
  return (
    <OverviewPanel title="Brand leaderboard">
      {brands.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No brand data available.</p>
      ) : (
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        <ReportTable columns={leaderboardColumns()} rows={brands} rowKey={(brand) => brand.name} rowClassName={firstPartyHighlight} />
      )}
    </OverviewPanel>
  );
}
