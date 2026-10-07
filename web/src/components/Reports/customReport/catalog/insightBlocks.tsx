import type { ComponentType } from 'react';
import { BrandPortfolioSection } from '../../insights/BrandPortfolioSection';
import { EnginePlaybookSection } from '../../insights/EnginePlaybookSection';
import type { InsightsSectionProps } from '../../insights/InsightsTableSection';
import { RunStabilitySection } from '../../insights/RunStabilitySection';
import {
  EVERY_SCOPE, type DataBlockDefinition, type ScopeKind
} from './catalogTypes';

/**
 * Blocks drawn from the insights source (`/reports/insights`): the play per
 * AI engine, the first-party brand portfolio and, for a keyword group, the
 * run stability of each keyword. Each reads out its insights above its table.
 */

/** `[type, label, description, section, scopes]`; the type is what saved reports store and what an insight's `block` names. */
type InsightBlockRow = readonly [string, string, string, ComponentType<InsightsSectionProps>, readonly ScopeKind[]];

const INSIGHT_BLOCK_ROWS: readonly InsightBlockRow[] = [
  ['insights_engine_playbook', 'Engine playbook', 'The play per AI engine: get cited, get ranked first, both, or defend.', EnginePlaybookSection, EVERY_SCOPE],
  ['insights_brand_portfolio', 'Brand portfolio', 'Your brands against the best of them, the trailing ones marked weak.', BrandPortfolioSection, EVERY_SCOPE],
  ['insights_run_stability', 'Run stability', 'How far each keyword of the group swings between runs.', RunStabilitySection, ['group']],
];

export const INSIGHT_BLOCKS: readonly DataBlockDefinition[] = INSIGHT_BLOCK_ROWS.map(([type, label, description, section, scopes]) => {
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
});
