import { useId } from 'react';
import { VISIBILITY_DEFINITIONS } from '../../constants/kpiDefinitions';
import { Disclosure } from '../ui/Disclosure';

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
        <dl className="grid gap-x-6 gap-y-2 text-xs text-gray-600 dark:text-gray-400 md:grid-cols-2">
          {VISIBILITY_DEFINITIONS.map(({
            label, definition
          }) => (
            <div key={label}>
              <dt className="font-medium text-gray-900 dark:text-white">{label}</dt>
              <dd>{definition}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </section>
  );
}
