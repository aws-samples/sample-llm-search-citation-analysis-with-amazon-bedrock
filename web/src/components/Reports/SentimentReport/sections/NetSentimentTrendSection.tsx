import {
  trendWindow, TrendSection, type ScopeSectionProps
} from '../../scopeReport';
import { NetSentimentTrendChart } from '../NetSentimentTrendChart';

/** Your net sentiment in each period of the chosen window. */
export function NetSentimentTrendSection({ report }: ScopeSectionProps) {
  return (
    <TrendSection
      report={report}
      title="Net sentiment over time"
      subtitle={`Your brand's net sentiment ${trendWindow(report)}, from −100 (all negative) to +100 (all positive).`}
    >
      {(trends) => <NetSentimentTrendChart points={trends.trend_data} />}
    </TrendSection>
  );
}
