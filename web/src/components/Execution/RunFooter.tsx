import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { PlayIcon } from '../ui';
import { marketName } from '../Markets/marketSelection';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import { settingsPath } from '../Settings/settingsSections';
import { PageLink } from './RunCard';
import { describeRun } from './runSelection';
import { describeAnswers } from './runTargets';
import type { RunTargetsState } from './useRunTargets';

interface RunFooterProps {
  /** Every keyword in the library, active or not. */
  readonly keywordsCount: number;
  /** Active keywords the chosen scope resolves to. */
  readonly runKeywordCount: number;
  readonly marketIds: readonly string[];
  readonly targets: RunTargetsState;
  readonly isRunning: boolean;
  readonly isStarting: boolean;
  readonly onStart: () => void;
}

interface FooterNote {
  readonly content: ReactNode;
  readonly className: string;
}

/** Why Start is disabled, or null when it can start: an empty library is a problem, an empty pick the next step. */
function blockedNote(keywordsCount: number, runKeywordCount: number, isRunning: boolean): FooterNote | null {
  if (isRunning) return {
    content: 'A run is in progress. Start the next one when it finishes.',
    className: 'text-gray-600',
  };
  if (keywordsCount === 0) return {
    content: <>Add keywords first, in <PageLink to={settingsPath('keywords')}>Settings › Keywords</PageLink>.</>,
    className: 'text-red-700',
  };
  if (runKeywordCount === 0) return {
    content: 'Pick at least one keyword or group with active keywords.',
    className: 'text-gray-600',
  };
  return null;
}

const RunSummary = ({
  runKeywordCount, marketIds, targets
}: Pick<RunFooterProps, 'runKeywordCount' | 'marketIds' | 'targets'>) => {
  const { catalog } = useMarketSelection();
  const names = marketIds.map((marketId) => marketName(marketId, catalog.markets));
  return (
    <>
      <p className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">Will run: </span>
        {describeRun(runKeywordCount, names)}
      </p>
      {targets.status === 'ready' && (
        <p className="text-xs text-gray-500 mt-0.5">{describeAnswers(runKeywordCount, targets.targets)}</p>
      )}
    </>
  );
};

/**
 * The start card's bottom bar, as in the schedule dialog: what Start will
 * run (or why it cannot) on the left, the one primary button on the right.
 */
export const RunFooter = ({
  keywordsCount, runKeywordCount, marketIds, targets, isRunning, isStarting, onStart
}: RunFooterProps) => {
  const note = blockedNote(keywordsCount, runKeywordCount, isRunning);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0" aria-live="polite">
        {note === null
          ? <RunSummary runKeywordCount={runKeywordCount} marketIds={marketIds} targets={targets} />
          : <p className={`text-sm ${note.className}`}>{note.content}</p>}
      </div>
      <Button
        className="self-start sm:self-auto shrink-0"
        onClick={onStart}
        disabled={note !== null || isStarting}
        leadingIcon={isStarting ? <Spinner size="sm" /> : <PlayIcon className="w-4 h-4" />}
      >
        {isStarting ? 'Starting…' : 'Start analysis'}
      </Button>
    </div>
  );
};
