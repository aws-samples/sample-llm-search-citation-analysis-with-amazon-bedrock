import {
  useId, useMemo, useState
} from 'react';
import type {
  AnalysisScope, Keyword, KeywordGroup
} from '../../types';
import {
  cappedSectionSelection, knownIdsInInputOrder
} from './KeywordScopePicker-selection';

function ungroupedSectionId(): string {
  return '__ungrouped__';
}

type AnalysisScopeMode = AnalysisScope['mode'];

interface SharedKeywordScopePickerProps {
  readonly idPrefix: string;
  readonly name: string;
  readonly keywords: Keyword[];
  readonly groups: KeywordGroup[];
  readonly disabled?: boolean;
}

interface LegacyKeywordScopePickerProps extends SharedKeywordScopePickerProps {
  /** Selected keyword ids. */
  readonly selectedIds: readonly string[];
  readonly onChange: (selectedIds: string[]) => void;
  readonly scope?: never;
  readonly allowedModes?: never;
  readonly maxGroups?: never;
  readonly maxKeywords?: never;
}

interface ScopedKeywordScopePickerProps extends SharedKeywordScopePickerProps {
  readonly scope: AnalysisScope;
  readonly onChange: (scope: AnalysisScope) => void;
  readonly allowedModes?: readonly AnalysisScopeMode[];
  readonly maxGroups?: number;
  readonly maxKeywords?: number;
  readonly selectedIds?: never;
}

export type KeywordScopePickerProps =
  | LegacyKeywordScopePickerProps
  | ScopedKeywordScopePickerProps;

interface Section {
  id: string;
  name: string;
  keywords: Keyword[];
}

type KeywordIdPickerProps = SharedKeywordScopePickerProps & {
  readonly selectedIds: readonly string[];
  readonly onChange: (selectedIds: string[]) => void;
  readonly maxSelected?: number;
};

type GroupIdPickerProps = {
  readonly groups: KeywordGroup[];
  readonly selectedIds: readonly string[];
  readonly onChange: (selectedIds: string[]) => void;
  readonly maxSelected?: number;
  readonly disabled: boolean;
};

function defaultAllowedModes(): readonly AnalysisScopeMode[] {
  return ['all', 'groups', 'keywords'];
}

function modeLabel(mode: AnalysisScopeMode): string {
  return mode.charAt(0).toLocaleUpperCase() + mode.slice(1);
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
  sections.push({
    id: ungroupedSectionId(),
    name: groups.length > 0 ? 'Ungrouped' : 'All keywords',
    keywords: ungrouped,
  });
  return sections.filter((section) => section.keywords.length > 0);
}

function matchesSearch(keyword: Keyword, needle: string): boolean {
  return keyword.keyword.toLocaleLowerCase().includes(needle);
}

type SectionState = 'none' | 'some' | 'all';

function sectionState(section: Section, selected: Set<string>): SectionState {
  const count = section.keywords.filter((keyword) => selected.has(keyword.id)).length;
  if (count === 0) return 'none';
  return count === section.keywords.length ? 'all' : 'some';
}

function hasSelectionCap(maxSelected: number | undefined): maxSelected is number {
  return Number.isFinite(maxSelected);
}

function selectionLimit(maxSelected: number, itemCount: number): number {
  return Math.min(itemCount, Math.max(0, Math.floor(maxSelected)));
}

function effectiveSelectionLimit(
  maxSelected: number | undefined,
  itemCount: number
): number {
  return hasSelectionCap(maxSelected) ? selectionLimit(maxSelected, itemCount) : itemCount;
}

function globalSelectionLabel(selectionComplete: boolean, capped: boolean, targetCount: number): string {
  if (selectionComplete) return 'Clear all';
  return capped ? `Select first ${targetCount}` : 'Select all';
}

function sectionSelectionTargetCount(
  section: Section, selected: Set<string>, maxSelectionCount: number
): number {
  const sectionIds = new Set(section.keywords.map((keyword) => keyword.id));
  const selectedOutsideSection = [...selected].filter((id) => !sectionIds.has(id)).length;
  return Math.min(sectionIds.size, Math.max(0, maxSelectionCount - selectedOutsideSection));
}

function sectionSelectionLabel(section: Section, targetCount: number): string {
  if (targetCount >= section.keywords.length) return `Select all in ${section.name}`;
  return `Select first ${targetCount} in ${section.name}`;
}

function keywordCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'keyword' : 'keywords'}`;
}

function emptyScopeForMode(mode: AnalysisScopeMode): AnalysisScope {
  if (mode === 'all') return { mode: 'all' };
  if (mode === 'groups') return {
    mode: 'groups',
    group_ids: [],
  };
  return {
    mode: 'keywords',
    keyword_ids: [],
  };
}

function isScopedKeywordScopePickerProps(
  props: KeywordScopePickerProps
): props is ScopedKeywordScopePickerProps {
  return props.scope !== undefined;
}

function GroupIdPicker({
  groups, selectedIds, onChange, maxSelected, disabled,
}: GroupIdPickerProps) {
  const groupIds = groups.map((group) => group.id);
  const selected = new Set(knownIdsInInputOrder(groupIds, selectedIds));
  const capped = hasSelectionCap(maxSelected);
  const maxSelectionCount = effectiveSelectionLimit(maxSelected, groupIds.length);
  const toggleGroup = (groupId: string) => {
    const next = new Set(selected);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    onChange(knownIdsInInputOrder(groupIds, [...next]));
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50">
      <div className="p-3 border-b border-gray-200 text-sm text-gray-500">
        {selected.size} of {groups.length} groups selected
      </div>
      <fieldset className="border-0 p-0 m-0">
        <legend className="sr-only">Keyword groups</legend>
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-200">
          {groups.length === 0 && <p className="p-4 text-sm text-gray-400">No keyword groups available.</p>}
          {groups.map((group) => {
            const isSelected = selected.has(group.id);
            const selectionLimitReached = capped && selected.size >= maxSelectionCount;
            return (
              <label key={group.id} className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" aria-label={group.name} checked={isSelected}
                  onChange={() => toggleGroup(group.id)}
                  disabled={disabled || (!isSelected && selectionLimitReached)}
                  className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                <span className="flex-1 text-sm text-gray-700">{group.name}</span>
                <span className="text-xs text-gray-400">{keywordCountLabel(group.keyword_count)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

/** Grouped, searchable ID picker shared by legacy and scoped keyword selection. */
function KeywordIdPicker({
  idPrefix, name, keywords, groups, selectedIds, onChange, disabled = false, maxSelected,
}: KeywordIdPickerProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allIds = useMemo(() => keywords.map((keyword) => keyword.id), [keywords]);
  const selected = useMemo(
    () => new Set(knownIdsInInputOrder(allIds, selectedIds)),
    [allIds, selectedIds]
  );
  const needle = search.trim().toLocaleLowerCase();
  const searchId = `${idPrefix}-search`;
  const sectionName = `${idPrefix}-section-ids`;
  const capped = hasSelectionCap(maxSelected);
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
  const maxSelectionCount = effectiveSelectionLimit(maxSelected, allIds.length);
  const globalSelectionIsCapped = capped && maxSelectionCount < allIds.length;
  const globalTargetIds = globalSelectionIsCapped ? allIds.slice(0, maxSelectionCount) : allIds;
  const globalSelectionComplete = globalTargetIds.length > 0
    && globalTargetIds.every((id) => selected.has(id))
    && (!globalSelectionIsCapped || selected.size === globalTargetIds.length);
  const selectionAtLimit = capped && selected.size >= maxSelectionCount;

  const toggleKeyword = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(knownIdsInInputOrder(allIds, [...next]));
  };
  const toggleSection = (section: Section) => {
    onChange(cappedSectionSelection(
      allIds,
      [...selected],
      section.keywords.map((keyword) => keyword.id),
      maxSelectionCount
    ));
  };
  const toggleCollapsed = (sectionId: string) => {
    const next = new Set(collapsed);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    setCollapsed(next);
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 border-b border-gray-200">
        <label htmlFor={searchId} className="sr-only">Search keywords</label>
        <input id={searchId} name={searchId} type="search" value={search}
          onChange={(event) => setSearch(event.target.value)} placeholder="Search keywords..."
          disabled={disabled}
          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{selected.size} of {keywords.length} selected</span>
          <button type="button" onClick={() => onChange(globalSelectionComplete ? [] : globalTargetIds)}
            disabled={disabled || keywords.length === 0 || (capped && maxSelectionCount === 0)}
            className="text-gray-700 hover:text-gray-900 font-medium disabled:text-gray-300">
            {globalSelectionLabel(globalSelectionComplete, globalSelectionIsCapped, maxSelectionCount)}
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-200">
        {visibleSections.length === 0 && <p className="p-4 text-sm text-gray-400">No keywords match your search.</p>}
        {visibleSections.map((section) => {
          const state = sectionState(section, selected);
          const isCollapsed = collapsed.has(section.id);
          const sectionCheckboxId = `${idPrefix}-section-${section.id}`;
          const targetCount = capped
            ? sectionSelectionTargetCount(section, selected, maxSelectionCount)
            : section.keywords.length;
          const sectionCannotSelect = state === 'none' && targetCount === 0;
          return (
            <section key={section.id} aria-label={section.name}>
              <div className="flex items-center gap-2 px-3 py-2 bg-white">
                <label htmlFor={sectionCheckboxId} className="sr-only">
                  {sectionSelectionLabel(section, targetCount)}
                </label>
                <input id={sectionCheckboxId} name={sectionName} value={section.id} type="checkbox"
                  checked={state === 'all'}
                  ref={(element) => { if (element) element.indeterminate = state === 'some'; }}
                  onChange={() => toggleSection(section)} disabled={disabled || sectionCannotSelect}
                  className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                <button type="button" onClick={() => toggleCollapsed(section.id)}
                  aria-expanded={!isCollapsed}
                  className="flex-1 flex items-center justify-between text-left text-sm font-medium text-gray-900">
                  <span>{section.name}</span>
                  <span className="text-xs text-gray-400">{keywordCountLabel(section.keywords.length)}</span>
                </button>
              </div>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 px-3 pb-3">
                  {section.keywords.map((keyword) => {
                    const keywordId = `${idPrefix}-section-${section.id}-keyword-${keyword.id}`;
                    const isSelected = selected.has(keyword.id);
                    return (
                      // Stryker disable next-line StringLiteral: React uses this only for reconciliation identity; the rendered label and selection behavior are unchanged.
                      <label key={`${section.id}:${keyword.id}`} htmlFor={keywordId} className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer">
                        <input id={keywordId} name={name} value={keyword.id} type="checkbox" checked={isSelected}
                          onChange={() => toggleKeyword(keyword.id)}
                          disabled={disabled || (!isSelected && selectionAtLimit)}
                          className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                        <span className="text-sm text-gray-700 truncate">{keyword.keyword}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ScopedIdPicker({
  idPrefix,
  name,
  keywords,
  groups,
  scope,
  onChange,
  allowedModes,
  maxGroups,
  maxKeywords,
  disabled,
}: Required<Pick<ScopedKeywordScopePickerProps, 'allowedModes' | 'disabled'>>
& Omit<ScopedKeywordScopePickerProps, 'allowedModes' | 'disabled'>) {
  if (!allowedModes.includes(scope.mode)) return null;
  if (scope.mode === 'groups') {
    const groupIds = knownIdsInInputOrder(
      groups.map((group) => group.id),
      scope.group_ids
    );
    return (
      <GroupIdPicker
        groups={groups}
        selectedIds={groupIds}
        onChange={(nextGroupIds) => onChange({
          mode: 'groups',
          group_ids: nextGroupIds,
        })}
        maxSelected={maxGroups}
        disabled={disabled}
      />
    );
  }
  if (scope.mode === 'keywords') {
    const keywordIds = knownIdsInInputOrder(
      keywords.map((keyword) => keyword.id),
      scope.keyword_ids
    );
    return (
      <KeywordIdPicker
        idPrefix={idPrefix}
        name={name}
        keywords={keywords}
        groups={groups}
        selectedIds={keywordIds}
        onChange={(nextKeywordIds) => onChange({
          mode: 'keywords',
          keyword_ids: nextKeywordIds,
        })}
        maxSelected={maxKeywords}
        disabled={disabled}
      />
    );
  }
  return null;
}

function ScopedKeywordScopePicker({
  idPrefix, name, keywords, groups, scope, onChange, allowedModes = defaultAllowedModes(),
  maxGroups, maxKeywords, disabled = false,
}: ScopedKeywordScopePickerProps) {
  const modeControlName = `keyword-scope-mode-${useId()}`;
  const displayedModes = defaultAllowedModes().filter((mode) => allowedModes.includes(mode));

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Scope mode" className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Scope</span>
        {displayedModes.map((mode) => (
          <label key={mode} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name={modeControlName} checked={scope.mode === mode}
              onChange={() => onChange(emptyScopeForMode(mode))} disabled={disabled}
              className="w-4 h-4 text-gray-900 border-gray-300 focus:ring-gray-900" />
            <span>{modeLabel(mode)}</span>
          </label>
        ))}
      </div>
      <ScopedIdPicker
        idPrefix={idPrefix}
        name={name}
        keywords={keywords}
        groups={groups}
        scope={scope}
        onChange={onChange}
        allowedModes={allowedModes}
        maxGroups={maxGroups}
        maxKeywords={maxKeywords}
        disabled={disabled}
      />
    </div>
  );
}

export function KeywordScopePicker(props: LegacyKeywordScopePickerProps): React.ReactElement;
export function KeywordScopePicker(props: ScopedKeywordScopePickerProps): React.ReactElement;
export function KeywordScopePicker(props: KeywordScopePickerProps): React.ReactElement {
  if (isScopedKeywordScopePickerProps(props)) return <ScopedKeywordScopePicker {...props} />;
  return (
    <KeywordIdPicker idPrefix={props.idPrefix} name={props.name} keywords={props.keywords} groups={props.groups}
      selectedIds={props.selectedIds} onChange={props.onChange} disabled={props.disabled} />
  );
}
