import type { BrandLeaderboardRow } from '../../../../types';
import {
  ReportTable, type ReportTableColumn
} from '../../layout/ReportTable';
import {
  BRAND_COLUMN, brandKpiColumn, brandRowKey, firstPartyRowClass, LatestRunSection, noBrandNamed, type ScopeSectionProps
} from '../../scopeReport';

/**
 * The brand and the KPIs its sentiment is read with. Built at render, not at
 * import, so a column that cannot be built fails the section it heads.
 */
function sentimentColumns(): ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>> {
  return [
    BRAND_COLUMN,
    brandKpiColumn('net_sentiment'),
    brandKpiColumn('mentions'),
    brandKpiColumn('mention_rate'),
  ];
}

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
          columns={sentimentColumns()}
          rowClassName={firstPartyRowClass}
          rowKey={brandRowKey}
        />
      )}
    </LatestRunSection>
  );
}
