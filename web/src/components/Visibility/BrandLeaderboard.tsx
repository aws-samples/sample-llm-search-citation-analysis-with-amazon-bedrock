import type { BrandLeaderboardRow } from '../../types';
import { EMPTY_KPI } from '../../formatting/kpiFormatter';
import {
  ReportTable, type ReportTableColumn
} from '../Reports/layout';
import {
  BRAND_CLASSIFICATION_LABELS, brandKpiColumns, brandReachColumns
} from '../Reports/layout/brandColumns';
import {
  providerColor, providerName
} from '../../constants/providers';
import { BRAND_TYPE_BADGE } from '../../constants/brandTypeBadge';
import { OverviewPanel } from './OverviewPanel';
import { RowLimitToggle } from './RowLimitToggle';
import {
  VISIBILITY_ROW_LIMIT, useRowLimit
} from './useRowLimit';


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
          // Each engine in its own hue, the one its badges use across the dashboard.
          <span key={engine} className={`px-2 py-0.5 rounded text-xs ${providerColor(engine)?.badge ?? 'bg-gray-100 text-gray-800'}`}>{providerName(engine)}</span>
        ))}
      </div>
    )),
    {
      header: 'Type',
      render: (brand) => (
        // Stryker disable next-line StringLiteral: Tailwind-only badge styling; the label below names the classification
        <span className={`px-2 py-1 rounded text-xs ${BRAND_TYPE_BADGE[brand.classification]}`}>
          {BRAND_CLASSIFICATION_LABELS[brand.classification]}
        </span>
      ),
    },
  ];
}

function firstPartyHighlight(brand: BrandLeaderboardRow): string {
  return brand.classification === 'first_party' ? 'bg-violet-50' : '';
}

/**
 * Every brand the scope's answers name, with the tracked-brand formulas
 * applied to each alone, best visibility score first. First-party rows are
 * highlighted; the top rows show until the reader opens the full list.
 */
export function BrandLeaderboard({ brands }: { readonly brands: readonly BrandLeaderboardRow[] }) {
  const rowLimit = useRowLimit(brands);
  return (
    <OverviewPanel title="Brand leaderboard">
      {brands.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No brand data available.</p>
      ) : (
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        <ReportTable columns={leaderboardColumns()} rows={rowLimit.visible} rowKey={(brand) => brand.name} rowClassName={firstPartyHighlight} />
      )}
      {rowLimit.limited && (
        <RowLimitToggle total={brands.length} limit={VISIBILITY_ROW_LIMIT} showAll={rowLimit.showAll} noun="brands" onToggle={rowLimit.toggle} />
      )}
    </OverviewPanel>
  );
}
