import { useId } from 'react';
import { VISIBILITY_DEFINITIONS } from '../../constants/kpiDefinitions';
import { Disclosure } from '../ui/Disclosure';
import { KpiDefinitionList } from '../ui/KpiDefinitionList';

/**
 * Every tooltip of the tab written out: how each KPI and its change are
 * measured. Collapsed until asked for (the tooltips carry the same text);
 * always open in print.
 */
export function VisibilityDefinitions() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="bg-white rounded-lg shadow p-4">
      <Disclosure title="How these KPIs are measured" headingLevel={3} headingClassName="text-lg font-medium" headingId={headingId}>
        <KpiDefinitionList definitions={VISIBILITY_DEFINITIONS} />
      </Disclosure>
    </section>
  );
}
