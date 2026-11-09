import {
  useEffect, useRef, type ReactNode
} from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';
import { StrokeIcon } from '../ui/StrokeIcon';
import { KEY_PATHS } from '../ui/iconPaths';
import { KeywordGroupMenu } from './KeywordGroupAssignment';
import type { KeywordMarketControls } from './KeywordMarketControls';
import {
  KeywordEditForm, KeywordTableRow
} from './KeywordTableRow';
import { KEYWORD_COLUMNS } from './keywordTableColumns';
import { useKeywordColumnCount } from './useKeywordColumnCount';

interface KeywordTableProps {
  readonly keywords: Keyword[];
  readonly editingId: string | null;
  readonly editText: string;
  readonly setEditText: (value: string) => void;
  readonly onStartEdit: (keyword: Keyword) => void;
  readonly onUpdateKeyword: (id: string) => void;
  readonly onCancelEdit: () => void;
  readonly onDeleteKeyword: (id: string) => void;
  readonly groups?: KeywordGroup[];
  readonly bulkSelectedIds?: ReadonlySet<string>;
  readonly onToggleBulkSelect?: (id: string) => void;
  /** Ticks (`true`) or unticks every keyword on the page; omitted hides the header checkbox. */
  readonly onSelectPage?: (ids: string[], selected: boolean) => void;
  readonly groupMenuKeywordId?: string | null;
  readonly onToggleGroupMenu?: (id: string) => void;
  readonly onToggleMembership?: (keyword: Keyword, group: KeywordGroup, member: boolean) => void;
  readonly membershipBusy?: boolean;
  readonly emptyMessage?: string;
  /** Activate or pause one keyword; omitted drops the row's Pause/Activate item. */
  readonly onSetKeywordStatus?: (keyword: Keyword, active: boolean) => void;
  readonly statusBusy?: boolean;
  /** Market column, translations and the market of an edited keyword; absent while no market is configured. */
  readonly marketControls?: KeywordMarketControls;
  /** Below the rows (the pager). */
  readonly footer?: ReactNode;
}

const HEAD = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500';

const EmptyState = ({ message }: { readonly message?: string }) => (
  <div className="text-center py-12 px-6 text-gray-500">
    <StrokeIcon className="w-10 h-10 mx-auto mb-3 text-gray-300" paths={KEY_PATHS} />
    <p className="text-sm">{message ?? 'No keywords yet. Add your first keyword above.'}</p>
  </div>
);

/** "Select all on this page", indeterminate while only some rows are ticked. */
const PageCheckbox = ({
  ids, selectedIds, onSelectPage
}: {
  readonly ids: string[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectPage: (ids: string[], selected: boolean) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const ticked = ids.filter((id) => selectedIds.has(id)).length;
  const all = ids.length > 0 && ticked === ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = ticked > 0 && !all;
  }, [ticked, all]);
  return (
    <input ref={ref} type="checkbox" aria-label="Select all keywords on this page" checked={all}
      onChange={() => onSelectPage(ids, !all)}
      className="block w-4 h-4 text-gray-900 rounded-sm border-gray-300 focus:ring-gray-900" />
  );
};

/** The column headings; the select cell holds the page checkbox. */
const KeywordTableHead = ({
  showMarket, pageCheckbox
}: {
  readonly showMarket: boolean;
  readonly pageCheckbox?: ReactNode;
}) => (
  <thead className="bg-gray-50">
    <tr>
      <th scope="col" className={`${HEAD} ${KEYWORD_COLUMNS.select} rounded-tl-lg`}>{pageCheckbox}</th>
      <th scope="col" className={HEAD}>Keyword</th>
      {showMarket && <th scope="col" className={`${HEAD} ${KEYWORD_COLUMNS.market}`}>Market</th>}
      <th scope="col" className={`${HEAD} ${KEYWORD_COLUMNS.groups}`}>Groups</th>
      <th scope="col" className={`${HEAD} ${KEYWORD_COLUMNS.status}`}>Status</th>
      <th scope="col" className={`${HEAD} ${KEYWORD_COLUMNS.added}`}>Added</th>
      <th scope="col" className={`${KEYWORD_COLUMNS.actions} rounded-tr-lg`}><span className="sr-only">Row actions</span></th>
    </tr>
  </thead>
);

/** The keywords as a table: one line per keyword, every action in its ⋯ menu. */
export const KeywordTable = ({
  keywords, editingId, editText, setEditText, onStartEdit, onUpdateKeyword, onCancelEdit, onDeleteKeyword,
  groups = [], bulkSelectedIds = new Set<string>(), onToggleBulkSelect, onSelectPage, groupMenuKeywordId = null,
  onToggleGroupMenu, onToggleMembership, membershipBusy = false, emptyMessage,
  onSetKeywordStatus, statusBusy = false, marketControls, footer,
}: KeywordTableProps) => {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const columnCount = useKeywordColumnCount(marketControls !== undefined);
  if (keywords.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <>
      <table className="w-full table-fixed text-sm">
        <KeywordTableHead showMarket={marketControls !== undefined}
          pageCheckbox={onSelectPage && <PageCheckbox ids={keywords.map((keyword) => keyword.id)} selectedIds={bulkSelectedIds} onSelectPage={onSelectPage} />} />
        <tbody>
          {keywords.map((keyword) => (
            <KeywordTableRow
              key={keyword.id}
              keyword={keyword}
              groupsById={groupsById}
              marketControls={marketControls}
              columnCount={columnCount}
              selected={bulkSelectedIds.has(keyword.id)}
              onToggleSelect={onToggleBulkSelect ? () => onToggleBulkSelect(keyword.id) : undefined}
              editor={editingId === keyword.id ? (
                <KeywordEditForm keywordId={keyword.id} editText={editText} setEditText={setEditText}
                  onSave={() => onUpdateKeyword(keyword.id)} onCancel={onCancelEdit} marketControls={marketControls} />
              ) : undefined}
              groupMenu={groupMenuKeywordId === keyword.id && onToggleMembership ? (
                <KeywordGroupMenu keyword={keyword} groups={groups} busy={membershipBusy}
                  onToggle={(group, member) => onToggleMembership(keyword, group, member)}
                  onClose={() => onToggleGroupMenu?.(keyword.id)} />
              ) : undefined}
              onStartEdit={() => onStartEdit(keyword)}
              onDeleteKeyword={() => onDeleteKeyword(keyword.id)}
              onOpenGroups={onToggleGroupMenu ? () => onToggleGroupMenu(keyword.id) : undefined}
              onSetStatus={onSetKeywordStatus ? (active) => onSetKeywordStatus(keyword, active) : undefined}
              statusBusy={statusBusy}
            />
          ))}
        </tbody>
      </table>
      {footer}
    </>
  );
};
