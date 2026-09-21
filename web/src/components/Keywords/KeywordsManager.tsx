import {
  useCallback, useMemo, useRef, useState
} from 'react';
import {
  apiDelete, apiPost, apiPut
} from '../../api/client';
import type {
  Keyword, KeywordGroup
} from '../../types';
import { useAlertModal } from '../../hooks/useAlertModal';
import {
  mergeUpdatedKeywords, useKeywordGroups
} from '../../hooks/useKeywordGroups';
import {
  ConfirmModal, AlertModal
} from '../ui/Modal';
import {
  KeywordInputSection,
  KeywordList,
} from './KeywordsManagerComponents';
import {
  KeywordGroupsPanel, isGroupFilterFor
} from './KeywordGroupsPanel';
import type { GroupFilter } from './KeywordGroupsPanel';
import { BulkGroupBar } from './KeywordGroupAssignment';
import {
  CREATE_ERROR_MESSAGE,
  UPDATE_ERROR_MESSAGE,
  ACTIVE_KEYWORD_STATUS,
  DELETE_ERROR_MESSAGE,
  PAUSED_KEYWORD_STATUS,
  STATUS_ERROR_MESSAGE,
  buildBulkMessage,
  buildCreateKeywordBody,
  collectBulkResults,
  getBulkAlert,
  getSafeErrorMessage,
  isDuplicateKeyword,
  isKeywordActive,
  parseBulkKeywords,
  parseKeywordResponse,
  processBulkKeyword,
} from './keywordEntry';
import type { BulkKeywordResult } from './keywordEntry';

interface KeywordsManagerProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
}

type DeleteTarget =
  | {
    kind: 'keyword';
    id: string 
  }
  | {
    kind: 'group';
    group: KeywordGroup 
  }
  | null;

/** Keywords visible under the current group filter. */
export function filterKeywords(keywords: Keyword[], filter: GroupFilter, knownGroupIds: ReadonlySet<string>): Keyword[] {
  if (filter === 'all') return keywords;
  if (filter === 'ungrouped') {
    return keywords.filter((keyword) => !(keyword.group_ids ?? []).some((id) => knownGroupIds.has(id)));
  }
  return keywords.filter((keyword) => keyword.group_ids?.includes(filter.groupId));
}

