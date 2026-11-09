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
  filterKeywords, isGroupFilterFor
} from './KeywordGroupsPanel';
import type { GroupFilter } from './KeywordGroupsPanel';
import { useKeywordMarketState } from './useKeywordMarketState';
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

export type DeleteTarget =
  | {
    kind: 'keyword';
    id: string
  }
  | {
    kind: 'group';
    group: KeywordGroup
  }
  | null;

/**
 * The state and handlers behind the keyword manager: entry (single and bulk),
 * rename, delete, status, groups and the market state. The component only
 * lays them out.
 */
export function useKeywordsManager(keywords: Keyword[], setKeywords: (keywords: Keyword[]) => void) {
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
  const market = useKeywordMarketState(keywords);

  // The setter we receive is not guaranteed to accept functional updates, so
  // membership responses are merged against the latest keywords via a ref.
  const keywordsRef = useRef(keywords);
  keywordsRef.current = keywords;
  const applyUpdatedKeywords = useCallback((updated: Keyword[]) => {
    setKeywords(mergeUpdatedKeywords(keywordsRef.current, updated));
  }, [setKeywords]);

  const {
    groups, loading: groupsLoading, refresh: refreshGroups, createGroup, renameGroup, removeGroup, changeMemberships
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

  /** The trimmed entry, or null when it is blank or (after an alert) a duplicate. */
  const acceptedKeyword = (entry: string, editingKeywordId?: string): string | null => {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (isDuplicateKeyword(trimmed, keywords, editingKeywordId)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return null;
    }
    return trimmed;
  };

  const addKeyword = async () => {
    const trimmed = acceptedKeyword(newKeyword);
    if (trimmed === null) return;

    setSaving(true);
    try {
      const response = await apiPost<unknown>(
        '/keywords',
        buildCreateKeywordBody(trimmed, targetGroupIds, market.newMarketId),
        { allowStructured4xx: true }
      );
      const data = parseKeywordResponse(response);
      setKeywords([data, ...keywords]);
      setNewKeyword('');
      // The new keyword joined the selected group: its count changed.
      if (targetGroupIds.length > 0) await refreshGroups();
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
        results.push(await processBulkKeyword(keyword, targetGroupIds, market.newMarketId));
      }

      const {
        addedKeywords, failures
      } = collectBulkResults(results);

      if (addedKeywords.length > 0) {
        setKeywords([...addedKeywords, ...keywords]);
        if (targetGroupIds.length > 0) await refreshGroups();
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
    const trimmed = acceptedKeyword(editText, id);
    if (trimmed === null) return;

    setSaving(true);
    try {
      const response = await apiPut<unknown>(
        `/keywords/${id}`,
        market.controls ? {
          keyword: trimmed,
          market_id: market.editMarketId,
        } : { keyword: trimmed },
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
    const removed = keywords.find((item) => item.id === id);
    setKeywords(keywords.filter((item) => item.id !== id));
    // The keyword left its groups: their counts changed.
    if ((removed?.group_ids?.length ?? 0) > 0) await refreshGroups();
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
    market.setEditMarketId(keyword.market_id ?? '');
  };

  const emptyMessage = filter === 'all'
    ? undefined
    : 'No keywords in this view. Add one above, or tick keywords in "All" and use "Add to group".';

  return {
    newKeyword,
    setNewKeyword,
    bulkKeywords,
    setBulkKeywords,
    isBulkMode,
    setIsBulkMode,
    editingId,
    setEditingId,
    editText,
    setEditText,
    saving,
    filter,
    setFilter,
    bulkSelectedIds,
    setBulkSelectedIds,
    groupMenuKeywordId,
    setGroupMenuKeywordId,
    deleteTarget,
    setDeleteTarget,
    alertModal,
    showAlert,
    closeAlert,
    market,
    keywordsRef,
    groups,
    groupsLoading,
    createGroup,
    renameGroup,
    visibleKeywords,
    ungroupedCount,
    selectedKeywords,
    pausedSelectedCount,
    emptyMessage,
    addKeyword,
    addBulkKeywords,
    updateKeyword,
    setKeywordStatus,
    confirmDelete,
    toggleMembership,
    applyBulk,
    toggleBulkSelect,
    startEdit,
  };
}
