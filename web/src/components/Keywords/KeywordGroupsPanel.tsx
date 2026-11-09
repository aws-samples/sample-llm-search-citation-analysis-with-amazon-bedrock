import { useState } from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';
import type { MutationOutcome } from '../../hooks/useKeywordGroups';
import { PlusIcon } from '../ui';
import { Button } from '../ui/Button';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';
import {
  GroupMenu, GroupNameForm, KeywordGroupFilterItem
} from './KeywordGroupFilterItem';

/** The group name field that is open, if any. */
type OpenNameForm = { readonly kind: 'create' } | {
  readonly kind: 'rename';
  readonly groupId: string
} | null;

/** Placeholder filter rows while the groups load, so the column does not reflow. */
const GROUP_ROW_IDS = ['group-row-a', 'group-row-b', 'group-row-c'] as const;
/** Which keywords the list shows: everything, the ungrouped ones, or one group. */
export type GroupFilter = 'all' | 'ungrouped' | { groupId: string };

export function isGroupFilterFor(filter: GroupFilter, groupId: string): boolean {
  return typeof filter === 'object' && filter.groupId === groupId;
}

/** Keywords visible under the current group filter. */
export function filterKeywords(keywords: Keyword[], filter: GroupFilter, knownGroupIds: ReadonlySet<string>): Keyword[] {
  if (filter === 'all') return keywords;
  if (filter === 'ungrouped') {
    return keywords.filter((keyword) => !(keyword.group_ids ?? []).some((id) => knownGroupIds.has(id)));
  }
  return keywords.filter((keyword) => keyword.group_ids?.includes(filter.groupId));
}

interface KeywordGroupsPanelProps {
  readonly groups: KeywordGroup[];
  readonly loading: boolean;
  readonly totalKeywords: number;
  readonly ungroupedCount: number;
  readonly filter: GroupFilter;
  readonly onFilterChange: (filter: GroupFilter) => void;
  readonly onCreate: (name: string) => Promise<MutationOutcome>;
  readonly onRename: (id: string, name: string) => Promise<MutationOutcome>;
  readonly onDelete: (group: KeywordGroup) => void;
  readonly onNotify: (title: string, message: string, variant: 'success' | 'error') => void;
}

/**
 * The group filter beside the keyword table: All, Ungrouped and every group
 * with its count. "New group" opens a name field; each group's ⋯ renames or
 * deletes it. Deleting a group only detaches its keywords.
 */
export const KeywordGroupsPanel = ({
  groups, loading, totalKeywords, ungroupedCount, filter,
  onFilterChange, onCreate, onRename, onDelete, onNotify,
}: KeywordGroupsPanelProps) => {
  const [busy, setBusy] = useState(false);
  // One name field at a time: the new group's, or the rename of one group.
  const [openForm, setOpenForm] = useState<OpenNameForm>(null);

  /** Runs a create or rename; resolves whether it saved, and reports a refusal. */
  const submitName = async (mutate: () => Promise<MutationOutcome>, failureTitle: string): Promise<boolean> => {
    setBusy(true);
    try {
      const outcome = await mutate();
      if (!outcome.success) onNotify(failureTitle, outcome.message, 'error');
      return outcome.success;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Groups</h3>
        <Button variant="ghost" size="sm" className="-mr-2" leadingIcon={<PlusIcon className="w-4 h-4" />}
          onClick={() => setOpenForm({ kind: 'create' })}>
          New group
        </Button>
      </div>
      <ul aria-label="Filter keywords by group" className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
        {openForm?.kind === 'create' && (
          <GroupNameForm label="New group name" placeholder="e.g. Spring campaign" submitLabel="Create group" busy={busy}
            onSubmit={(name) => submitName(() => onCreate(name), 'Could not create group')}
            onCancel={() => setOpenForm(null)} />
        )}
        <KeywordGroupFilterItem name="All" count={totalKeywords} active={filter === 'all'} onSelect={() => onFilterChange('all')} />
        <KeywordGroupFilterItem name="Ungrouped" count={ungroupedCount} active={filter === 'ungrouped'}
          onSelect={() => onFilterChange('ungrouped')} />
        {loading && groups.length === 0 && (
          <li className="lg:w-full">
            <SkeletonRegion label="Loading groups" className="space-y-1">
              {GROUP_ROW_IDS.map((id) => <Skeleton key={id} className="h-8 w-full rounded-lg" />)}
            </SkeletonRegion>
          </li>
        )}
        {groups.map((group) => {
          const active = isGroupFilterFor(filter, group.id);
          return openForm?.kind === 'rename' && openForm.groupId === group.id ? (
            <GroupNameForm key={group.id} label={`Rename group ${group.name}`} initialName={group.name} submitLabel="Save" busy={busy}
              onSubmit={(name) => submitName(() => onRename(group.id, name), 'Could not rename group')}
              onCancel={() => setOpenForm(null)} />
          ) : (
            <KeywordGroupFilterItem key={group.id} name={group.name} count={group.keyword_count} active={active}
              title={group.description || group.name} onSelect={() => onFilterChange({ groupId: group.id })}
              menu={<GroupMenu group={group} active={active}
                onRename={() => setOpenForm({
                  kind: 'rename',
                  groupId: group.id
                })} onDelete={() => onDelete(group)} />} />
          );
        })}
      </ul>
      <p className="text-xs text-gray-500">
        Group keywords by brand, market, campaign or location. A keyword can belong to several groups.
      </p>
    </div>
  );
};
