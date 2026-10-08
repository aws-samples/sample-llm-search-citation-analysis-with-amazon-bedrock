import { useId } from 'react';
import type { UsersFilter } from './UsersFilter';

interface UsersToolbarProps {
  readonly filter: UsersFilter;
  readonly onChange: (filter: UsersFilter) => void;
  /** "14 people · 9 invites pending", or "Showing 3 of 14" while filtering. */
  readonly summary: string;
}

const CONTROL = 'p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900';

interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

const ROLE_CHOICES: readonly Choice<UsersFilter['role']>[] = [
  {
    value: 'all',
    label: 'All roles',
  },
  {
    value: 'admin',
    label: 'Admins',
  },
  {
    value: 'member',
    label: 'Members',
  },
];

const STATUS_CHOICES: readonly Choice<UsersFilter['status']>[] = [
  {
    value: 'all',
    label: 'All statuses',
  },
  {
    value: 'active',
    label: 'Active',
  },
  {
    value: 'pending',
    label: 'Invite pending',
  },
  {
    value: 'disabled',
    label: 'Disabled',
  },
  {
    value: 'attention',
    label: 'Needs attention',
  },
];

interface FilterSelectProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  /** Picked when the drop-down reports a value outside `choices`. */
  readonly fallback: T;
  readonly onChange: (value: T) => void;
}

/** A labelled drop-down over `choices`. */
function FilterSelect<T extends string>({
  label, value, choices, fallback, onChange
}: FilterSelectProps<T>) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const picked = choices.find((choice) => choice.value === event.target.value);
          onChange(picked?.value ?? fallback);
        }}
        className={CONTROL}
      >
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </>
  );
}

/** Email search, role and status filters, and the head count. */
export function UsersToolbar({
  filter, onChange, summary
}: UsersToolbarProps) {
  const searchId = useId();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={searchId} className="sr-only">Search by email</label>
      <input
        id={searchId}
        type="search"
        value={filter.query}
        onChange={(event) => onChange({
          ...filter,
          query: event.target.value,
        })}
        placeholder="Search by email"
        className={`${CONTROL} w-64 max-w-full`}
      />
      <FilterSelect
        label="Filter by role"
        value={filter.role}
        choices={ROLE_CHOICES}
        fallback="all"
        onChange={(role) => onChange({
          ...filter,
          role,
        })}
      />
      <FilterSelect
        label="Filter by status"
        value={filter.status}
        choices={STATUS_CHOICES}
        fallback="all"
        onChange={(status) => onChange({
          ...filter,
          status,
        })}
      />
      <p className="ml-auto text-sm text-gray-500">{summary}</p>
    </div>
  );
}
