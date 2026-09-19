import type { CompetitorRollup } from '../../../../api/reports';
import {
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  gateSection,
} from '../../layout';

interface Props {
  readonly competitor: string;
  readonly rollup: CompetitorRollup | null;
  readonly keywordsAnalyzed: number;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Three-number headline: how many keywords this competitor outranks
 * us on, how many sources cite them but not us, and the count of
 * "high lift" outreach targets in their list. Lifts are filtered
 * with priority = 'high' so the metric reflects work that actually
 * matters.
 */
export function HeadlineSection({
  competitor, rollup, keywordsAnalyzed, loading, error,
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading rollup…',
    error,
    value: rollup,
    emptyMessage: 'No rollup data yet. Run an analysis to populate.',
  });
  if (!gate.ready) return gate.placeholder;

  const outrankedCount = gate.value.outranked_keywords.length;
  const exclusiveCount = gate.value.exclusive_sources.length;
  const highLiftCount = gate.value.exclusive_sources.filter(
    (s) => s.priority === 'high',
  ).length;

  return (
    <ReportSection title="Headline">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Across {keywordsAnalyzed} tracked keywords, vs <strong>{competitor}</strong>:
      </p>
      <ReportStatGrid columns={3}>
        <ReportStatCard
          label="Outranked keywords"
          value={outrankedCount}
          accent={outrankedCount > 0 ? 'negative' : 'neutral'}
          footnote="Keywords where they beat our best rank"
        />
        <ReportStatCard
          label="Exclusive sources"
          value={exclusiveCount}
          accent={exclusiveCount > 0 ? 'negative' : 'neutral'}
          footnote="Sources citing them but not us"
        />
        <ReportStatCard
          label="High-lift targets"
          value={highLiftCount}
          accent={highLiftCount > 0 ? 'positive' : 'neutral'}
          footnote="High-priority outreach opportunities"
        />
      </ReportStatGrid>
    </ReportSection>
  );
}
