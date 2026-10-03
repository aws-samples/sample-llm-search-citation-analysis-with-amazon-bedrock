import {
  useCallback, useRef, useState
} from 'react';
import {
  DEFAULT_CUSTOM_REPORT_DAYS, type CustomReport, type CustomReportDays, type ReportBlock
} from '../../../../api/customReports';
import {
  insertBlock, keyedBlocks, moveBlock, removeBlock, replaceBlock, shiftBlock, type DraftBlock
} from '../blockOrder';

/** The report being built: what a save sends, with a key on every block. */
export interface ReportDraft {
  readonly title: string;
  readonly days: CustomReportDays;
  readonly items: readonly DraftBlock[];
}

function initialDraft(saved: CustomReport | null): ReportDraft {
  return {
    title: saved?.title ?? '',
    days: saved?.days ?? DEFAULT_CUSTOM_REPORT_DAYS,
    items: keyedBlocks(saved?.blocks ?? []),
  };
}

/** The draft of a new report, or of `saved`, and every edit the builder makes to it. */
export function useReportDraft(saved: CustomReport | null) {
  const addedCount = useRef(0);
  const [draft, setDraft] = useState(() => initialDraft(saved));

  const changeItems = useCallback((change: (items: readonly DraftBlock[]) => DraftBlock[]) => {
    setDraft((previous) => ({
      ...previous,
      items: change(previous.items),
    }));
  }, []);

  const setTitle = useCallback((title: string) => setDraft((previous) => ({
    ...previous,
    title,
  })), []);

  const setDays = useCallback((days: CustomReportDays) => setDraft((previous) => ({
    ...previous,
    days,
  })), []);

  /** Adds `block` before position `at`, at the end without one. */
  const addBlock = useCallback((block: ReportBlock, at?: number) => {
    addedCount.current += 1;
    const item: DraftBlock = {
      key: `added-${addedCount.current}`,
      block,
    };
    changeItems((items) => insertBlock(items, at ?? items.length, item));
  }, [changeItems]);

  const moveTo = useCallback((key: string, gap: number) => changeItems((items) => moveBlock(items, key, gap)), [changeItems]);
  const shift = useCallback((key: string, delta: -1 | 1) => changeItems((items) => shiftBlock(items, key, delta)), [changeItems]);
  const remove = useCallback((key: string) => changeItems((items) => removeBlock(items, key)), [changeItems]);
  const replace = useCallback((key: string, block: ReportBlock) => changeItems((items) => replaceBlock(items, key, block)), [changeItems]);

  return {
    draft,
    setTitle,
    setDays,
    addBlock,
    moveTo,
    shift,
    remove,
    replace,
  };
}
