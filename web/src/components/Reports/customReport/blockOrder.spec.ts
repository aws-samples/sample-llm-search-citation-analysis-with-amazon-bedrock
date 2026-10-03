import {
  describe, expect, it
} from 'vitest';
import {
  insertBlock, keyedBlocks, moveBlock, removeBlock, replaceBlock, shiftBlock
} from './blockOrder';
import {
  ADDED_ITEM as ADDED, blockTypesOf as typesOf, DRAFT_ITEMS as ITEMS
} from './blockOrder-fixtures';

describe('insertBlock', () => {
  it('places the block before the given position', () => {
    expect(typesOf(insertBlock(ITEMS, 1, ADDED))).toStrictEqual(['sources_headline', 'engines_chart', 'sentiment_headline', 'kpi_definitions']);
  });

  it('appends the block when the position is past the end', () => {
    expect(typesOf(insertBlock(ITEMS, 99, ADDED))).toStrictEqual(['sources_headline', 'sentiment_headline', 'kpi_definitions', 'engines_chart']);
  });

  it('prepends the block when the position is negative', () => {
    expect(typesOf(insertBlock(ITEMS, -3, ADDED))).toStrictEqual(['engines_chart', 'sources_headline', 'sentiment_headline', 'kpi_definitions']);
  });
});

describe('moveBlock', () => {
  it('moves a block down into the gap before a later block', () => {
    expect(typesOf(moveBlock(ITEMS, 'sources_headline-0', 2))).toStrictEqual(['sentiment_headline', 'sources_headline', 'kpi_definitions']);
  });

  it('moves a block to the end when dropped in the last gap', () => {
    expect(typesOf(moveBlock(ITEMS, 'sources_headline-0', 3))).toStrictEqual(['sentiment_headline', 'kpi_definitions', 'sources_headline']);
  });

  it('moves a block up into the gap before an earlier block', () => {
    expect(typesOf(moveBlock(ITEMS, 'kpi_definitions-0', 0))).toStrictEqual(['kpi_definitions', 'sources_headline', 'sentiment_headline']);
  });

  it('keeps the order when the block is dropped in the gap next to itself', () => {
    expect(typesOf(moveBlock(ITEMS, 'sentiment_headline-0', 2))).toStrictEqual(['sources_headline', 'sentiment_headline', 'kpi_definitions']);
  });

  it('keeps the order when no block has the key', () => {
    expect(typesOf(moveBlock(ITEMS, 'missing', 0))).toStrictEqual(['sources_headline', 'sentiment_headline', 'kpi_definitions']);
  });
});

describe('shiftBlock', () => {
  it('swaps a block with the one above it', () => {
    expect(typesOf(shiftBlock(ITEMS, 'sentiment_headline-0', -1))).toStrictEqual(['sentiment_headline', 'sources_headline', 'kpi_definitions']);
  });

  it('swaps a block with the one below it', () => {
    expect(typesOf(shiftBlock(ITEMS, 'sentiment_headline-0', 1))).toStrictEqual(['sources_headline', 'kpi_definitions', 'sentiment_headline']);
  });

  it('keeps the first block first when it is moved up', () => {
    expect(typesOf(shiftBlock(ITEMS, 'sources_headline-0', -1))).toStrictEqual(['sources_headline', 'sentiment_headline', 'kpi_definitions']);
  });

  it('keeps the last block last when it is moved down', () => {
    expect(typesOf(shiftBlock(ITEMS, 'kpi_definitions-0', 1))).toStrictEqual(['sources_headline', 'sentiment_headline', 'kpi_definitions']);
  });
});

describe('removeBlock', () => {
  it('drops only the block with the key', () => {
    expect(typesOf(removeBlock(ITEMS, 'sentiment_headline-0'))).toStrictEqual(['sources_headline', 'kpi_definitions']);
  });
});

describe('replaceBlock', () => {
  it('swaps the block content and keeps its key and place', () => {
    const replaced = replaceBlock(ITEMS, 'sentiment_headline-0', { type: 'sentiment_trend' });

    expect(replaced[1]).toStrictEqual({
      key: 'sentiment_headline-0',
      block: { type: 'sentiment_trend' },
    });
  });
});

describe('keyedBlocks', () => {
  it('gives repeated block types distinct keys by occurrence', () => {
    const keyed = keyedBlocks([{ type: 'heading' }, { type: 'sources_headline' }, { type: 'heading' }]);

    expect(keyed.map((item) => item.key)).toStrictEqual(['heading-0', 'sources_headline-0', 'heading-1']);
  });
});
