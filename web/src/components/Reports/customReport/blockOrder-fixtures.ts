import {
  keyedBlocks, type DraftBlock
} from './blockOrder';

/** Three report sections, keyed `<type>-0`. */
export const DRAFT_ITEMS: readonly DraftBlock[] = keyedBlocks([{ type: 'sources_headline' }, { type: 'sentiment_headline' }, { type: 'kpi_definitions' }]);

/** A block added by the builder. */
export const ADDED_ITEM: DraftBlock = {
  key: 'added-1',
  block: { type: 'engines_chart' },
};

/** The block types of `items`, in order. */
export function blockTypesOf(items: readonly DraftBlock[]): string[] {
  return items.map((item) => item.block.type);
}
