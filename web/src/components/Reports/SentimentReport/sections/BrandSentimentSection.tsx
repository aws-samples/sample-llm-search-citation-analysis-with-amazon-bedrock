import type { BrandLeaderboardRow } from '../../../../types';
import {
  ReportTable, type ReportTableColumn
} from '../../layout/ReportTable';
import {
  BRAND_COLUMN, brandKpiColumn, brandRowKey, firstPartyRowClass, LatestRunSection, noBrandNamed, type ScopeSectionProps
} from '../../scopeReport';

const SENTIMENT_COLUMNS: ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> = [
  BRAND_COLUMN,
  brandKpiColumn('net_sentiment'),
  brandKpiColumn('mentions'),
  brandKpiColumn('mention_rate'),
];

/** How the answers word each brand they name, in leaderboard order; your brand highlighted. */
export function BrandSentimentSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Net sentiment per brand"
      subtitle="Each brand's net sentiment over the latest runs, measured like yours, brands by visibility score. Your brand is highlighted."
      emptyMessage={noBrandNamed}
    >
      {({ brands }) => (
        <ReportTable
          rows={brands}
          columns={SENTIMENT_COLUMNS}
          rowClassName={firstPartyRowClass}
          rowKey={brandRowKey}
        />
      )}
    </LatestRunSection>
  );
}
