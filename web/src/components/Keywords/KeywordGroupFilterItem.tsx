import {
  useState, type ReactNode
} from 'react';
import type { KeywordGroup } from '../../types';
import { ActionMenu } from '../ui/ActionMenu';
import { Button } from '../ui/Button';

const ITEM_BASE = 'w-full min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-9 rounded-lg text-sm text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900';

/**
 * Selected: the sidebar's open-page style (neutral fill, strong text); otherwise a quiet row.
 * Every row keeps room for the ⋯ on the right so the counts line up.
 */
function itemClass(active: boolean): string {
  const state = active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-700 hover:bg-gray-50';
  return `${ITEM_BASE} ${state}`;
}

/**
 * The ⋯ of a group: shown for the selected group, on hover, on keyboard focus,
 * while open and on touch screens; hidden otherwise so the list reads as names
 * and counts, not as a wall of icons.
 */
function menuTriggerClass(active: boolean): string {
  if (active) return '';
  return 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100';
}

interface KeywordGroupFilterItemProps {
  readonly name: string;
  readonly count: number;
  readonly active: boolean;
  readonly onSelect: () => void;
  /** Tooltip, e.g. the group's description. */
  readonly title?: string;
  /** Rename and delete; absent for All and Ungrouped. */
  readonly menu?: ReactNode;
}

/** One entry of the group filter: the name, its keyword count and an optional ⋯ menu. */
export const KeywordGroupFilterItem = ({
  name, count, active, onSelect, title, menu
}: KeywordGroupFilterItemProps) => (
  <li className="group/item relative flex items-center lg:w-full">
    <button type="button" aria-pressed={active} aria-label={`${name}, ${count} ${count === 1 ? 'keyword' : 'keywords'}`} onClick={onSelect} title={title ?? name} className={itemClass(active)}>
      <span className="flex-1 min-w-0 truncate">{name}</span>
      <span className="text-xs text-gray-500 tabular-nums">{count}</span>
    </button>
    {menu && <div className="absolute right-1 top-1/2 -translate-y-1/2">{menu}</div>}
  </li>
);

interface GroupMenuProps {
  readonly group: KeywordGroup;
  readonly active: boolean;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}

/** Rename and Delete for one group, behind its ⋯. */
export const GroupMenu = ({
  group, active, onRename, onDelete
}: GroupMenuProps) => (
  <ActionMenu
    label={`Actions for group ${group.name}`}
    triggerClassName={menuTriggerClass(active)}
    items={[
      {
        label: 'Rename',
        onSelect: onRename
      },
      {
        label: 'Delete',
        onSelect: onDelete,
        tone: 'danger'
      },
    ]}
  />
);

interface GroupNameFormProps {
  /** The text field's accessible name. */
  readonly label: string;
  readonly initialName?: string;
  readonly placeholder?: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  /** Resolves `true` once saved, which closes the form. */
  readonly onSubmit: (name: string) => Promise<boolean>;
  readonly onCancel: () => void;
}

/** The name field used to create and to rename a group: Enter saves, Escape cancels. */
export const GroupNameForm = ({
  label, initialName = '', placeholder, submitLabel, busy, onSubmit, onCancel
}: GroupNameFormProps) => {
  const [name, setName] = useState(initialName);
  const submit = () => {
    if (!name.trim() || busy) return;
    void onSubmit(name.trim()).then((saved) => { if (saved) onCancel(); });
  };
  return (
    <li className="w-full space-y-2 p-2 rounded-lg border border-gray-200 bg-white">
      <input
        type="text"
        aria-label={label}
        value={name}
        placeholder={placeholder}
        disabled={busy}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') onCancel();
        }}
        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy || !name.trim()}>{submitLabel}</Button>
      </div>
    </li>
  );
};
