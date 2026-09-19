import type {
  CrossPersonaBrandSummary, PersonaRankingsResponse 
} from '../../../../types';
import {
  ReportSection,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';

interface Props {
  readonly personas: PersonaRankingsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Persona impact only earns a slot in the report when persona choice
 * actually changes the ranking story. If every persona ranks first-party
 * brands roughly the same, we suppress the section to avoid bloating the
 * report with a table that says "personas don't matter here".
 *
 * Threshold: at least one first-party brand has a best/worst rank delta
 * of >= 3 across personas. That's enough for a marketer to consider
 * tweaking persona prompts to favor the better-performing one.
 */
const MEANINGFUL_DELTA = 3;

const COLUMNS: ReadonlyArray<ReportTableColumn<CrossPersonaBrandSummary>> = [
  {
    header: 'First-party brand',
    cellClassName: 'font-medium',
    render: (brand) => brand.name,
  },
  {
    header: 'Best rank',
    render: (brand) => brand.best_rank,
  },
  {
    header: 'Worst rank',
    render: (brand) => brand.worst_rank,
  },
  {
    header: 'Δ',
    render: (brand) => rankDelta(brand),
  },
  {
    header: 'Best persona',
    render: (brand) => brand.best_persona,
  },
];

export function PersonaImpactSection({
  personas, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Persona impact',
    loading,
    loadingMessage: 'Loading persona breakdown…',
    error,
    value: personas,
  });
  if (!gate.ready) return gate.placeholder;

  if (gate.value.personas.length <= 1) {
    return null;
  }

  const firstParty = gate.value.cross_persona_summary.brands.filter(
    (brand) => brand.classification === 'first_party',
  );

  if (firstParty.length === 0) {
    return null;
  }

  const meaningful = firstParty.some(
    (brand) => rankDelta(brand) >= MEANINGFUL_DELTA,
  );

  if (!meaningful) {
    return (
      <ReportSection
        title="Persona impact"
        subtitle="Persona choice does not materially change ranking for this keyword."
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          First-party brands rank within{' '}
          <span className="font-medium">{MEANINGFUL_DELTA}</span>{' '}
          positions across all configured personas — persona-specific
          optimisation is unlikely to move the needle here.
        </p>
      </ReportSection>
    );
  }

  return (
    <ReportSection
      title="Persona impact"
      subtitle="Where in your persona library does this keyword perform best, and where does it slip?"
    >
      <ReportTable
        columns={COLUMNS}
        rows={firstParty}
        rowKey={(brand) => brand.name}
        rowClassName={meaningfulDeltaRowClass}
      />
    </ReportSection>
  );
}

function rankDelta(brand: CrossPersonaBrandSummary): number {
  return brand.worst_rank - brand.best_rank;
}

function meaningfulDeltaRowClass(brand: CrossPersonaBrandSummary): string {
  return rankDelta(brand) >= MEANINGFUL_DELTA ? 'bg-amber-50 dark:bg-amber-950/20' : '';
}
