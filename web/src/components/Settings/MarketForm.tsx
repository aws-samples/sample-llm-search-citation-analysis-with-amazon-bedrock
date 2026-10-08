import {
  useId, useState, type FormEvent
} from 'react';
import type { Market } from '../../types';
import { Button } from '../ui';
import { ErrorAlert } from '../ui/ErrorAlert';
import {
  emptyMarketFormValues, marketFormValues, marketFromForm, type MarketFormValues
} from './marketFormModel';
import { useFormValues } from './useFormValues';

type TextKey = Exclude<keyof MarketFormValues, 'competitors' | 'first_party_aliases'>;

interface FieldSpec {
  readonly key: TextKey;
  readonly label: string;
  readonly placeholder: string;
  readonly hint?: string;
  readonly required?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'market_id',
    label: 'Market id',
    placeholder: 'cl-es',
    hint: '2-32 lower-case letters, digits or dashes; cannot change later',
    required: true,
  },
  {
    key: 'name',
    label: 'Name',
    placeholder: 'Chile (Spanish)',
    hint: 'Defaults to "Country (Language)"',
  },
  {
    key: 'country',
    label: 'Country code',
    placeholder: 'CL',
    hint: 'ISO 3166-1 alpha-2',
    required: true,
  },
  {
    key: 'country_name',
    label: 'Country name',
    placeholder: 'Chile',
    hint: 'In English, as search providers name it',
    required: true,
  },
  {
    key: 'language',
    label: 'Language tag',
    placeholder: 'es-CL',
    hint: 'BCP 47',
    required: true,
  },
  {
    key: 'language_name',
    label: 'Language name',
    placeholder: 'Spanish',
    required: true,
  },
  {
    key: 'currency',
    label: 'Currency',
    placeholder: 'CLP',
    hint: 'ISO 4217',
    required: true,
  },
  {
    key: 'timezone',
    label: 'Time zone',
    placeholder: 'America/Santiago',
    hint: 'IANA time zone',
    required: true,
  },
  {
    key: 'city',
    label: 'City',
    placeholder: 'Santiago',
  },
  {
    key: 'region',
    label: 'Region',
    placeholder: 'Santiago Metropolitan',
  },
  {
    key: 'lat',
    label: 'Latitude',
    placeholder: '-33.45',
    hint: 'Optional; give it together with the longitude',
  },
  {
    key: 'lng',
    label: 'Longitude',
    placeholder: '-70.66',
  },
];

const INPUT_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100';

interface MarketFormProps {
  /** The market being edited; `null` adds a new one. */
  readonly market: Market | null;
  /** The rest of the list, so a duplicate id is refused here. */
  readonly others: readonly Market[];
  readonly saving: boolean;
  readonly onSubmit: (market: Market) => void;
  readonly onCancel: () => void;
}

interface BrandListFieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function BrandListField({
  id, label, hint, value, onChange
}: BrandListFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea id={id} rows={3} value={value} onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`} className={INPUT_CLASS} />
      <p id={`${id}-hint`} className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );
}

/** Add or edit one market; the check mirrors the server's, so a save the form allows is not refused for its fields. */
export function MarketForm({
  market, others, saving, onSubmit, onCancel
}: MarketFormProps) {
  const idPrefix = useId();
  const {
    values, updateValue
  } = useFormValues<MarketFormValues>(() => (market === null ? emptyMarketFormValues() : marketFormValues(market)));
  const [problem, setProblem] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = marketFromForm(values, others);
    setProblem(result.error);
    if (result.market !== null) onSubmit(result.market);
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={market === null ? 'Add market' : `Edit ${market.name}`}
      className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <fieldset disabled={saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="sr-only">Market details</legend>
        {FIELDS.map((field) => {
          const id = `${idPrefix}-${field.key}`;
          return (
            <div key={field.key}>
              <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}{field.required === true && <span className="text-gray-400"> (required)</span>}
              </label>
              <input id={id} type="text" value={values[field.key]} placeholder={field.placeholder}
                onChange={(event) => updateValue(field.key, event.target.value)}
                disabled={field.key === 'market_id' && market !== null}
                aria-describedby={field.hint === undefined ? undefined : `${id}-hint`}
                className={INPUT_CLASS} />
              {field.hint !== undefined && <p id={`${id}-hint`} className="text-xs text-gray-400 mt-1">{field.hint}</p>}
            </div>
          );
        })}
        <BrandListField id={`${idPrefix}-competitors`} label="Extra competitors" value={values.competitors}
          hint="One per line; tracked in this market on top of Brand tracking"
          onChange={(value) => updateValue('competitors', value)} />
        <BrandListField id={`${idPrefix}-aliases`} label="Local brand names" value={values.first_party_aliases}
          hint="One per line; how your brand is called in this market"
          onChange={(value) => updateValue('first_party_aliases', value)} />
      </fieldset>
      <ErrorAlert message={problem} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save market'}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
