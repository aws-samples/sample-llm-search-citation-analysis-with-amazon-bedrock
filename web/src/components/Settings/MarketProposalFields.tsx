import { useId } from 'react';
import type { MarketProposalRequest } from '../../types';
import {
  countryOptions, languageOptions, type LocaleOption
} from './marketLocales';

const SELECT_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100';
const INPUT_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100';

const COUNTRIES = countryOptions();
const LANGUAGES = languageOptions();

/** What the administrator decides; everything else is proposed. */
export interface MarketChoice {
  readonly country: string;
  readonly language: string;
  readonly city: string;
}

export const EMPTY_CHOICE: MarketChoice = {
  country: '',
  language: '',
  city: '',
};

/** The proposal request for a complete choice, `null` while the country or language is missing. */
export function proposalRequest(choice: MarketChoice): MarketProposalRequest | null {
  if (choice.country === '' || choice.language === '') return null;
  const city = choice.city.trim();
  return {
    country: choice.country,
    language: choice.language,
    ...(city === '' ? {} : { city }),
  };
}

/** Whether two requests ask for the same market (a blank city and no city are the same). */
export function sameRequest(a: MarketProposalRequest, b: MarketProposalRequest): boolean {
  return a.country === b.country && a.language === b.language && (a.city ?? '') === (b.city ?? '');
}

interface ChoiceSelectProps {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly options: readonly LocaleOption[];
  readonly value: string;
  readonly onChange: (code: string) => void;
}

/** One required choice from a list named in English, with a prompt as the empty option. */
function ChoiceSelect({
  id, label, prompt, options, value, onChange
}: ChoiceSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label} <span className="text-gray-400">(required)</span>
      </label>
      <select id={id} value={value} className={SELECT_CLASS} onChange={(event) => onChange(event.target.value)}>
        <option value="">{prompt}</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
      </select>
    </div>
  );
}

interface MarketProposalFieldsProps {
  readonly choice: MarketChoice;
  readonly disabled: boolean;
  readonly onChange: (choice: MarketChoice) => void;
}

/**
 * The first step of adding a market: country and language from lists named
 * by the browser (in English, as the engines are instructed) and an optional
 * city; the form asks Bedrock for everything else from these.
 */
export function MarketProposalFields({
  choice, disabled, onChange
}: MarketProposalFieldsProps) {
  const idPrefix = useId();
  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <legend className="sr-only">Where keywords of this market are asked from</legend>
      <ChoiceSelect id={`${idPrefix}-country`} label="Country" prompt="Choose a country" options={COUNTRIES}
        value={choice.country} onChange={(country) => onChange({
          ...choice,
          country,
        })} />
      <ChoiceSelect id={`${idPrefix}-language`} label="Language" prompt="Choose a language" options={LANGUAGES}
        value={choice.language} onChange={(language) => onChange({
          ...choice,
          language,
        })} />
      <div>
        <label htmlFor={`${idPrefix}-city`} className="block text-sm font-medium text-gray-700 mb-1">City</label>
        <input id={`${idPrefix}-city`} type="text" value={choice.city} placeholder="Largest city when empty"
          className={INPUT_CLASS} onChange={(event) => onChange({
            ...choice,
            city: event.target.value,
          })} />
      </div>
    </fieldset>
  );
}
