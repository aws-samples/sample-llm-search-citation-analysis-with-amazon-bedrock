import { useMemo } from 'react';
import type { SentimentSplit } from '../../../../types/domain/groupKpiHistory';
import {
  SentimentSplitChart, type SentimentRow
} from '../../charts';
import { ReportStatCard } from '../../layout/ReportStatCard';
import {
  KpiChangeCard, LatestRunHeadline, type ScopeSectionProps
} from '../../scopeReport';
import {
  sentimentCounts, sentimentShareNote
} from '../sentimentShares';

export const POSITIVE_INFO = 'Mentions of your brand that the AI answers word favourably.';

export const NEGATIVE_INFO = 'Mentions of your brand that the AI answers word unfavourably.';

export const NEUTRAL_OR_MIXED_INFO = 'Mentions worded neither way, or both ways at once; they pull the net sentiment towards 0.';

/** The label of the split bar under the cards. */
export const SPLIT_ROW_LABEL = 'All engines';

function SplitCards({ split }: { readonly split: SentimentSplit }) {
  const counts = sentimentCounts(split);
  return (
    <>
      <ReportStatCard
        label="Positive mentions"
        value={counts.positive}
        footnote={sentimentShareNote(counts.positive, counts.labelled)}
        accent="positive"
        info={POSITIVE_INFO}
      />
      <ReportStatCard
        label="Negative mentions"
        value={counts.negative}
        footnote={sentimentShareNote(counts.negative, counts.labelled)}
        accent="negative"
        info={NEGATIVE_INFO}
      />
      <ReportStatCard
        label="Neutral or mixed"
        value={counts.neutralOrMixed}
        footnote={sentimentShareNote(counts.neutralOrMixed, counts.labelled)}
        info={NEUTRAL_OR_MIXED_INFO}
      />
    </>
  );
}

/** Your net sentiment with its change, and how the mentions behind it split. */
export function SentimentHeadlineSection({ report }: ScopeSectionProps) {
  const split = report.visibility.data?.kpis.sentiment_split;
  const rows = useMemo<SentimentRow[]>(() => (split === undefined ? [] : [{
    label: SPLIT_ROW_LABEL,
    split,
  }]), [split]);

  return (
    <LatestRunHeadline
      report={report}
      cards={(visibility) => (
        <>
          <KpiChangeCard id="net_sentiment" visibility={visibility} />
          <SplitCards split={visibility.kpis.sentiment_split} />
        </>
      )}
    >
      <div className="mt-4">
        <SentimentSplitChart rows={rows} />
      </div>
    </LatestRunHeadline>
  );
}
