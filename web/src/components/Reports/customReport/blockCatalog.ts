/**
 * Every block a custom report can hold, organised by category: the content
 * blocks the reader writes, and a data block for each section of the
 * existing reports.
 */
import type { ReportBlock } from '../../../api/customReports';
import type { ReportScope } from '../../../types';
import {
  BLOCK_CATEGORIES, type BlockCategoryId, type DataBlockDefinition, type ScopeKind
} from './catalog/catalogTypes';
import { FOCUS_BLOCKS } from './catalog/focusBlocks';
import { SCOPE_BLOCKS } from './catalog/scopeBlocks';
import { SUMMARY_BLOCKS } from './catalog/summaryBlocks';
import {
  newContentBlock, type ContentBlockType
} from './content/contentBlocks';
import type { SourceId } from './reportSources';

/** One choice in the builder's block list. */
export interface CatalogEntry {
  readonly type: string;
  readonly category: BlockCategoryId;
  readonly label: string;
  readonly description: string;
  /** Content blocks may be added any number of times; a report section once. */
  readonly repeatable: boolean;
  /** The block a click or a drop adds. */
  readonly create: () => ReportBlock;
}

/** `[type, label, description]` of the blocks the reader writes. */
const CONTENT_ROWS: ReadonlyArray<readonly [ContentBlockType, string, string]> = [
  ['heading', 'Heading', 'A large or small title between blocks.'],
  ['text', 'Text', 'Paragraphs, lists, links and tables, written in Markdown.'],
  ['image', 'Image', 'A picture from an https link, with a description and a caption.'],
  ['video', 'Video', 'A YouTube or Vimeo video; the printed report shows its link.'],
];

const CONTENT_ENTRIES: readonly CatalogEntry[] = CONTENT_ROWS.map(([type, label, description]) => ({
  type,
  category: 'content',
  label,
  description,
  repeatable: true,
  create: () => newContentBlock(type),
}));

export const DATA_BLOCKS: readonly DataBlockDefinition[] = [...SUMMARY_BLOCKS, ...SCOPE_BLOCKS, ...FOCUS_BLOCKS];

const DATA_BLOCKS_BY_TYPE: ReadonlyMap<string, DataBlockDefinition> = new Map(DATA_BLOCKS.map((block) => [block.type, block]));

const CATEGORY_ORDER: readonly BlockCategoryId[] = BLOCK_CATEGORIES.map((category) => category.id);

/** Every choice, content first, then the report sections category by category. */
export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  ...CONTENT_ENTRIES,
  ...DATA_BLOCKS.map((block): CatalogEntry => ({
    type: block.type,
    category: block.category,
    label: block.label,
    description: block.description,
    repeatable: false,
    create: () => ({ type: block.type }),
  })),
].sort((left, right) => CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category));

const ENTRIES_BY_TYPE: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG_ENTRIES.map((entry) => [entry.type, entry]));

export function dataBlockDefinition(type: string): DataBlockDefinition | undefined {
  return DATA_BLOCKS_BY_TYPE.get(type);
}

export function catalogEntry(type: string): CatalogEntry | undefined {
  return ENTRIES_BY_TYPE.get(type);
}

export function categoryLabel(category: BlockCategoryId): string {
  return BLOCK_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

/** How the builder names a block: its report and section ("Sentiment · Headline"), or the content kind. */
export function blockName(type: string): string {
  const entry = catalogEntry(type);
  if (entry === undefined) return 'Block no longer available';
  return entry.category === 'content' ? entry.label : `${categoryLabel(entry.category)} · ${entry.label}`;
}

export function supportsScope(definition: DataBlockDefinition, scope: ReportScope): boolean {
  return definition.scopes.includes(scope.kind);
}

/** The sources the blocks need to show `scope`; blocks that cannot show it need none. */
export function sourcesFor(blocks: readonly ReportBlock[], scope: ReportScope): Set<SourceId> {
  const needed = new Set<SourceId>();
  for (const block of blocks) {
    const definition = dataBlockDefinition(block.type);
    if (definition !== undefined && supportsScope(definition, scope)) {
      definition.sources.forEach((source) => needed.add(source));
    }
  }
  return needed;
}

/** `[scopes, what to pick]` for the blocks that cannot show every scope. */
const SCOPE_NEEDS: ReadonlyArray<readonly [readonly ScopeKind[], string]> = [
  [['keyword'], 'a single keyword'],
  [['group'], 'a keyword group'],
  [['all', 'group'], 'every keyword or a keyword group'],
];

/** The scope a block needs, in words; `null` when it shows any scope. */
export function scopeNeed(scopes: readonly ScopeKind[]): string | null {
  const need = SCOPE_NEEDS.find(([kinds]) => kinds.length === scopes.length && kinds.every((kind) => scopes.includes(kind)));
  return need?.[1] ?? null;
}

/** What to pick for a block that cannot show the current scope. */
export function scopeHint(scopes: readonly ScopeKind[]): string {
  return `Pick ${scopeNeed(scopes) ?? 'another scope'} above to show this block.`;
}
