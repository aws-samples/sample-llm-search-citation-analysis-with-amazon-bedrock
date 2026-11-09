import { settingsPath } from '../Settings/settingsSections';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';
import { PageLink } from './RunCard';
import {
  describeEngines, describePersonas, engineCount
} from './runTargets';
import type { RunTargetsState } from './useRunTargets';

interface RunTargetsFieldProps {
  readonly state: RunTargetsState;
  /** While a run is in progress, links that leave the page are not offered. */
  readonly showLinks: boolean;
}

const TargetsText = ({ state }: Pick<RunTargetsFieldProps, 'state'>) => {
  if (state.status === 'loading') {
    return (
      <SkeletonRegion label="Loading AI engines and personas" className="space-y-1.5">
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </SkeletonRegion>
    );
  }
  if (state.status === 'unavailable') {
    return <p className="text-sm text-gray-600">Could not read the AI engine list. Every enabled engine and persona is used.</p>;
  }
  const { targets } = state;
  if (engineCount(targets) === 0) {
    return <p className="text-sm text-red-700">No AI engine is enabled with an API key, so the run would record no answers.</p>;
  }
  return (
    <ul className="text-sm text-gray-700 space-y-0.5">
      <li className="break-words">{describeEngines(targets)}</li>
      <li className="break-words">{describePersonas(targets)}</li>
      {targets.aiOverviews && targets.personas.length > 0 && (
        <li className="text-xs text-gray-500">Google AI Overviews is asked each keyword once, without personas.</li>
      )}
    </ul>
  );
};

/**
 * What every keyword of the run is sent to: the ready AI engines and the
 * enabled personas, with links to where they are changed.
 */
export const RunTargetsField = ({
  state, showLinks
}: RunTargetsFieldProps) => (
  <div>
    <h3 className="text-sm font-medium text-gray-900 mb-2">Sent to</h3>
    <TargetsText state={state} />
    {showLinks && (
      <p className="mt-1 text-xs text-gray-500">
        Change them in <PageLink to={settingsPath('providers')}>AI providers</PageLink>
        {' '}and <PageLink to={settingsPath('query-prompts')}>Personas</PageLink>.
      </p>
    )}
  </div>
);
