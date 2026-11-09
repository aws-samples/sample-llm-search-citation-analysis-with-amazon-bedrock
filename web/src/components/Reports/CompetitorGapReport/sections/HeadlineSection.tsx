import {
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  gateSection,
} from '../../layout';
import type { RollupSectionProps } from './rollupSection';
import { ScopeCoverageNote } from '../../../ui/ScopeCoverageNote';

interface Props extends RollupSectionProps {
  readonly competitor: string;
  readonly keywordsAnalyzed: number;
}

/**
 * Three-number headline: how many keywords this competitor outranks
 * us on, how many sources cite them but not us, and the count of
 * "high lift" outreach targets in their list. Lifts are filtered
 * with priority = 'high' so the metric reflects work that actually
 * matters.
 */
export function HeadlineSection({
  competitor, rollup, keywordsAnalyzed, loading, error, computing, response,
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    computing,
    loadingMessage: 'Loading rollup…',
    loadingShape: 'stats',
    error,
    value: rollup,
    emptyMessage: 'No rollup data yet. Run an analysis to populate.',
  });
  if (!gate.ready) return gate.placeholder;

  // 2.45.0 pages the list; the total counts every outranked keyword of the scope.
  const outrankedCount = gate.value.outranked_keywords_total ?? gate.value.outranked_keywords.length;
  const exclusiveCount = gate.value.exclusive_source_count;
  const highLiftCount = gate.value.high_priority_source_count;

  return (
    <ReportSection title="Headline" subtitle={`Across ${keywordsAnalyzed} tracked keywords, against ${competitor}.`}>
      <ScopeCoverageNote response={response} className="mb-3" />
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
