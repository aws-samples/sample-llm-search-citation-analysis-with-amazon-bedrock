import {
  useId, useState
} from 'react';
import type {
  BacklinksFilters, BacklinksTab
} from '../../../types/api/seoBacklinks';
import { Button } from '../../ui/Button';
import {
  TAB_FILTER_FIELDS, cleanFilters, conditionCount, type RangeFilter
} from './backlinksFilters';

const FIELD_CLASS = 'w-full p-1.5 border border-gray-200 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900';
const LABEL_CLASS = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1';

type LinkType = NonNullable<BacklinksFilters['link_type']>;
const LINK_TYPES: ReadonlyArray<{
  readonly id: LinkType;
  readonly label: string;
}> = [
  {
    id: 'all',
    label: 'All',
  },
  {
    id: 'dofollow',
    label: 'Dofollow',
  },
  {
    id: 'nofollow',
    label: 'Nofollow',
  },
];

function isLinkType(value: string): value is LinkType {
  return LINK_TYPES.some((type) => type.id === value);
}

/** A number input's value as a filter bound: empty or not a finite number is unset. */
export function parseBound(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function RangeInputs({
  range, draft, onChange
}: {
  readonly range: RangeFilter;
  readonly draft: BacklinksFilters;
  readonly onChange: (next: BacklinksFilters) => void;
}) {
  const id = useId();
  return (
    <fieldset>
      <legend className={LABEL_CLASS}>{range.label}</legend>
      <div className="flex gap-2">
        {(['min', 'max'] as const).map((bound) => {
          const key = range[bound];
          return (
            <input
              key={bound}
              id={`${id}-${bound}`}
              type="number"
              aria-label={`${range.label} ${bound}`}
              placeholder={bound === 'min' ? 'Min' : 'Max'}
              className={FIELD_CLASS}
              value={draft[key] ?? ''}
              onChange={(event) => onChange({
                ...draft,
                [key]: parseBound(event.target.value),
              })}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function LinkFlagInputs({
  draft, onChange
}: {
  readonly draft: BacklinksFilters;
  readonly onChange: (next: BacklinksFilters) => void;
}) {
  const typeId = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={typeId} className={LABEL_CLASS}>Link type</label>
      <select
        id={typeId}
        className={FIELD_CLASS}
        value={draft.link_type ?? 'all'}
        onChange={(event) => {
          if (isLinkType(event.target.value)) onChange({
            ...draft,
            link_type: event.target.value,
          });
        }}
      >
        {LINK_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
      </select>
      {(['hide_lost', 'hide_broken'] as const).map((flag) => (
        <label key={flag} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={draft[flag] === true}
            onChange={(event) => onChange({
              ...draft,
              [flag]: event.target.checked,
            })}
          />
          {flag === 'hide_lost' ? 'Hide lost' : 'Hide broken'}
        </label>
      ))}
    </div>
  );
}

interface BacklinksFilterPanelProps {
  readonly tab: BacklinksTab;
  readonly applied: BacklinksFilters;
  /** How many conditions the user's filters may use in this view. */
  readonly limit: number;
  readonly onApply: (filters: BacklinksFilters) => void;
}

/** The filters of one table; Apply is disabled while they exceed the view's condition budget. */
export function BacklinksFilterPanel({
  tab, applied, limit, onApply
}: BacklinksFilterPanelProps) {
  const fields = TAB_FILTER_FIELDS[tab];
  const [draft, setDraft] = useState<BacklinksFilters>(applied);
  const includeId = useId();
  const excludeId = useId();
  const used = conditionCount(draft);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor={includeId} className={LABEL_CLASS}>{fields.textLabel} contains</label>
          <input
            id={includeId}
            className={FIELD_CLASS}
            placeholder="blog, news"
            value={draft.include ?? ''}
            onChange={(event) => setDraft({
              ...draft,
              include: event.target.value,
            })}
          />
        </div>
        <div>
          <label htmlFor={excludeId} className={LABEL_CLASS}>{fields.textLabel} excludes</label>
          <input
            id={excludeId}
            className={FIELD_CLASS}
            value={draft.exclude ?? ''}
            onChange={(event) => setDraft({
              ...draft,
              exclude: event.target.value,
            })}
          />
        </div>
        {fields.ranges.map((range) => <RangeInputs key={range.label} range={range} draft={draft} onChange={setDraft} />)}
        {fields.linkFlags && <LinkFlagInputs draft={draft} onChange={setDraft} />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={used > limit} onClick={() => onApply(cleanFilters(draft))}>Apply filters</Button>
        <Button size="sm" variant="secondary" onClick={() => {
          setDraft({});
          onApply({});
        }}>Clear</Button>
        <span className={`text-xs ${used > limit ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
          {used} of {limit} filter conditions used
        </span>
      </div>
    </div>
  );
}
