import type { MarketFormValues } from './marketFormModel';

type TextKey = Exclude<keyof MarketFormValues, 'competitors' | 'first_party_aliases'>;

interface FieldSpec {
  readonly key: TextKey;
  readonly label: string;
  readonly placeholder: string;
  readonly hint?: string;
  readonly required?: boolean;
}

/** Every member of a market as an input, in the order the server reports a first problem. */
const DETAIL_FIELDS: readonly FieldSpec[] = [
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
    hint: 'In English, as the engines are instructed',
    required: true,
  },
  {
    key: 'language',
    label: 'Language tag',
    placeholder: 'es-CL',
    hint: 'BCP 47, with the regional variant',
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
    hint: 'ISO 4217; answers quote prices in it',
    required: true,
  },
  {
    key: 'timezone',
    label: 'Time zone',
    placeholder: 'America/Santiago',
    hint: 'IANA time zone of the city',
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
    placeholder: 'Región Metropolitana',
  },
  {
    key: 'lat',
    label: 'Latitude',
    placeholder: '-33.45',
    hint: 'Only Perplexity uses the coordinates; give both or neither',
  },
  {
    key: 'lng',
    label: 'Longitude',
    placeholder: '-70.66',
  },
];

const INPUT_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100';

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

interface MarketDetailFieldsProps {
  readonly idPrefix: string;
  readonly values: MarketFormValues;
  /** An existing market keeps its id. */
  readonly idLocked: boolean;
  readonly updateValue: <TField extends keyof MarketFormValues>(field: TField, value: MarketFormValues[TField]) => void;
}

/** Every member of a market, editable: the check step of a new market and the whole form of an existing one. */
export function MarketDetailFields({
  idPrefix, values, idLocked, updateValue
}: MarketDetailFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {DETAIL_FIELDS.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        return (
          <div key={field.key}>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}{field.required === true && <span className="text-gray-400"> (required)</span>}
            </label>
            <input id={id} type="text" value={values[field.key]} placeholder={field.placeholder}
              onChange={(event) => updateValue(field.key, event.target.value)}
              disabled={field.key === 'market_id' && idLocked}
              aria-describedby={field.hint === undefined ? undefined : `${id}-hint`}
              className={INPUT_CLASS} />
            {field.hint !== undefined && <p id={`${id}-hint`} className="text-xs text-gray-400 mt-1">{field.hint}</p>}
          </div>
        );
      })}
      <BrandListField id={`${idPrefix}-competitors`} label="Extra local competitors" value={values.competitors}
        hint="One per line. The competitors in Brand tracking already count in every market; add the ones that only exist here"
        onChange={(value) => updateValue('competitors', value)} />
      <BrandListField id={`${idPrefix}-aliases`} label="Local brand names" value={values.first_party_aliases}
        hint="One per line; the names your brand goes by in this market (a local subsidiary, an old name)"
        onChange={(value) => updateValue('first_party_aliases', value)} />
    </div>
  );
}
