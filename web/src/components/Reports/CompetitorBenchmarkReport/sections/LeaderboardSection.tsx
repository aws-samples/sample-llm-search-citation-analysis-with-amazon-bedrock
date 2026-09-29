import type { BrandLeaderboardRow } from '../../../../types';
import { engineName } from '../../charts';
import {
  ReportTable, type ReportTableColumn
} from '../../layout/ReportTable';
import {
  BRAND_COLUMN, brandKpiColumn, brandRowKey, firstPartyRowClass, LatestRunSection, noBrandNamed, type ScopeSectionProps
} from '../../scopeReport';

export const TOP_PLACE_INFO = 'The earliest place the brand reached in any answer (1 = named first); answers without a known place are left out.';

/** The leaderboard's columns, built when the table renders rather than when the module loads. */
function leaderboardColumns(): ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> {
  return [
    BRAND_COLUMN,
    brandKpiColumn('visibility_score'),
    brandKpiColumn('mention_rate'),
    brandKpiColumn('share_of_voice'),
    brandKpiColumn('average_position'),
    {
      header: 'Best position',
      info: TOP_PLACE_INFO,
      render: (brand) => brand.best_position ?? '—',
    },
    brandKpiColumn('net_sentiment'),
    {
      header: 'Engines',
      info: 'The AI engines whose answers name the brand.',
      render: (brand) => brand.engines.map(engineName).join(', '),
    },
    {
      header: 'Keywords',
      info: 'How many keywords have an answer naming the brand.',
      render: (brand) => brand.keywords,
    },
  ];
}

/** Every brand the latest runs name, by visibility score, each measured like your brand; your rows highlighted. */
export function LeaderboardSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Leaderboard"
      subtitle="Every brand the latest runs name, by visibility score, measured with the same formulas as your brand. Your brand is highlighted."
      emptyMessage={noBrandNamed}
    >
      {(visibility) => (
        <ReportTable columns={leaderboardColumns()} rows={visibility.brands} rowKey={brandRowKey} rowClassName={firstPartyRowClass} />
      )}
    </LatestRunSection>
  );
}
