import {
  useMemo, useState
} from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';

export const UNGROUPED_SECTION_ID = '__ungrouped__';

interface KeywordScopePickerProps {
  readonly keywords: Keyword[];
  readonly groups: KeywordGroup[];
  /** Selected keyword ids. */
  readonly selectedIds: readonly string[];
  readonly onChange: (selectedIds: string[]) => void;
  readonly disabled?: boolean;
}

interface Section {
  id: string;
  name: string;
  keywords: Keyword[];
}

/** Group keywords into one section per group plus an "Ungrouped" section. */
export function buildSections(keywords: Keyword[], groups: KeywordGroup[]): Section[] {
  const sections: Section[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    keywords: keywords.filter((keyword) => keyword.group_ids?.includes(group.id)),
  }));
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const ungrouped = keywords.filter(
    (keyword) => !(keyword.group_ids ?? []).some((groupId) => knownGroupIds.has(groupId))
  );
  if (ungrouped.length > 0) {
    sections.push({
      id: UNGROUPED_SECTION_ID,
      name: groups.length > 0 ? 'Ungrouped' : 'All keywords',
      keywords: ungrouped,
    });
  }
  return sections.filter((section) => section.keywords.length > 0);
}

function matchesSearch(keyword: Keyword, needle: string): boolean {
  return needle === '' || keyword.keyword.toLocaleLowerCase().includes(needle);
}

type SectionState = 'none' | 'some' | 'all';

function sectionState(section: Section, selected: Set<string>): SectionState {
  const count = section.keywords.filter((keyword) => selected.has(keyword.id)).length;
  if (count === 0) return 'none';
  return count === section.keywords.length ? 'all' : 'some';
}

/**
 * Multi-select keyword picker organised by keyword group. A keyword that sits
 * in several groups appears under each of them; selection is by id, so
 * ticking it anywhere ticks it everywhere. Replaces the flat checkbox grid
 * the execution page used, which required Cmd+F to find anything.
 */
export const KeywordScopePicker = ({
  keywords, groups, selectedIds, onChange, disabled = false,
}: KeywordScopePickerProps) => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const needle = search.trim().toLocaleLowerCase();

  const sections = useMemo(() => buildSections(keywords, groups), [keywords, groups]);
  const visibleSections = useMemo(
    () => sections
      .map((section) => ({
        ...section,
        keywords: section.keywords.filter((keyword) => matchesSearch(keyword, needle)),
      }))
      .filter((section) => section.keywords.length > 0),
    [sections, needle]
  );

  const toggleKeyword = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange([...next]);
  };

  const toggleSection = (section: Section) => {
    const next = new Set(selected);
    const everySelected = section.keywords.every((keyword) => next.has(keyword.id));
    for (const keyword of section.keywords) {
      if (everySelected) {
        next.delete(keyword.id);
      } else {
        next.add(keyword.id);
      }
    }
    onChange([...next]);
  };

  const toggleCollapsed = (sectionId: string) => {
    const next = new Set(collapsed);
    if (next.has(sectionId)) {
      next.delete(sectionId);
    } else {
      next.add(sectionId);
    }
    setCollapsed(next);
  };

  const allIds = keywords.map((keyword) => keyword.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 border-b border-gray-200">
        <input
          type="search"
          aria-label="Search keywords"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search keywords..."
          disabled={disabled}
          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{selected.size} of {keywords.length} selected</span>
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : allIds)}
            disabled={disabled || keywords.length === 0}
            className="text-gray-700 hover:text-gray-900 font-medium disabled:text-gray-300"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-200">
        {visibleSections.length === 0 && (
          <p className="p-4 text-sm text-gray-400">No keywords match your search.</p>
        )}
        {visibleSections.map((section) => {
          const state = sectionState(section, selected);
          const isCollapsed = collapsed.has(section.id);
          return (
            <section key={section.id} aria-label={section.name}>
              <div className="flex items-center gap-2 px-3 py-2 bg-white">
                <input
                  type="checkbox"
                  aria-label={`Select all in ${section.name}`}
                  checked={state === 'all'}
                  ref={(element) => { if (element) element.indeterminate = state === 'some'; }}
                  onChange={() => toggleSection(section)}
                  disabled={disabled}
                  className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                />
                <button
                  type="button"
                  onClick={() => toggleCollapsed(section.id)}
                  aria-expanded={!isCollapsed}
                  className="flex-1 flex items-center justify-between text-left text-sm font-medium text-gray-900"
                >
                  <span>{section.name}</span>
                  <span className="text-xs text-gray-400">{section.keywords.length} keyword{section.keywords.length === 1 ? '' : 's'}</span>
                </button>
              </div>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 px-3 pb-3">
                  {section.keywords.map((keyword) => (
                    <label key={`${section.id}:${keyword.id}`} className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(keyword.id)}
                        onChange={() => toggleKeyword(keyword.id)}
                        disabled={disabled}
                        className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                      />
                      <span className="text-sm text-gray-700 truncate">{keyword.keyword}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};
