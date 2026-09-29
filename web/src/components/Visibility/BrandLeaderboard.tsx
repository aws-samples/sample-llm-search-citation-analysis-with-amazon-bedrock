import type {
  BrandClassification, BrandLeaderboardRow
} from '../../types';
import {
  EMPTY_KPI, formatKpi
} from '../../formatting/kpiFormatter';
import {
  ReportTable, kpiColumn, type ReportTableColumn
} from '../Reports/layout';
import { OverviewPanel } from './OverviewPanel';

const CLASSIFICATION_BADGES: Readonly<Record<BrandClassification, string>> = {
  first_party: 'bg-green-100 text-green-800',
  competitor: 'bg-red-100 text-red-800',
  other: 'bg-gray-100 text-gray-800',
};

const CLASSIFICATION_LABELS: Readonly<Record<BrandClassification, string>> = {
  first_party: 'first party',
  competitor: 'competitor',
  other: 'other',
};

const COLUMNS: ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> = [
  {
    header: 'Brand',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-medium text-gray-900',
    render: (brand) => brand.name,
  },
  kpiColumn('visibility_score', (brand) => formatKpi('visibility_score', brand.visibility_score)),
  kpiColumn('mention_rate', (brand) => formatKpi('mention_rate', brand.mention_rate)),
  kpiColumn('share_of_voice', (brand) => formatKpi('share_of_voice', brand.share_of_voice)),
  kpiColumn('average_position', (brand) => formatKpi('average_position', brand.average_position)),
  {
    header: 'Best position',
    info: 'The best place the brand reached in any answer (1 = named first).',
    render: (brand) => brand.best_position ?? EMPTY_KPI,
  },
  {
    header: 'Engines',
    info: 'The AI engines whose answers name the brand.',
    render: (brand) => (
      <div className="flex flex-wrap gap-1">
        {brand.engines.map((engine) => (
          <span key={engine} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{engine}</span>
        ))}
      </div>
    ),
  },
  {
    header: 'Keywords',
    info: 'How many keywords\' answers name the brand.',
    render: (brand) => brand.keywords,
  },
  {
    header: 'Type',
    render: (brand) => (
      <span className={`px-2 py-1 rounded text-xs ${CLASSIFICATION_BADGES[brand.classification]}`}>
        {CLASSIFICATION_LABELS[brand.classification]}
      </span>
    ),
  },
];

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
      {brands.length === 0
        ? <p className="py-6 text-center text-sm text-gray-500">No brand data available.</p>
        : <ReportTable columns={COLUMNS} rows={brands} rowKey={(brand) => brand.name} rowClassName={firstPartyHighlight} />}
    </OverviewPanel>
  );
}
