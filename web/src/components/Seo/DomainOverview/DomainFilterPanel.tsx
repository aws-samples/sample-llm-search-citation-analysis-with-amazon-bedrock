import {
  useState, type FormEvent
} from 'react';
import { Button } from '../../ui/Button';
import {
  MAX_FILTER_CONDITIONS, type FilterForm
} from './domainFilters';

interface Props<TBound extends string> {
  readonly bounds: ReadonlyArray<{
    readonly id: TBound;
    readonly label: string;
  }>;
  readonly initial: FilterForm;
  /** How many of the 8 conditions a form uses (the scope's own slots included). */
  readonly countConditions: (form: FilterForm) => number;
  readonly busy: boolean;
  readonly onApply: (form: FilterForm) => void;
}

const INPUT_CLASS = 'w-full rounded border border-gray-300 px-2 py-1 text-sm';

/**
 * Include / exclude terms, a search and min / max bounds. Apply sends one
 * paid request; it is disabled over DataForSEO's 8 filter conditions, which
 * the server would refuse rather than drop.
 */
export function DomainFilterPanel<TBound extends string>({
  bounds, initial, countConditions, busy, onApply
}: Props<TBound>) {
  const [form, setForm] = useState<FilterForm>(initial);
  const count = countConditions(form);
  const overBudget = count > MAX_FILTER_CONDITIONS;
  const setBound = (side: 'min' | 'max', bound: TBound, value: string) => setForm((current) => ({
    ...current,
    [side]: {
      ...current[side],
      [bound]: value,
    },
  }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!overBudget) onApply(form);
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" aria-label="Filters">
      <label>
        <span className="block text-xs text-gray-600">Include terms</span>
        <input className={INPUT_CLASS} value={form.include} onChange={(event) => setForm({
          ...form,
          include: event.target.value,
        })} placeholder="shoes, red" />
      </label>
      <label>
        <span className="block text-xs text-gray-600">Exclude terms</span>
        <input className={INPUT_CLASS} value={form.exclude} onChange={(event) => setForm({
          ...form,
          exclude: event.target.value,
        })} />
      </label>
      <label className="col-span-2">
        <span className="block text-xs text-gray-600">Search</span>
        <input className={INPUT_CLASS} value={form.search} onChange={(event) => setForm({
          ...form,
          search: event.target.value,
        })} />
      </label>
      {bounds.map((bound) => (
        <fieldset key={bound.id} className="flex items-end gap-1">
          <legend className="text-xs text-gray-600">{bound.label}</legend>
          <input aria-label={`Minimum ${bound.label}`} inputMode="decimal" className={INPUT_CLASS} value={form.min[bound.id] ?? ''}
            onChange={(event) => setBound('min', bound.id, event.target.value)} placeholder="min" />
          <input aria-label={`Maximum ${bound.label}`} inputMode="decimal" className={INPUT_CLASS} value={form.max[bound.id] ?? ''}
            onChange={(event) => setBound('max', bound.id, event.target.value)} placeholder="max" />
        </fieldset>
      ))}
      <div className="col-span-2 md:col-span-4 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || overBudget}>Apply</Button>
        <span className={`text-xs ${overBudget ? 'text-red-700' : 'text-gray-500'}`}>
          {`${count} of ${MAX_FILTER_CONDITIONS} filter conditions${overBudget ? ': remove some to apply' : ''}`}
        </span>
      </div>
    </form>
  );
}
