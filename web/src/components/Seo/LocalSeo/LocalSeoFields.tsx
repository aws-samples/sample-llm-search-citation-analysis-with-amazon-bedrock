/** Form controls the local SEO tabs share: a labelled input, a select, a coordinate and a business identity. */
import { useId } from 'react';
import type { LocalSeoMarket } from '../../../hooks/useLocalSeoMarket';
import { marketHasPoint } from './localSeoSettings';
import {
  IDENTITY_LABELS, type IdentityInput, type IdentityKind, type PointInput
} from './localSeoRequest';

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900';
const IDENTITY_KINDS: readonly IdentityKind[] = ['name', 'cid', 'place_id'];

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly inputMode?: 'decimal' | 'numeric' | 'text';
  readonly className?: string;
  /** Values offered while typing (e.g. the market's Settings keywords). */
  readonly suggestions?: readonly string[];
}

export function TextField({
  label, value, onChange, placeholder, inputMode = 'text', className = '', suggestions = []
}: FieldProps) {
  const id = useId();
  const listId = `${id}-suggestions`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600">{label}</label>
      <input
        id={id}
        className={INPUT_CLASS}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined}
        onChange={(event) => { onChange(event.target.value); }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((entry) => <option key={entry} value={entry} />)}</datalist>
      )}
    </div>
  );
}

interface SelectFieldProps<TValue extends string> {
  readonly label: string;
  readonly value: TValue;
  readonly options: readonly {
    readonly value: TValue;
    readonly label: string 
  }[];
  readonly onChange: (value: TValue) => void;
}

export function SelectField<TValue extends string>({
  label, value, options, onChange
}: SelectFieldProps<TValue>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600">{label}</label>
      <select
        id={id}
        className={INPUT_CLASS}
        value={value}
        onChange={(event) => {
          const chosen = options.find((option) => option.value === event.target.value);
          if (chosen) onChange(chosen.value);
        }}
      >
        {options.map(({
          value: optionValue, label: optionLabel
        }) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </div>
  );
}

interface PointFieldsProps {
  readonly point: PointInput;
  readonly onChange: (point: PointInput) => void;
  readonly market: LocalSeoMarket;
}

/** Latitude and longitude; left empty, the header market's city coordinates are used. */
export function PointFields({
  point, onChange, market
}: PointFieldsProps) {
  const hint = marketHasPoint(market) ? `Optional (default: ${market.city ?? 'the market city'})` : 'Required';
  return (
    <>
      <TextField
        label="Latitude"
        inputMode="decimal"
        value={point.latitude}
        placeholder={hint}
        onChange={(latitude) => { onChange({
          ...point,
          latitude 
        }); }}
      />
      <TextField
        label="Longitude"
        inputMode="decimal"
        value={point.longitude}
        placeholder={hint}
        onChange={(longitude) => { onChange({
          ...point,
          longitude 
        }); }}
      />
    </>
  );
}

interface IdentityFieldsProps {
  readonly identity: IdentityInput;
  readonly onChange: (identity: IdentityInput) => void;
  readonly label?: string;
  /** Shown in the empty value field, e.g. what an empty field matches. */
  readonly placeholder?: string;
}

export function IdentityFields({
  identity, onChange, label = 'Business', placeholder
}: IdentityFieldsProps) {
  return (
    <>
      <SelectField
        label={`${label} by`}
        value={identity.kind}
        options={IDENTITY_KINDS.map((kind) => ({
          value: kind,
          label: IDENTITY_LABELS[kind] 
        }))}
        onChange={(kind) => { onChange({
          ...identity,
          kind 
        }); }}
      />
      <TextField
        label={IDENTITY_LABELS[identity.kind]}
        value={identity.value}
        placeholder={placeholder}
        onChange={(value) => { onChange({
          ...identity,
          value 
        }); }}
      />
    </>
  );
}
