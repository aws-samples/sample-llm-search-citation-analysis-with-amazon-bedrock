import type { VisibilityResponse } from '../../../types';
import { formatDate } from '../../../formatting/dateFormatter';
import type { VisibilityHeadlineProps } from './reportSlices';
import { ReportSection } from './ReportSection';
import { RunKpiHeadline } from './RunKpiHeadline';
import { gateVisibilityHeadline } from './visibilityHeadline';

interface Props extends VisibilityHeadlineProps {
  /** Shown when the keyword has no answered run yet. */
  readonly emptyMessage: string;
}

function headlineSubtitle({
  timestamp, kpis
}: VisibilityResponse): string {
  const run = timestamp === null ? 'Latest run' : `Latest run of ${formatDate(timestamp)}`;
  return `${run} — ${kpis.answers ?? 0} AI answers from ${kpis.engines} engines.`;
}

/**
 * The KPIs of a scope's latest run (`GET /visibility`), each with its change
 * since the previous run, like for like.
 */
export function VisibilityHeadlineSection({
  emptyMessage, ...props
}: Props) {
  const gate = gateVisibilityHeadline(props, emptyMessage);
  if (!gate.ready) return gate.placeholder;

  const visibility = gate.value;
  return (
    <ReportSection title="Headline" subtitle={headlineSubtitle(visibility)}>
      <RunKpiHeadline visibility={visibility} />
    </ReportSection>
  );
}
