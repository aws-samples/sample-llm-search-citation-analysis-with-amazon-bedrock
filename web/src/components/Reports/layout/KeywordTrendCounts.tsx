import { TREND_DEFINITION } from '../../../constants/kpiDefinitions';
import { InfoTooltip } from '../../ui/InfoTooltip';
import { ReportStatCard } from './ReportStatCard';
import { ReportStatGrid } from './ReportStatGrid';

/** How many keywords improve, decline or hold on the visibility score (`overall` of `/trends`, `summary` of the overview). */
export interface KeywordTrendCountValues {
  readonly improving_count: number;
  readonly declining_count: number;
  readonly stable_count: number;
}

interface Props {
  readonly counts: KeywordTrendCountValues;
  /** The keywords with data, which the counts cover. */
  readonly keywordsWithData: number;
}

export const KEYWORD_TRENDS_HEADING = 'Keywords by the trend of their visibility score';

/**
 * The breadth of a scope's move: how many keywords improve, decline or hold
 * on the visibility score since each keyword's previous period, as the API
 * counts them (the 2-point trend rule).
 */
export function KeywordTrendCounts({
  counts, keywordsWithData
}: Props) {
  const footnote = `of ${keywordsWithData} keywords with data`;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {KEYWORD_TRENDS_HEADING}
        <InfoTooltip label={TREND_DEFINITION.label} text={TREND_DEFINITION.definition} />
      </h3>
      <ReportStatGrid columns={3}>
        <ReportStatCard label="Improving" value={counts.improving_count} accent="positive" footnote={footnote} />
        <ReportStatCard label="Declining" value={counts.declining_count} accent="negative" footnote={footnote} />
        <ReportStatCard label="Stable" value={counts.stable_count} footnote={footnote} />
      </ReportStatGrid>
    </div>
  );
}
