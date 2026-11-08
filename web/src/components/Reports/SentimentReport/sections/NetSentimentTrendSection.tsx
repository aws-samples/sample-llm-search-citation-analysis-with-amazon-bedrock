import {
  SectionExport, trendWindow, TrendSection, type ScopeSectionProps
} from '../../scopeReport';
import { TrendPeriodTable } from '../../layout/TrendPeriodTable';
import { NetSentimentTrendChart } from '../NetSentimentTrendChart';

/** The period table's KPIs: the answers, then how they word your brand. */
const NET_SENTIMENT_PERIOD_KPIS = ['answers', 'mentions', 'net_sentiment'] as const;

/** Your net sentiment in each period of the chosen window. */
export function NetSentimentTrendSection({ report }: ScopeSectionProps) {
  return (
    <TrendSection
      report={report}
      title="Net sentiment over time"
      subtitle={`Your brand's net sentiment ${trendWindow(report)}, from −100 (all negative) to +100 (all positive).`}
    >
      {(trends) => (
        <>
          <SectionExport view="trend-periods" request={report.trendsRequest} />
          <NetSentimentTrendChart points={trends.trend_data} />
          <div className="mt-4"><TrendPeriodTable points={trends.trend_data} kpis={NET_SENTIMENT_PERIOD_KPIS} /></div>
        </>
      )}
    </TrendSection>
  );
}
