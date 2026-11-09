import {
  useId, useState, type ReactNode
} from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';
import {
  ActionMenu, type ActionMenuItem
} from '../ui/ActionMenu';
import { Button } from '../ui/Button';
import { isKeywordActive } from './keywordEntry';
import { KeywordGroupSummary } from './KeywordGroupAssignment';
import {
  KeywordMarketCell, KeywordMarketSelect, KeywordTranslationList, type KeywordMarketControls
} from './KeywordMarketControls';
import { KEYWORD_COLUMNS } from './keywordTableColumns';

interface KeywordRowActions {
  readonly onStartEdit: () => void;
  readonly onDeleteKeyword: () => void;
  readonly onOpenGroups?: () => void;
  readonly onSetStatus?: (active: boolean) => void;
  readonly statusBusy?: boolean;
}

interface KeywordTableRowProps extends KeywordRowActions {
  readonly keyword: Keyword;
  readonly groupsById: ReadonlyMap<string, KeywordGroup>;
  readonly marketControls?: KeywordMarketControls;
  readonly selected: boolean;
  readonly onToggleSelect?: () => void;
  /** The inline edit form, when this row is being edited. */
  readonly editor?: ReactNode;
  /** The group checkboxes, opened under the row by "Edit groups". */
  readonly groupMenu?: ReactNode;
  /** Columns in the table, for the full-width editor and group rows. */
  readonly columnCount: number;
}

/** Every row action, behind one ⋯ button. */
function rowActions(keyword: Keyword, actions: KeywordRowActions, marketControls?: KeywordMarketControls): ActionMenuItem[] {
  const active = isKeywordActive(keyword);
  const onAddToMarkets = marketControls?.onAddToMarkets;
  return [
    {
      label: 'Edit',
      onSelect: actions.onStartEdit
    },
    ...(actions.onOpenGroups ? [{
      label: 'Edit groups',
      onSelect: actions.onOpenGroups,
    }] : []),
    ...(onAddToMarkets ? [{
      label: 'Add to markets…',
      onSelect: () => onAddToMarkets(keyword),
    }] : []),
    ...(actions.onSetStatus ? [{
      label: active ? 'Pause' : 'Activate',
      onSelect: () => actions.onSetStatus?.(!active),
      disabled: actions.statusBusy,
    }] : []),
    {
      label: 'Delete',
      onSelect: actions.onDeleteKeyword,
      tone: 'danger' as const,
    },
  ];
}

/**
 * Active or paused, as a dot and a word. Paused is the one that stands out
 * (amber): research promotes unselected proposals as paused, so an install can
 * hold many keywords that runs skip, and they must not look runnable.
 */
const KeywordStatus = ({ active }: { readonly active: boolean }) => (
  <span className="inline-flex items-center gap-1.5"
    title={active ? 'Asked on every analysis run' : 'Paused keywords stay in their groups but are skipped by analysis runs'}>
    <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-gray-400 dark:bg-gray-500' : 'bg-amber-500'}`} />
    <span className={active ? 'text-gray-500' : 'text-amber-700'}>{active ? 'Active' : 'Paused'}</span>
  </span>
);

const CELL = 'px-3 py-2.5 align-middle';

/** One keyword: a single line, the keyword truncated with its full text in the tooltip. */
export const KeywordTableRow = ({
  keyword, groupsById, marketControls, selected, onToggleSelect, editor, groupMenu, columnCount, ...actions
}: KeywordTableRowProps) => {
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const translationsId = useId();
  const active = isKeywordActive(keyword);
  if (editor) {
    return (
      <tr className="bg-gray-50">
        <td colSpan={columnCount} className="px-3 py-2">{editor}</td>
      </tr>
    );
  }
  return (
    <>
      <tr className={`border-t border-gray-100 transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
        <td className={`${CELL} ${KEYWORD_COLUMNS.select}`}>
          {onToggleSelect && (
            <input type="checkbox" aria-label={`Select ${keyword.keyword}`} checked={selected} onChange={onToggleSelect}
              className="block w-4 h-4 text-gray-900 rounded-sm border-gray-300 focus:ring-gray-900" />
          )}
        </td>
        <td className={`${CELL} min-w-0`}>
          <span className={`block truncate ${active ? 'text-gray-900' : 'text-gray-500'}`} title={keyword.keyword}>{keyword.keyword}</span>
          {marketControls && <KeywordTranslationList keyword={keyword} controls={marketControls} open={translationsOpen} id={translationsId} />}
        </td>
        {marketControls && (
          <td className={`${CELL} ${KEYWORD_COLUMNS.market}`}>
            <KeywordMarketCell keyword={keyword} controls={marketControls} translationsOpen={translationsOpen}
              onToggleTranslations={() => setTranslationsOpen(!translationsOpen)} translationsId={translationsId} />
          </td>
        )}
        <td className={`${CELL} ${KEYWORD_COLUMNS.groups}`}><KeywordGroupSummary keyword={keyword} groupsById={groupsById} /></td>
        <td className={`${CELL} ${KEYWORD_COLUMNS.status}`}><KeywordStatus active={active} /></td>
        <td className={`${CELL} ${KEYWORD_COLUMNS.added} text-gray-500 tabular-nums`}>{new Date(keyword.created_at).toLocaleDateString()}</td>
        <td className={`${CELL} ${KEYWORD_COLUMNS.actions} text-right`}>
          <div className="flex justify-end">
            <ActionMenu label={`Actions for ${keyword.keyword}`} items={rowActions(keyword, actions, marketControls)} />
          </div>
        </td>
      </tr>
      {groupMenu && (
        <tr className="bg-gray-50">
          <td colSpan={columnCount} className="px-3 pb-3 pt-1">{groupMenu}</td>
        </tr>
      )}
    </>
  );
};

interface KeywordEditFormProps {
  readonly keywordId: string;
  readonly editText: string;
  readonly setEditText: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly marketControls?: KeywordMarketControls;
}

/** The inline edit of one keyword: its text, its market, Save and Cancel. */
export const KeywordEditForm = ({
  keywordId, editText, setEditText, onSave, onCancel, marketControls
}: KeywordEditFormProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <input
      type="text"
      aria-label="Keyword"
      value={editText}
      onChange={(event) => setEditText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSave();
        if (event.key === 'Escape') onCancel();
      }}
      className="flex-1 min-w-[12rem] px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
      autoFocus
    />
    {marketControls && (
      <KeywordMarketSelect id={`keyword-market-${keywordId}`} label="Market" hideLabel value={marketControls.editMarketId}
        markets={marketControls.markets} onChange={marketControls.setEditMarketId} />
    )}
    <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    <Button size="sm" onClick={onSave}>Save</Button>
  </div>
);
