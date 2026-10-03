/**
 * The ordered block list of a custom report being built. Every entry carries
 * a key that stays with its block while the list is reordered, so React keeps
 * each editor's state with the right block.
 */
import type { ReportBlock } from '../../../api/customReports';

export interface DraftBlock {
  readonly key: string;
  readonly block: ReportBlock;
}

function clampedIndex(items: readonly DraftBlock[], index: number): number {
  return Math.min(Math.max(index, 0), items.length);
}

/** `item` inserted before position `index` (clamped to the list). */
export function insertBlock(items: readonly DraftBlock[], index: number, item: DraftBlock): DraftBlock[] {
  const at = clampedIndex(items, index);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/**
 * The block `key` moved to the gap before position `gap` of the current list
 * (`items.length` is the end), as a drop between two blocks places it.
 */
export function moveBlock(items: readonly DraftBlock[], key: string, gap: number): DraftBlock[] {
  const from = items.findIndex((item) => item.key === key);
  if (from === -1) return [...items];
  const target = clampedIndex(items, gap);
  const rest = items.filter((item) => item.key !== key);
  return insertBlock(rest, target > from ? target - 1 : target, items[from]);
}

/** The block `key` moved one place up (`-1`) or down (`1`); unchanged at either end. */
export function shiftBlock(items: readonly DraftBlock[], key: string, delta: -1 | 1): DraftBlock[] {
  const from = items.findIndex((item) => item.key === key);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= items.length) return [...items];
  return moveBlock(items, key, delta === 1 ? to + 1 : to);
}

export function removeBlock(items: readonly DraftBlock[], key: string): DraftBlock[] {
  return items.filter((item) => item.key !== key);
}

export function replaceBlock(items: readonly DraftBlock[], key: string, block: ReportBlock): DraftBlock[] {
  return items.map((item) => (item.key === key ? {
    key,
    block,
  } : item));
}

/**
 * Keys for the blocks of a saved report: its type and how many blocks of that
 * type came before, so repeated content blocks stay distinct without using
 * their position.
 */
export function keyedBlocks(blocks: readonly ReportBlock[]): DraftBlock[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const occurrence = seen.get(block.type) ?? 0;
    seen.set(block.type, occurrence + 1);
    return {
      key: `${block.type}-${occurrence}`,
      block,
    };
  });
}
