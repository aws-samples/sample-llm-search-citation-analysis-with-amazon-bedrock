import type { KpiDefinition } from '../../../../constants/kpiDefinitions';
import { ReportSection } from '../../layout';

interface Props {
  /** The definitions of every figure the report shows, in the order it shows them. */
  readonly definitions: readonly KpiDefinition[];
}

/**
 * How every KPI in the report is measured — the tooltip text, written out
 * so it survives printing and sharing.
 */
export function KpiDefinitionsSection({ definitions }: Props) {
  return (
    <ReportSection title="How these KPIs are measured">
      <dl className="grid gap-3 text-xs text-gray-700 dark:text-gray-300 sm:grid-cols-2">
        {definitions.map((entry) => (
          <div key={entry.label}>
            <dt className="font-semibold text-gray-900 dark:text-white">{entry.label}</dt>
            <dd className="mt-1">{entry.definition}</dd>
          </div>
        ))}
      </dl>
    </ReportSection>
  );
}
