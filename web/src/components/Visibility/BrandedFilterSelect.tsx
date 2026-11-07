import type { ChangeEvent } from 'react';
import type { BrandedFilter } from '../../hooks/useVisibilityMetrics';

const OPTIONS: ReadonlyArray<{
  readonly value: BrandedFilter;
  readonly label: string;
}> = [
  {
    value: 'all',
    label: 'All queries',
  },
  {
    value: 'neutral',
    label: 'Queries without your brand',
  },
  {
    value: 'branded',
    label: 'Queries naming your brand',
  },
];

function isBrandedFilter(value: string): value is BrandedFilter {
  return OPTIONS.some((option) => option.value === value);
}

interface Props {
  readonly value: BrandedFilter;
  readonly onChange: (value: BrandedFilter) => void;
}

/**
 * Picks which answers the Visibility tab measures. A query that names your
 * brand gets answers that mention it almost by construction, so the queries
 * without your brand show how visible it is to people who did not ask for it.
 */
export function BrandedFilterSelect({
  value, onChange
}: Props) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (isBrandedFilter(event.target.value)) onChange(event.target.value);
  };

  return (
    <div>
      <label htmlFor="visibility-branded-filter" className="block text-xs font-medium text-gray-500 mb-1.5">Queries</label>
      <select
        id="visibility-branded-filter"
        name="visibility-branded-filter"
        value={value}
        onChange={handleChange}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 text-sm bg-gray-50"
      >
        {OPTIONS.map(({
          value: optionValue, label
        }) => (
          <option key={optionValue} value={optionValue}>{label}</option>
        ))}
      </select>
    </div>
  );
}
