import { VISIBILITY_DEFINITIONS } from '../../constants/kpiDefinitions';
import { OverviewPanel } from './OverviewPanel';

/** Every tooltip of the tab written out: how each KPI and its change are measured. */
export function VisibilityDefinitions() {
  return (
    <OverviewPanel title="How these KPIs are measured">
      <dl className="grid gap-x-6 gap-y-2 text-xs text-gray-600 md:grid-cols-2">
        {VISIBILITY_DEFINITIONS.map(({
          label, definition
        }) => (
          <div key={label}>
            <dt className="font-medium text-gray-900">{label}</dt>
            <dd>{definition}</dd>
          </div>
        ))}
      </dl>
    </OverviewPanel>
  );
}
