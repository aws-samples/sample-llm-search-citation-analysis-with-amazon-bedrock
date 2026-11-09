import { useId } from 'react';
import type { KeywordIntent } from '../../../types/api/seo';
import {
  INTENT_ORDER, type KeywordFilters
} from './keywordExplorerFilters';
import { INTENT_LABELS } from './keywordExplorerFormat';

type TextFilterField = Exclude<keyof KeywordFilters, 'intents'>;

const TEXT_FIELDS: ReadonlyArray<{
  field: TextFilterField;
  label: string;
  numeric: boolean;
  step?: string 
}> = [
  {
    field: 'include',
    label: 'Include terms',
    numeric: false,
  },
  {
    field: 'exclude',
    label: 'Exclude terms',
    numeric: false,
  },
  {
    field: 'minVolume',
    label: 'Min volume',
    numeric: true,
  },
  {
    field: 'maxVolume',
    label: 'Max volume',
    numeric: true,
  },
  {
    field: 'maxDifficulty',
    label: 'Max difficulty',
    numeric: true,
  },
  {
    field: 'minCpc',
    label: 'Min CPC (USD)',
    numeric: true,
    step: '0.01',
  },
  {
    field: 'maxCpc',
    label: 'Max CPC (USD)',
    numeric: true,
    step: '0.01',
  },
];

const FIELD_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900';

interface KeywordFilterPanelProps {
  readonly filters: KeywordFilters;
  readonly onChange: (filters: KeywordFilters) => void;
}

/** Client-side filters of the research rows; no request is made. */
export function KeywordFilterPanel({
  filters, onChange
}: KeywordFilterPanelProps) {
  const ids = useId();
  const toggleIntent = (intent: KeywordIntent) => {
    const intents = filters.intents.includes(intent)
      ? filters.intents.filter((selected) => selected !== intent)
      : INTENT_ORDER.filter((candidate) => candidate === intent || filters.intents.includes(candidate));
    onChange({
      ...filters,
      intents,
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {TEXT_FIELDS.map(({
          field, label, numeric, step
        }) => (
          <div key={field}>
            <label htmlFor={`${ids}-${field}`} className="block text-xs text-gray-600 mb-1">{label}</label>
            <input
              id={`${ids}-${field}`}
              type={numeric ? 'number' : 'text'}
              min={numeric ? 0 : undefined}
              step={step}
              value={filters[field]}
              onChange={(event) => onChange({
                ...filters,
                [field]: event.target.value,
              })}
              className={FIELD_CLASS}
            />
          </div>
        ))}
      </div>
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="sr-only">Intent</legend>
        <span className="text-xs text-gray-600">Intent</span>
        {INTENT_ORDER.map((intent) => (
          <label key={intent} className="flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={filters.intents.includes(intent)}
              onChange={() => toggleIntent(intent)}
              className="rounded-sm border-gray-300"
            />
            {INTENT_LABELS[intent]}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-gray-500 mt-1">
        Include terms must all appear; any exclude term hides the keyword (separate terms with commas). A keyword without a value never passes a bound on it.
      </p>
    </div>
  );
}
