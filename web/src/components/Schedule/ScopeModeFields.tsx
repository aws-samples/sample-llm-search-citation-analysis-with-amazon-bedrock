import type { ComponentProps } from 'react';
import type {
  AnalysisScope, KeywordGroup
} from '../../types';
import { Disclosure } from '../ui/Disclosure';
import { MarketScopeFilter } from '../Markets/MarketScopeFilter';
import { MarketsConfigured } from '../Markets/MarketsConfigured';

export type ScopeMode = AnalysisScope['mode'];

export interface ScopeModeOption {
  readonly mode: ScopeMode;
  readonly label: string;
  readonly hint: string;
}

interface ScopeModeRadiosProps {
  /** Prefix of the radio ids and their shared `name`, unique on the page. */
  readonly idPrefix: string;
  readonly legend: string;
  readonly options: readonly ScopeModeOption[];
  readonly value: ScopeMode;
  readonly onChange: (mode: ScopeMode) => void;
  readonly disabled?: boolean;
}

/**
 * The "what to run" choice shared by Run Analysis and the schedule form:
 * every active keyword, whole keyword groups, or a hand-picked set.
 */
export const ScopeModeRadios = ({
  idPrefix, legend, options, value, onChange, disabled = false
}: ScopeModeRadiosProps) => (
  <fieldset className="border-0 p-0 m-0">
    <legend className="block text-sm font-medium text-gray-900 mb-2">{legend}</legend>
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const optionId = `${idPrefix}-scope-mode-${option.mode}`;
        return (
          <label key={option.mode} htmlFor={optionId} className="flex items-start gap-2 text-sm text-gray-700">
            <input
              id={optionId}
              type="radio"
              name={`${idPrefix}-scope-mode`}
              value={option.mode}
              checked={value === option.mode}
              disabled={disabled}
              onChange={() => onChange(option.mode)}
              aria-describedby={`${optionId}-hint`}
              className="mt-0.5"
            />
            <span>
              <span className="block">{option.label}</span>
              <span id={`${optionId}-hint`} className="block text-xs text-gray-500">{option.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

interface KeywordGroupChecklistProps {
  /** Prefix of the checkbox ids and their shared `name`, unique on the page. */
  readonly idPrefix: string;
  readonly groups: KeywordGroup[];
  readonly selectedIds: string[];
  readonly onChange: (ids: string[]) => void;
  readonly disabled?: boolean;
  /**
   * Disable groups without active keywords, for a run that resolves its groups
   * now. A schedule resolves them when it fires, so it keeps them pickable.
   */
  readonly disableEmptyGroups?: boolean;
}

function groupsSelectedText(count: number): string {
  return `${count} group${count === 1 ? '' : 's'} selected`;
}

/** Checkboxes for whole keyword groups, with each group's active keyword count. */
export const KeywordGroupChecklist = ({
  idPrefix, groups, selectedIds, onChange, disabled = false, disableEmptyGroups = false
}: KeywordGroupChecklistProps) => {
  if (groups.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        No keyword groups yet. Create them in Settings → Keywords first.
      </p>
    );
  }

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
  };

  return (
    <div className="mt-2">
      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {groups.map((group) => {
          const groupId = `${idPrefix}-group-${group.id}`;
          const empty = disableEmptyGroups && group.keyword_count === 0;
          return (
            <label
              key={group.id}
              htmlFor={groupId}
              // The count is of active members, so 0 means a run would resolve to nothing: say so.
              title={empty ? `${group.name} has no active keywords to run` : undefined}
              className="flex min-w-0 items-center gap-2 text-sm text-gray-700 py-0.5"
            >
              <input
                id={groupId}
                name={`${idPrefix}-group-ids`}
                value={group.id}
                type="checkbox"
                checked={selectedIds.includes(group.id)}
                disabled={disabled || empty}
                onChange={() => toggle(group.id)}
                aria-label={`Include group ${group.name}`}
              />
              <span className="truncate">{group.name}</span>
              <span className="text-xs text-gray-500">({group.keyword_count})</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-500">{groupsSelectedText(selectedIds.length)}</p>
    </div>
  );
};

type MarketLimitDisclosureProps = ComponentProps<typeof MarketScopeFilter>;

/**
 * The optional market filter of Run Analysis and the schedule form, collapsed
 * under "Limit to markets (optional)". The title counts the ticked markets, so
 * a narrowed scope shows while closed. Hidden until a market is configured.
 */
export const MarketLimitDisclosure = ({
  idPrefix, selectedIds, onChange, disabled = false
}: MarketLimitDisclosureProps) => (
  <MarketsConfigured>
    <div className="mt-4">
      <Disclosure
        title={selectedIds.length === 0 ? 'Limit to markets (optional)' : `Limit to markets (${selectedIds.length} selected)`}
        headingLevel={3}
        headingClassName="text-sm font-medium text-gray-700"
      >
        <MarketScopeFilter idPrefix={idPrefix} selectedIds={selectedIds} onChange={onChange} disabled={disabled} />
      </Disclosure>
    </div>
  </MarketsConfigured>
);
