import {
  useId, useState, type DragEvent
} from 'react';
import {
  Button, PlusIcon, SearchIcon
} from '../../../ui';
import {
  blockName, CATALOG_ENTRIES, type CatalogEntry
} from '../blockCatalog';
import {
  BLOCK_CATEGORIES, type BlockCategory
} from '../catalog/catalogTypes';

interface Props {
  /** Report sections already in the report; each may appear once. */
  readonly usedTypes: ReadonlySet<string>;
  /** The report holds the most blocks it may. */
  readonly full: boolean;
  readonly onAdd: (entry: CatalogEntry) => void;
  readonly onDragStart: (entry: CatalogEntry) => void;
  readonly onDragEnd: () => void;
}

type EntryHandlers = Omit<Props, 'usedTypes' | 'full'>;

/** Whether an entry can be added now, is a section already in the report, or waits for room. */
type EntryState = 'available' | 'added' | 'full';

interface EntryProps extends EntryHandlers {
  readonly entry: CatalogEntry;
  readonly state: EntryState;
}

function startDrag(event: DragEvent<HTMLElement>, label: string): void {
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('text/plain', label);
}

function CatalogItem({
  entry, state, onAdd, onDragStart, onDragEnd
}: EntryProps) {
  const available = state === 'available';
  const action = state === 'added' ? 'Added' : 'Add';
  return (
    <li
      draggable={available}
      onDragStart={(event) => {
        startDrag(event, entry.label);
        onDragStart(entry);
      }}
      onDragEnd={onDragEnd}
      className={`flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 ${available ? 'cursor-grab hover:border-gray-300' : 'opacity-60'}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{entry.label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{entry.description}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={!available}
        aria-label={`${action} ${blockName(entry.type)}`}
        leadingIcon={available ? <PlusIcon className="h-4 w-4" /> : undefined}
        onClick={() => onAdd(entry)}
      >
        {action}
      </Button>
    </li>
  );
}

interface ListProps extends EntryHandlers {
  readonly entries: readonly CatalogEntry[];
  readonly stateOf: (entry: CatalogEntry) => EntryState;
}

function EntryList({
  entries, stateOf, ...handlers
}: ListProps) {
  return (
    <ul className="mt-2 space-y-2">
      {entries.map((entry) => <CatalogItem key={entry.type} entry={entry} state={stateOf(entry)} {...handlers} />)}
    </ul>
  );
}

interface CategoryProps extends Omit<ListProps, 'entries'> {readonly category: BlockCategory;}

function CategorySection({
  category, ...list
}: CategoryProps) {
  const entries = CATALOG_ENTRIES.filter((entry) => entry.category === category.id);
  return (
    <details open={category.id === 'content'} className="group rounded-lg border border-gray-200 bg-gray-50 p-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
        {category.label}
        <span className="ml-2 text-xs font-normal text-gray-500">{entries.length}</span>
        <span className="mt-0.5 block text-xs font-normal text-gray-500">{category.description}</span>
      </summary>
      <EntryList entries={entries} {...list} />
    </details>
  );
}

function matches(entry: CatalogEntry, query: string): boolean {
  const category = BLOCK_CATEGORIES.find((candidate) => candidate.id === entry.category)?.label ?? '';
  return `${category} ${entry.label} ${entry.description}`.toLowerCase().includes(query);
}

/**
 * The blocks a report can hold, by category: the reader's own content
 * first, then the sections of every report. A block is added with its Add
 * button or dragged onto the report; a report section already in the report
 * shows as added.
 */
export function BlockCatalogPanel({
  usedTypes, full, ...handlers
}: Props) {
  const headingId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const stateOf = (entry: CatalogEntry): EntryState => {
    if (!entry.repeatable && usedTypes.has(entry.type)) return 'added';
    return full ? 'full' : 'available';
  };
  const search = query.trim().toLowerCase();
  const found = search === '' ? null : CATALOG_ENTRIES.filter((entry) => matches(entry, search));

  return (
    <aside aria-labelledby={headingId} className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div>
        <h3 id={headingId} className="text-lg font-semibold text-gray-900">Blocks</h3>
        <p className="text-xs text-gray-500">Click Add or drag a block onto your report.</p>
      </div>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">Find a block</label>
        <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Find a block"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
          className="w-full rounded-lg border border-gray-200 p-2 pl-8 text-sm focus:ring-2 focus:ring-gray-900"
        />
      </div>
      {full && <p className="text-xs text-amber-700">The report holds the most blocks it can. Remove one to add another.</p>}
      {found === null
        ? BLOCK_CATEGORIES.map((category) => (
          <CategorySection key={category.id} category={category} stateOf={stateOf} {...handlers} />
        ))
        : <FoundEntries found={found} stateOf={stateOf} {...handlers} />}
    </aside>
  );
}

function FoundEntries({
  found, ...list
}: Omit<ListProps, 'entries'> & { readonly found: readonly CatalogEntry[] }) {
  if (found.length === 0) return <p className="text-sm text-gray-500">No block matches your search.</p>;
  return <EntryList entries={found} {...list} />;
}
