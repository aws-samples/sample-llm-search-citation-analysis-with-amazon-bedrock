import {
  useId, useState, type SubmitEvent
} from 'react';
import { Button } from '../../ui/Button';
import type {
  KeywordResearchMode, KeywordResearchRequest
} from '../../../types/api/seo';
import { TrackedKeywordPicker } from './TrackedKeywordPicker';

/** The research modes, labelled for marketers (suggestions contain the seed, related = "people also search for"). */
export const MODE_OPTIONS: ReadonlyArray<{
  value: KeywordResearchMode;
  label: string 
}> = [
  {
    value: 'auto',
    label: 'Auto',
  },
  {
    value: 'suggestions',
    label: 'Phrase match',
  },
  {
    value: 'ideas',
    label: 'Category ideas',
  },
  {
    value: 'related',
    label: 'People also search for',
  },
];

const LIMIT_OPTIONS = [150, 300, 500] as const;
type ResultLimit = typeof LIMIT_OPTIONS[number];

const MAX_SEED_LENGTH = 200;
const FIELD_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-1';

function isMode(value: string): value is KeywordResearchMode {
  return MODE_OPTIONS.some((option) => option.value === value);
}

function isLimit(value: number): value is ResultLimit {
  return LIMIT_OPTIONS.some((limit) => limit === value);
}

interface KeywordExplorerFormProps {
  /** Called once per submit with the request minus the market (the explorer adds the header market). */
  readonly onSearch: (request: Omit<KeywordResearchRequest, 'market_id'>) => void;
  readonly searching: boolean;
}

interface ToggleFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

function ToggleField({
  label, checked, onChange
}: ToggleFieldProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="rounded-sm border-gray-300"
      />
      {label}
    </label>
  );
}

/** Seed and options of a keyword research; nothing is requested until Search. */
export function KeywordExplorerForm({
  onSearch, searching
}: KeywordExplorerFormProps) {
  const ids = useId();
  const [seed, setSeed] = useState('');
  const [mode, setMode] = useState<KeywordResearchMode>('auto');
  const [limit, setLimit] = useState<ResultLimit>(150);
  const [groupKeywords, setGroupKeywords] = useState(false);
  const [clickstream, setClickstream] = useState(false);
  const keyword = seed.trim();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (keyword === '' || searching) return;
    onSearch({
      keyword,
      mode,
      limit,
      group_keywords: groupKeywords,
      clickstream,
    });
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label htmlFor={`${ids}-seed`} className={LABEL_CLASS}>Seed keyword</label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              id={`${ids}-seed`}
              type="text"
              value={seed}
              maxLength={MAX_SEED_LENGTH}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="e.g. boutique hotel"
              className={FIELD_CLASS}
            />
            <TrackedKeywordPicker onPick={(picked) => setSeed(picked.slice(0, MAX_SEED_LENGTH))} disabled={searching} />
          </div>
        </div>
        <div>
          <label htmlFor={`${ids}-mode`} className={LABEL_CLASS}>Mode</label>
          <select
            id={`${ids}-mode`}
            value={mode}
            onChange={(event) => { if (isMode(event.target.value)) setMode(event.target.value); }}
            className={FIELD_CLASS}
          >
            {MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-limit`} className={LABEL_CLASS}>Results</label>
          <select
            id={`${ids}-limit`}
            value={limit}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (isLimit(next)) setLimit(next);
            }}
            className={FIELD_CLASS}
          >
            {LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <ToggleField label="Group keywords" checked={groupKeywords} onChange={setGroupKeywords} />
        <ToggleField label="Include clickstream data" checked={clickstream} onChange={setClickstream} />
        <div className="sm:ml-auto">
          <Button type="submit" disabled={keyword === '' || searching}>
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </div>
    </form>
  );
}