export const KeywordsManager = ({
  keywords, setKeywords
}: KeywordsManagerProps) => {
  const [newKeyword, setNewKeyword] = useState('');
  const [bulkKeywords, setBulkKeywords] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<GroupFilter>('all');
  const [bulkSelectedIds, setBulkSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [groupMenuKeywordId, setGroupMenuKeywordId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();

  // The setter we receive is not guaranteed to accept functional updates, so
  // membership responses are merged against the latest keywords via a ref.
  const keywordsRef = useRef(keywords);
  keywordsRef.current = keywords;
  const applyUpdatedKeywords = useCallback((updated: Keyword[]) => {
    setKeywords(mergeUpdatedKeywords(keywordsRef.current, updated));
  }, [setKeywords]);

  const {
    groups, loading: groupsLoading, createGroup, renameGroup, removeGroup, changeMemberships
  } = useKeywordGroups({ onKeywordsUpdated: applyUpdatedKeywords });

  const knownGroupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);
  const visibleKeywords = useMemo(
    () => filterKeywords(keywords, filter, knownGroupIds),
    [keywords, filter, knownGroupIds]
  );
  const ungroupedCount = useMemo(
    () => filterKeywords(keywords, 'ungrouped', knownGroupIds).length,
    [keywords, knownGroupIds]
  );
  // Keywords added while a group is selected land in that group.
  const targetGroupIds = typeof filter === 'object' ? [filter.groupId] : [];

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    if (isDuplicateKeyword(trimmed, keywords)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await apiPost<unknown>(
        '/keywords',
        buildCreateKeywordBody(trimmed, targetGroupIds),
        { allowStructured4xx: true }
      );
      const data = parseKeywordResponse(response);
      setKeywords([data, ...keywords]);
      setNewKeyword('');
    } catch (error) {
      console.error('Error adding keyword:', error);
      showAlert('Error', getSafeErrorMessage(error, CREATE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addBulkKeywords = async () => {
    if (!bulkKeywords.trim()) return;

    const keywordList = parseBulkKeywords(bulkKeywords);
    if (keywordList.length === 0) return;

    const duplicates = keywordList.filter((keyword) => isDuplicateKeyword(keyword, keywords));
    const newKeywordsToAdd = keywordList.filter((keyword) => !isDuplicateKeyword(keyword, keywords));

    if (newKeywordsToAdd.length === 0) {
      showAlert('All Duplicates', `All keywords already exist: ${duplicates.join(', ')}`, 'error');
      return;
    }

    setSaving(true);
    try {
      const results: BulkKeywordResult[] = [];
      for (const keyword of newKeywordsToAdd) {
        results.push(await processBulkKeyword(keyword, targetGroupIds));
      }

      const {
        addedKeywords, failures
      } = collectBulkResults(results);

      if (addedKeywords.length > 0) {
        setKeywords([...addedKeywords, ...keywords]);
      }
      setBulkKeywords(failures.map(({ keyword }) => keyword).join('\n'));

      const alert = getBulkAlert(addedKeywords.length, failures.length);
      showAlert(
        alert.title,
        buildBulkMessage(addedKeywords.length, duplicates.length, failures),
        alert.variant
      );
    } finally {
      setSaving(false);
    }
  };

  const updateKeyword = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;

    if (isDuplicateKeyword(trimmed, keywords, id)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await apiPut<unknown>(
        `/keywords/${id}`,
        { keyword: trimmed },
        { allowStructured4xx: true }
      );
      const data = parseKeywordResponse(response);
      setKeywords(keywords.map((item) => (item.id === id ? data : item)));
      setEditingId(null);
      setEditText('');
    } catch (error) {
      console.error('Error updating keyword:', error);
      showAlert('Error', getSafeErrorMessage(error, UPDATE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteKeyword = async (id: string) => {
    await apiDelete<unknown>(`/keywords/${id}`, { allowStructured4xx: true });
    setKeywords(keywords.filter((item) => item.id !== id));
  };

  /**
   * Activate or pause keywords.
   *
   * Only the status changes: `keyword` is sent because the API requires it and
   * refuses a different canonical identity, which makes this a no-op on the
   * text. Each keyword is one PUT, so a partial failure leaves the successful
   * ones changed — reported rather than rolled back, since the alternative is
   * silently discarding work the user asked for.
   */
  const setKeywordStatus = async (targets: readonly Keyword[], active: boolean) => {
    if (targets.length === 0) return;
    const status = active ? ACTIVE_KEYWORD_STATUS : PAUSED_KEYWORD_STATUS;

    setSaving(true);
    try {
      const updated = new Map<string, Keyword>();
      const failures: string[] = [];
      for (const target of targets) {
        try {
          const response = await apiPut<unknown>(
            `/keywords/${target.id}`,
            {
              keyword: target.keyword,
              status,
            },
            { allowStructured4xx: true }
          );
          const data = parseKeywordResponse(response);
          updated.set(data.id, data);
        } catch (error) {
          console.error('Error changing keyword status:', error);
          failures.push(target.keyword);
        }
      }

      if (updated.size > 0) {
        setKeywords(keywords.map((item) => updated.get(item.id) ?? item));
        setBulkSelectedIds(new Set());
      }
      if (failures.length > 0) {
        showAlert(
          'Error',
          `${STATUS_ERROR_MESSAGE} for ${failures.length} of ${targets.length}: ${failures.join(', ')}`,
          'error'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedKeywords = keywords.filter((item) => bulkSelectedIds.has(item.id));
  const pausedSelectedCount = selectedKeywords.filter((item) => !isKeywordActive(item)).length;

  const deleteGroup = async (group: KeywordGroup) => {
    const outcome = await removeGroup(group.id);
    if (!outcome.success) {
      showAlert('Error', outcome.message, 'error');
      return;
    }
    if (isGroupFilterFor(filter, group.id)) setFilter('all');
    // Members keep existing; only their membership went away.
    setKeywords(keywords.map((item) => ({
      ...item,
      group_ids: item.group_ids?.filter((groupId) => groupId !== group.id),
    })));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.kind === 'keyword') {
        await deleteKeyword(deleteTarget.id);
      } else {
        await deleteGroup(deleteTarget.group);
      }
    } catch (error) {
      console.error('Error deleting:', error);
      showAlert('Error', getSafeErrorMessage(error, DELETE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const runMembershipChange = async (groupId: string, changes: {
    add?: string[];
    remove?: string[] 
  }) => {
    setSaving(true);
    try {
      const outcome = await changeMemberships(groupId, changes);
      if (!outcome.success) showAlert('Error', outcome.message, 'error');
      return outcome.success;
    } finally {
      setSaving(false);
    }
  };

  const toggleMembership = (keyword: Keyword, group: KeywordGroup, member: boolean) => {
    void runMembershipChange(group.id, member ? { remove: [keyword.id] } : { add: [keyword.id] });
  };

  const applyBulk = async (group: KeywordGroup, action: 'add' | 'remove') => {
    const ids = [...bulkSelectedIds];
    const ok = await runMembershipChange(group.id, action === 'add' ? { add: ids } : { remove: ids });
    if (ok) setBulkSelectedIds(new Set());
  };

  const toggleBulkSelect = (id: string) => {
    const next = new Set(bulkSelectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setBulkSelectedIds(next);
  };

  const startEdit = (keyword: Keyword) => {
    setEditingId(keyword.id);
    setEditText(keyword.keyword);
  };

  const emptyMessage = filter === 'all'
    ? undefined
    : 'No keywords in this view. Add one above, or tick keywords in "All" and use "Add to group".';

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <KeywordGroupsPanel
        groups={groups}
        loading={groupsLoading}
        totalKeywords={keywords.length}
        ungroupedCount={ungroupedCount}
        filter={filter}
        onFilterChange={(next) => { setFilter(next); setBulkSelectedIds(new Set()); }}
        onCreate={createGroup}
        onRename={renameGroup}
        onDelete={(group) => setDeleteTarget({
          kind: 'group',
          group 
        })}
        onNotify={showAlert}
      />

      <KeywordInputSection
        isBulkMode={isBulkMode}
        setIsBulkMode={setIsBulkMode}
        newKeyword={newKeyword}
        setNewKeyword={setNewKeyword}
        bulkKeywords={bulkKeywords}
        setBulkKeywords={setBulkKeywords}
        saving={saving}
        onAddKeyword={addKeyword}
        onAddBulkKeywords={addBulkKeywords}
      />

      <BulkGroupBar
        selectedCount={bulkSelectedIds.size}
        groups={groups}
        busy={saving}
        onAddToGroup={(group) => { void applyBulk(group, 'add'); }}
        onRemoveFromGroup={(group) => { void applyBulk(group, 'remove'); }}
        onClearSelection={() => setBulkSelectedIds(new Set())}
        pausedSelectedCount={pausedSelectedCount}
        onActivateSelected={() => {
          void setKeywordStatus(selectedKeywords.filter((item) => !isKeywordActive(item)), true);
        }}
        onPauseSelected={() => {
          void setKeywordStatus(selectedKeywords.filter(isKeywordActive), false);
        }}
      />

      <KeywordList
        keywords={visibleKeywords}
        editingId={editingId}
        editText={editText}
        setEditText={setEditText}
        onStartEdit={startEdit}
        onUpdateKeyword={updateKeyword}
        onCancelEdit={() => { setEditingId(null); setEditText(''); }}
        onDeleteKeyword={(id) => setDeleteTarget({
          kind: 'keyword',
          id 
        })}
        groups={groups}
        bulkSelectedIds={bulkSelectedIds}
        onToggleBulkSelect={toggleBulkSelect}
        groupMenuKeywordId={groupMenuKeywordId}
        onToggleGroupMenu={(id) => setGroupMenuKeywordId(groupMenuKeywordId === id ? null : id)}
        onToggleMembership={toggleMembership}
        membershipBusy={saving}
        emptyMessage={emptyMessage}
        onSetKeywordStatus={(keyword, active) => { void setKeywordStatus([keyword], active); }}
        statusBusy={saving}
      />

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={deleteTarget?.kind === 'group' ? 'Delete Keyword Group' : 'Delete Keyword'}
        message={deleteTarget?.kind === 'group'
          ? `Delete the group "${deleteTarget.group.name}"? Its keywords are kept; they just leave the group.`
          : 'Are you sure you want to delete this keyword?'}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <AlertModal {...alertModal} onClose={closeAlert} />
    </div>
  );
};
