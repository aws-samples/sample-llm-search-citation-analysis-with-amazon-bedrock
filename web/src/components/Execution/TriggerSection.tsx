import type {
  Keyword, KeywordGroup
} from '../../types';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import { keywordsInMarkets } from '../Markets/marketScope';
import {
  KeywordGroupChecklist, MarketLimitDisclosure, ScopeModeRadios, type ScopeModeOption
} from '../Schedule/ScopeModeFields';
import {
  PageLink, RunCard
} from './RunCard';
import { RunFooter } from './RunFooter';
import { RunTargetsField } from './RunTargetsField';
import { TriggerSectionSkeleton } from './TriggerSectionSkeleton';
import { useRunTargets } from './useRunTargets';
import {
  runKeywordCount, type RunSelection
} from './runSelection';

interface TriggerSectionProps {
  readonly selection: RunSelection;
  readonly onSelectionChange: (selection: RunSelection) => void;
  /** Every keyword in the library, active or not ("Add keywords first" when 0). */
  readonly keywordsCount: number;
  readonly activeKeywords: Keyword[];
  readonly groups: KeywordGroup[];
  readonly isRunning: boolean;
  readonly isStarting: boolean;
  readonly onTriggerAnalysis: () => void;
  /** Both trigger routes are Admin-only server-side. */
  readonly isAdmin: boolean;
  /** Admin membership or the keyword groups are still loading for the first time. */
  readonly loading: boolean;
}

const RUN_SCOPE_OPTIONS: readonly ScopeModeOption[] = [
  {
    mode: 'all',
    label: 'All active keywords',
    hint: 'Every keyword that is not paused.',
  },
  {
    mode: 'groups',
    label: 'Keyword groups',
    hint: 'Every active keyword in the groups you pick.',
  },
  {
    mode: 'keywords',
    label: 'Specific keywords',
    hint: 'Pick them from the list.',
  },
];

const TITLE_ID = 'run-start-title';
const TITLE = 'Start a run';
/** The analysis run's description on the schedule dialog, so both pages name it the same way. */
const PURPOSE = 'Asks the AI engines about your keywords and records every answer and citation.';

type ScopeFieldsProps = Pick<TriggerSectionProps, 'selection' | 'onSelectionChange' | 'activeKeywords' | 'groups'> & {readonly disabled: boolean;};

/** "Which keywords", in the schedule dialog's pattern: a scope, its picker, then markets behind a disclosure. */
const RunScopeFields = ({
  selection, onSelectionChange, activeKeywords, groups, disabled
}: ScopeFieldsProps) => {
  // The market filter narrows what a run covers and what can be picked.
  const pickable = keywordsInMarkets(activeKeywords, selection.marketIds);
  return (
    <div>
      <ScopeModeRadios
        idPrefix="execution"
        legend="Which keywords"
        options={RUN_SCOPE_OPTIONS}
        value={selection.mode}
        onChange={(mode) => onSelectionChange({
          ...selection,
          mode,
        })}
        disabled={disabled}
      />
      {selection.mode === 'groups' && (
        <KeywordGroupChecklist
          idPrefix="execution"
          groups={groups}
          selectedIds={[...selection.groupIds]}
          onChange={(groupIds) => onSelectionChange({
            ...selection,
            groupIds,
          })}
          disabled={disabled}
          disableEmptyGroups
        />
      )}
      {selection.mode === 'keywords' && pickable.length > 0 && (
        <div className="mt-2">
          <KeywordScopePicker
            idPrefix="execution-keyword-scope"
            name="execution-keyword-ids"
            keywords={pickable}
            groups={groups}
            selectedIds={selection.keywordIds}
            onChange={(keywordIds) => onSelectionChange({
              ...selection,
              keywordIds,
            })}
            disabled={disabled}
          />
        </div>
      )}
      <MarketLimitDisclosure
        idPrefix="execution"
        selectedIds={selection.marketIds}
        // The picked keywords may sit outside the new markets, so the pick starts over.
        onChange={(marketIds) => onSelectionChange({
          ...selection,
          marketIds,
          keywordIds: [],
        })}
        disabled={disabled}
      />
    </div>
  );
};

/**
 * The start card of Run Analysis, in the order the user decides: which
 * keywords (every active one by default, markets behind a disclosure), what
 * they are sent to, then a footer with what will run and the Start button.
 */
export const TriggerSection = (props: TriggerSectionProps) => {
  // Membership decides between two different cards and the groups reshape
  // the picker, so hold a same-sized placeholder until both are known.
  if (props.loading) return <TriggerSectionSkeleton />;

  // POST /api/trigger-analysis and /api/trigger-keyword-analysis are Admin-only:
  // one request fans out paid provider calls across every keyword and persona.
  if (!props.isAdmin) {
    return (
      <RunCard
        titleId={TITLE_ID}
        title={TITLE}
        description={`${PURPOSE} Starting a run needs an administrator: ask one to start it or to set up a schedule.`}
      />
    );
  }
  return <AdminTriggerSection {...props} />;
};

const AdminTriggerSection = ({
  selection, onSelectionChange, keywordsCount, activeKeywords, groups, isRunning, isStarting, onTriggerAnalysis,
}: TriggerSectionProps) => {
  const targets = useRunTargets();
  const busy = isRunning || isStarting;
  return (
    <RunCard
      titleId={TITLE_ID}
      title={TITLE}
      description={(
        <p>
          {PURPOSE}
          {/* A link out of the page while a run is in progress would skip the leave confirmation. */}
          {!isRunning && <> To repeat it automatically, <PageLink to="/schedule">create a schedule</PageLink>.</>}
        </p>
      )}
      footer={(
        <RunFooter
          keywordsCount={keywordsCount}
          runKeywordCount={runKeywordCount(selection, activeKeywords)}
          marketIds={selection.marketIds}
          targets={targets}
          isRunning={isRunning}
          isStarting={isStarting}
          onStart={onTriggerAnalysis}
        />
      )}
    >
      <div className="max-w-3xl space-y-6">
        <RunScopeFields selection={selection} onSelectionChange={onSelectionChange} activeKeywords={activeKeywords}
          groups={groups} disabled={busy} />
        <RunTargetsField state={targets} showLinks={!isRunning} />
      </div>
    </RunCard>
  );
};
