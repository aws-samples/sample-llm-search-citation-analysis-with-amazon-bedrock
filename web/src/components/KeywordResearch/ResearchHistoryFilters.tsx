import type { ReactNode } from 'react';
import type { KeywordResearchItem } from '../../types';
import {
  STALE_FAILURE_DAYS,
  STATUS_FILTER_OPTIONS,
  TYPE_FILTER_LABELS,
  countHiddenStaleFailures,
  filterHistory,
  presentTypes,
  type HistoryFilters,
} from './researchHistoryFilter';

interface ResearchHistoryFiltersProps {
  history: KeywordResearchItem[];
  filters: HistoryFilters;
  now: number;
  onChange: (filters: HistoryFilters) => void;
}

interface FilterChipProps {
  label: string;
  count: number;
  pressed: boolean;
  onSelect: () => void;
}

/** A toggle chip; its count is the number of runs the list shows once it is picked. */
const FilterChip = ({
  label, count, pressed, onSelect
}: FilterChipProps) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={pressed}
    className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 ${pressed ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}
  >
    {label} <span className={pressed ? 'opacity-80' : 'text-gray-500'}>{count}</span>
  </button>
);

/** A fieldset of chips: the legend names it for screen readers, the short label shows on screen. */
const FilterGroup = ({
  legend, label, children
}: {
  legend: string;
  label: string;
  children: ReactNode 
}) => (
  <fieldset className="min-w-0">
    <legend className="sr-only">{legend}</legend>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-gray-500 mr-1" aria-hidden="true">{label}</span>
      {children}
    </div>
  </fieldset>
);

/** Below this many loaded runs the type and status chips are noise; the old-failures toggle still shows. */
const FILTERS_MIN_RUNS = 6;

/** The chips (on lists long enough to need them) and the old-failures toggle. */
export const HistoryFilterBar = (props: ResearchHistoryFiltersProps) => (
  <>
    {props.history.length >= FILTERS_MIN_RUNS && <ResearchHistoryFilters {...props} />}
    <StaleFailuresToggle {...props} />
  </>
);

/** Type and status chips above the History list, each with the count it would show. */
const ResearchHistoryFilters = ({
  history, filters, now, onChange
}: ResearchHistoryFiltersProps) => {
  const countWith = (next: Partial<HistoryFilters>) => filterHistory(history, {
    ...filters,
    ...next
  }, now).length;
  const types = presentTypes(history);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      {types.length > 1 && (
        <FilterGroup legend="Filter by type" label="Type">
          <FilterChip label="All" count={countWith({ type: 'all' })} pressed={filters.type === 'all'} onSelect={() => onChange({
            ...filters,
            type: 'all'
          })} />
          {types.map((type) => (
            <FilterChip key={type} label={TYPE_FILTER_LABELS[type]} count={countWith({ type })} pressed={filters.type === type} onSelect={() => onChange({
              ...filters,
              type
            })} />
          ))}
        </FilterGroup>
      )}
      <FilterGroup legend="Filter by status" label="Status">
        {STATUS_FILTER_OPTIONS.map(({
          value, label
        }) => (
          <FilterChip key={value} label={label} count={countWith({ status: value })} pressed={filters.status === value} onSelect={() => onChange({
            ...filters,
            status: value
          })} />
        ))}
      </FilterGroup>
    </div>
  );
};

/** Says how many old failed runs the default view hides, with a button that shows or hides them. */
const StaleFailuresToggle = ({
  history, filters, now, onChange
}: ResearchHistoryFiltersProps) => {
  const hidden = countHiddenStaleFailures(history, filters, now);
  if (hidden === 0) return null;
  const runs = hidden === 1 ? 'run' : 'runs';
  const verb = hidden === 1 ? 'is' : 'are';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span>
        {filters.showStaleFailures
          ? `Showing ${hidden} failed ${runs} older than ${STALE_FAILURE_DAYS} days.`
          : `${hidden} failed ${runs} older than ${STALE_FAILURE_DAYS} days ${verb} hidden.`}
      </span>
      <button
        type="button"
        onClick={() => onChange({
          ...filters,
          showStaleFailures: !filters.showStaleFailures
        })}
        className="rounded-sm font-medium text-blue-700 hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900"
      >
        {filters.showStaleFailures ? 'Hide them' : `Show ${hidden} older failed ${runs}`}
      </button>
    </div>
  );
};
