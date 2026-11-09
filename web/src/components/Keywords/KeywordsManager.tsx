import type { Keyword } from '../../types';
import {
  ConfirmModal, AlertModal
} from '../ui/Modal';
import { KeywordAddBar } from './KeywordAddBar';
import { KeywordTable } from './KeywordTable';
import {
  KeywordGroupsPanel, isGroupFilterFor
} from './KeywordGroupsPanel';
import { BulkGroupBar } from './KeywordGroupAssignment';
import { AddToMarketsDialog } from './AddToMarketsDialog';
import { KeywordMarketSelect } from './KeywordMarketControls';
import { isKeywordActive } from './keywordEntry';
import { useKeywordsManager } from './useKeywordsManager';
import { useKeywordListPage } from './useKeywordListPage';
import {
  KeywordListPager, KeywordListSearch
} from './KeywordListSearch';

interface KeywordsManagerProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
}

/** `ids` added to (`selected`) or removed from `current`. */
function withPageSelection(current: ReadonlySet<string>, ids: string[], selected: boolean): Set<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (selected) next.add(id); else next.delete(id);
  }
  return next;
}

/** Why a narrowed view is empty: the search text, or else the status/market filters. */
function noMatchMessage(query: string): string {
  const needle = query.trim();
  return needle === '' ? 'No keywords match these filters.' : `No keywords match "${needle}".`;
}

/**
 * Settings › Keywords: the page header with the add bar, then the group
 * filter beside the keyword table.
 */
export const KeywordsManager = ({
  keywords, setKeywords
}: KeywordsManagerProps) => {
  const m = useKeywordsManager(keywords, setKeywords);
  const list = useKeywordListPage(m.visibleKeywords);
  const listEmptyMessage = list.narrowed && m.visibleKeywords.length > 0 ? noMatchMessage(list.query) : m.emptyMessage;

  return (
    // The Settings section already draws the card: bleed to its edges instead of nesting a second one.
    <div className="-m-4 sm:-m-6">
      <div className="p-4 sm:p-6 border-b border-gray-200 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Keywords</h2>
          <p className="text-sm text-gray-500">Analysis runs send every active keyword to each AI engine.</p>
        </div>
        <KeywordAddBar
          isBulkMode={m.isBulkMode}
          setIsBulkMode={m.setIsBulkMode}
          newKeyword={m.newKeyword}
          setNewKeyword={m.setNewKeyword}
          bulkKeywords={m.bulkKeywords}
          setBulkKeywords={m.setBulkKeywords}
          saving={m.saving}
          onAddKeyword={m.addKeyword}
          onAddBulkKeywords={m.addBulkKeywords}
          marketPicker={m.market.controls && (
            <KeywordMarketSelect id="new-keyword-market" label="Market for new keywords" prefix="in" value={m.market.newMarketId}
              markets={m.market.markets} onChange={m.market.setNewMarketId} disabled={m.saving} />
          )}
          targetGroupName={m.groups.find((group) => isGroupFilterFor(m.filter, group.id))?.name}
        />
      </div>

      <div className="p-4 sm:p-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <KeywordGroupsPanel
          groups={m.groups}
          loading={m.groupsLoading}
          totalKeywords={keywords.length}
          ungroupedCount={m.ungroupedCount}
          filter={m.filter}
          onFilterChange={(next) => { m.setFilter(next); m.setBulkSelectedIds(new Set()); list.setPage(1); }}
          onCreate={m.createGroup}
          onRename={m.renameGroup}
          onDelete={(group) => m.setDeleteTarget({
            kind: 'group',
            group
          })}
          onNotify={m.showAlert}
        />

        <div className="min-w-0 space-y-3">
          {m.visibleKeywords.length > 0 && (
            <KeywordListSearch list={list} totalCount={m.visibleKeywords.length} markets={m.market.controls?.markets} />
          )}
          <BulkGroupBar
            selectedCount={m.bulkSelectedIds.size}
            groups={m.groups}
            busy={m.saving}
            onAddToGroup={(group) => { void m.applyBulk(group, 'add'); }}
            onRemoveFromGroup={(group) => { void m.applyBulk(group, 'remove'); }}
            onClearSelection={() => m.setBulkSelectedIds(new Set())}
            pausedSelectedCount={m.pausedSelectedCount}
            onActivateSelected={() => {
              void m.setKeywordStatus(m.selectedKeywords.filter((item) => !isKeywordActive(item)), true);
            }}
            onPauseSelected={() => {
              void m.setKeywordStatus(m.selectedKeywords.filter(isKeywordActive), false);
            }}
          />
          <div className="rounded-lg border border-gray-200">
            <KeywordTable
              keywords={list.pageItems}
              footer={<KeywordListPager list={list} />}
              editingId={m.editingId}
              editText={m.editText}
              setEditText={m.setEditText}
              onStartEdit={m.startEdit}
              onUpdateKeyword={m.updateKeyword}
              onCancelEdit={() => { m.setEditingId(null); m.setEditText(''); }}
              onDeleteKeyword={(id) => m.setDeleteTarget({
                kind: 'keyword',
                id
              })}
              marketControls={m.market.controls}
              groups={m.groups}
              bulkSelectedIds={m.bulkSelectedIds}
              onToggleBulkSelect={m.toggleBulkSelect}
              onSelectPage={(ids, selected) => m.setBulkSelectedIds(withPageSelection(m.bulkSelectedIds, ids, selected))}
              groupMenuKeywordId={m.groupMenuKeywordId}
              onToggleGroupMenu={(id) => m.setGroupMenuKeywordId(m.groupMenuKeywordId === id ? null : id)}
              onToggleMembership={m.toggleMembership}
              membershipBusy={m.saving}
              emptyMessage={listEmptyMessage}
              onSetKeywordStatus={(keyword, active) => { void m.setKeywordStatus([keyword], active); }}
              statusBusy={m.saving}
            />
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={m.deleteTarget !== null}
        onClose={() => m.setDeleteTarget(null)}
        onConfirm={m.confirmDelete}
        title={m.deleteTarget?.kind === 'group' ? 'Delete Keyword Group' : 'Delete Keyword'}
        message={m.deleteTarget?.kind === 'group'
          ? `Delete the group "${m.deleteTarget.group.name}"? Its keywords are kept; they just leave the group.`
          : 'Are you sure you want to delete this keyword?'}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <AlertModal {...m.alertModal} onClose={m.closeAlert} />

      <AddToMarketsDialog source={m.market.marketSource} keywords={keywords} markets={m.market.markets}
        onClose={() => m.market.setMarketSource(null)}
        onCreated={(created) => setKeywords([...created, ...m.keywordsRef.current])} />
    </div>
  );
};
