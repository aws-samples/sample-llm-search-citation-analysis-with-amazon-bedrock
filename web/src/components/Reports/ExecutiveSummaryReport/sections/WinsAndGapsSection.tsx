import type { ReportsOverviewResponse } from '../../../../api/reports';
import {
  MoverColumn, ReportSection, gateSection 
} from '../../layout';

interface Props {
  readonly data: ReportsOverviewResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The "what worked / what didn't" pair. Surfaces the top three improvers
 * and decliners side-by-side so the reader can match a campaign decision
 * to a measurable outcome (or its absence) on a single page.
 */
export function WinsAndGapsSection({
  data, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Top wins and gaps',
    loading,
    loadingMessage: 'Loading movers…',
    error,
    value: data,
  });
  if (!gate.ready) return gate.placeholder;

  return (
    <ReportSection
      title="Top wins and gaps"
      subtitle="Top three movers in each direction. Wins are where investment paid off; gaps are where to focus the next sprint."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MoverColumn
          title="Wins"
          accent="positive"
          rows={gate.value.top_improving}
          emptyMessage="No keywords improved in the period. The next sprint should focus on the gaps panel."
        />
        <MoverColumn
          title="Gaps"
          accent="negative"
          rows={gate.value.top_declining}
          emptyMessage="No keywords declined in the period. Maintain current investment."
        />
      </div>
    </ReportSection>
  );
}
