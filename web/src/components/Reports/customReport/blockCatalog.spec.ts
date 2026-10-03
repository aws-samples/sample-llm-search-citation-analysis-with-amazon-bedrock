import {
  describe, expect, it
} from 'vitest';
import {
  blockName, CATALOG_ENTRIES, catalogEntry, DATA_BLOCKS, scopeHint, scopeNeed, sourcesFor
} from './blockCatalog';
import { BLOCK_CATEGORIES } from './catalog/catalogTypes';

/** The block types saved reports store: renaming one silently drops it from every saved report. */
const STORED_DATA_BLOCK_TYPES = [
  'benchmark_brand_trend', 'benchmark_headline', 'benchmark_leaderboard', 'benchmark_share_of_voice',
  'competitor_headline', 'competitor_outranked_keywords', 'competitor_outreach_targets',
  'content_plan_briefs_ready', 'content_plan_citation_targets', 'content_plan_coverage', 'content_plan_headline', 'content_plan_suggested_briefs',
  'engines_chart', 'engines_headline', 'engines_table',
  'executive_headline', 'executive_next_actions', 'executive_trend', 'executive_wins_gaps',
  'group_definitions', 'group_drivers', 'group_headline', 'group_keywords', 'group_kpi_evolution',
  'keyword_engine_kpis', 'keyword_kpi_history', 'keyword_personas', 'keyword_provider_differences', 'keyword_recommendations',
  'keyword_sentiment_examples', 'keyword_top_sources',
  'kpi_definitions',
  'sentiment_brands', 'sentiment_engines', 'sentiment_headline', 'sentiment_trend',
  'sources_domains_table', 'sources_headline', 'sources_top_domains',
  'visibility_brand_rankings', 'visibility_headline', 'visibility_keyword_table', 'visibility_keyword_trends', 'visibility_movers',
  'visibility_trend_history',
];

describe('block catalogue', () => {
  it('keeps every stored data block type', () => {
    expect(DATA_BLOCKS.map((block) => block.type).sort((left, right) => left.localeCompare(right))).toStrictEqual(STORED_DATA_BLOCK_TYPES);
  });

  it('gives every entry a distinct type the server accepts', () => {
    const types = CATALOG_ENTRIES.map((entry) => entry.type);

    expect(new Set(types).size).toBe(types.length);
    expect(types.filter((type) => !/^[a-z][a-z0-9_]{1,47}$/u.test(type))).toStrictEqual([]);
  });

  it('lists the entries in the category order the builder shows', () => {
    const order = BLOCK_CATEGORIES.map((category) => category.id);
    const positions = CATALOG_ENTRIES.map((entry) => order.indexOf(entry.category));

    expect(positions).toStrictEqual([...positions].sort((left, right) => left - right));
  });

  it('offers at least one block in every category', () => {
    const offered = new Set(CATALOG_ENTRIES.map((entry) => entry.category));

    expect(BLOCK_CATEGORIES.filter((category) => !offered.has(category.id))).toStrictEqual([]);
  });

  it('creates an empty heading for the heading entry', () => {
    expect(catalogEntry('heading')?.create()).toStrictEqual({
      type: 'heading',
      text: '',
      level: 2,
    });
  });

  it('creates a type-only block for a report section', () => {
    expect(catalogEntry('sentiment_trend')?.create()).toStrictEqual({ type: 'sentiment_trend' });
  });
});

describe('blockName', () => {
  it('names a report section by its report and title', () => {
    expect(blockName('sentiment_headline')).toBe('Sentiment · Headline');
  });

  it('names a content block by its kind', () => {
    expect(blockName('video')).toBe('Video');
  });

  it('says a type the catalogue no longer knows is unavailable', () => {
    expect(blockName('retired_block')).toBe('Block no longer available');
  });
});

describe('sourcesFor', () => {
  it('collects each source once for the blocks that show the scope', () => {
    const blocks = [{ type: 'sources_headline' }, { type: 'sentiment_trend' }, { type: 'executive_headline' }];

    expect([...sourcesFor(blocks, { kind: 'all' })]).toStrictEqual(['scope', 'overview']);
  });

  it('leaves out the sources of blocks that cannot show the scope', () => {
    const blocks = [{ type: 'executive_headline' }, { type: 'keyword_personas' }];

    expect([...sourcesFor(blocks, {
      kind: 'keyword',
      keyword: 'beach hotel',
    })]).toStrictEqual(['deepDive']);
  });

  it('needs no source for content blocks, definitions and unknown types', () => {
    const blocks = [{ type: 'heading' }, { type: 'kpi_definitions' }, { type: 'retired_block' }];

    expect(sourcesFor(blocks, { kind: 'all' }).size).toBe(0);
  });
});

describe('scope wording', () => {
  it('names the single keyword a deep-dive block needs', () => {
    expect(scopeHint(['keyword'])).toBe('Pick a single keyword above to show this block.');
  });

  it('names the keyword group a group block needs', () => {
    expect(scopeHint(['group'])).toBe('Pick a keyword group above to show this block.');
  });

  it('names the keyword sets an executive block needs', () => {
    expect(scopeNeed(['all', 'group'])).toBe('every keyword or a keyword group');
  });

  it('needs nothing for a block that shows every scope', () => {
    expect(scopeNeed(['all', 'group', 'keyword'])).toBeNull();
  });
});
