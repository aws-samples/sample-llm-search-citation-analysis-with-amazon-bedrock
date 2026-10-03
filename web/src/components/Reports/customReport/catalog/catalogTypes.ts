import type { ReactNode } from 'react';
import type { ReportScope } from '../../../../types';
import type {
  ReportSources, SourceId
} from '../reportSources';

/** The groups the block list is organised in, in the order the builder shows them. */
export const BLOCK_CATEGORIES = [
  {
    id: 'content',
    label: 'Your content',
    description: 'Headings, text, images and videos you write yourself.',
  },
  {
    id: 'executive',
    label: 'Executive Summary',
    description: 'Every KPI with its change, the trend, top wins and gaps, next actions.',
  },
  {
    id: 'visibility',
    label: 'Brand Visibility',
    description: 'KPIs, brand rankings, history, movers and the per-keyword leaderboard.',
  },
  {
    id: 'group_kpis',
    label: 'Keyword group KPIs',
    description: 'Every run of one keyword group: KPIs, their evolution and what changed.',
  },
  {
    id: 'benchmark',
    label: 'Competitor Benchmark',
    description: 'Share of voice and rank against every brand the answers name.',
  },
  {
    id: 'engines',
    label: 'AI Engines',
    description: 'How each AI engine treats your brand.',
  },
  {
    id: 'sources',
    label: 'Sources',
    description: 'Which websites the AI answers cite.',
  },
  {
    id: 'sentiment',
    label: 'Sentiment',
    description: 'How the AI answers word your brand.',
  },
  {
    id: 'competitor_gap',
    label: 'Competitor Gap',
    description: 'Where one competitor outranks you and who cites them but not you.',
  },
  {
    id: 'content_plan',
    label: 'Content Action Plan',
    description: 'Citation gaps paired with the briefs and ideas that fill them.',
  },
  {
    id: 'keyword_deep_dive',
    label: 'Keyword Deep Dive',
    description: 'One keyword in depth: personas, engines, sources and actions.',
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'The definitions of every KPI the report shows.',
  },
] as const;

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export type BlockCategoryId = BlockCategory['id'];

export type ScopeKind = ReportScope['kind'];

export const EVERY_SCOPE: readonly ScopeKind[] = ['all', 'group', 'keyword'];

/**
 * A data block: one section of an existing report. Its `type` is what a saved
 * report stores, so it never changes once shipped; a type the catalogue no
 * longer knows is skipped when a report renders.
 */
export interface DataBlockDefinition {
  readonly type: string;
  readonly category: Exclude<BlockCategoryId, 'content'>;
  readonly label: string;
  readonly description: string;
  readonly sources: readonly SourceId[];
  /** The scopes it can show; any other one asks the reader to pick one of these. */
  readonly scopes: readonly ScopeKind[];
  /** Set when the block always covers every keyword, whatever the scope. */
  readonly everyKeyword?: boolean;
  readonly render: (sources: ReportSources) => ReactNode;
}
