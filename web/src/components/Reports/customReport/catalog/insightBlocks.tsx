import type { ComponentType } from 'react';
import { BrandPortfolioSection } from '../../insights/BrandPortfolioSection';
import { CitationOwnershipSection } from '../../insights/CitationOwnershipSection';
import { CompetitorCaveatsSection } from '../../insights/CompetitorCaveatsSection';
import { EnginePlaybookSection } from '../../insights/EnginePlaybookSection';
import { InsightsSummarySection } from '../../insights/InsightsSummarySection';
import { NarrativeSection } from '../../insights/NarrativeSection';
import type { InsightsSectionProps } from '../../insights/InsightsTableSection';
import { OwnedPagesSection } from '../../insights/OwnedPagesSection';
import { PromptEngineSection } from '../../insights/PromptEngineSection';
import { RunStabilitySection } from '../../insights/RunStabilitySection';
import {
  EVERY_SCOPE, type DataBlockDefinition, type ScopeKind
} from './catalogTypes';

/**
 * Blocks drawn from the insights source (`/reports/insights`): the top
 * insights, the play per AI engine, the position per keyword and engine, who
 * the engines cite and which of your pages, the caveats on competitors, the
 * first-party brand portfolio and, for a keyword group, the run stability of
 * each keyword and the narrative written for its latest run. Each table block
 * reads out its insights above its table.
 */

/** `[type, label, description, section, scopes]`; the type is what saved reports store and what an insight's `block` names. */
type InsightBlockRow = readonly [string, string, string, ComponentType<InsightsSectionProps>, readonly ScopeKind[]];

const INSIGHT_BLOCK_ROWS: readonly InsightBlockRow[] = [
  ['insights_summary', 'Top insights', 'The most pressing findings of the scope, most severe first.', InsightsSummarySection, EVERY_SCOPE],
  ['insights_engine_playbook', 'Engine playbook', 'The play per AI engine: get cited, get ranked first, both, or defend.', EnginePlaybookSection, EVERY_SCOPE],
  ['insights_prompt_engine', 'Prompts by engine', 'Your best position per keyword and AI engine, the ones below the top 3 highlighted.', PromptEngineSection, EVERY_SCOPE],
  ['insights_citation_ownership', 'Who the engines cite', 'Citations of your site, each competitor\'s sites and third parties, per AI engine.', CitationOwnershipSection, EVERY_SCOPE],
  ['insights_owned_pages', 'Your most-cited pages', 'Your pages the AI engines cite most, documents told apart from web pages.', OwnedPagesSection, EVERY_SCOPE],
  ['insights_competitor_caveats', 'Competitor caveats', 'How often the AI engines word each competitor mixed or negative, and why.', CompetitorCaveatsSection, EVERY_SCOPE],
  ['insights_brand_portfolio', 'Brand portfolio', 'Your brands against the best of them, the trailing ones marked weak.', BrandPortfolioSection, EVERY_SCOPE],
  ['insights_run_stability', 'Run stability', 'How far each keyword of the group swings between runs.', RunStabilitySection, ['group']],
];

/** The stored narrative of a group's latest run; it also needs the report's scope and period to regenerate and re-read it. */
const NARRATIVE_BLOCK: DataBlockDefinition = {
  type: 'insights_narrative',
  category: 'insights',
  label: 'Written insights',
  description: 'Up to three insights and six recommendations written by AI from the computed insights, each naming the ones it rests on.',
  sources: ['insights'],
  scopes: ['group'],
  render: ({
    insights, inputs
  }) => insights && (
    <NarrativeSection data={insights.data} loading={insights.loading} error={insights.error} scope={inputs.scope} days={inputs.days} />
  ),
};

export const INSIGHT_BLOCKS: readonly DataBlockDefinition[] = [
  ...INSIGHT_BLOCK_ROWS.map(([type, label, description, section, scopes]): DataBlockDefinition => {
    const Section = section;
    return {
      type,
      category: 'insights',
      label,
      description,
      sources: ['insights'],
      scopes,
      render: ({ insights }) => insights && <Section data={insights.data} loading={insights.loading} error={insights.error} />,
    };
  }),
  NARRATIVE_BLOCK,
];
