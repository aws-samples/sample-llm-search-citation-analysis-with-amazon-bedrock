import type { ReactNode } from 'react';
import { ReportSectionPlaceholder } from '../../layout';
import { HeadlineSection as CompetitorHeadlineSection } from '../../CompetitorGapReport/sections/HeadlineSection';
import { OutrankedKeywordsSection } from '../../CompetitorGapReport/sections/OutrankedKeywordsSection';
import { OutreachTargetsSection } from '../../CompetitorGapReport/sections/OutreachTargetsSection';
import { BriefsReadySection } from '../../ContentActionPlanReport/sections/BriefsReadySection';
import { joinedContentPlan } from '../../ContentActionPlanReport/sections/ContentPlanSectionProps';
import { CoverageMapSection } from '../../ContentActionPlanReport/sections/CoverageMapSection';
import { HeadlineSection as ContentPlanHeadlineSection } from '../../ContentActionPlanReport/sections/HeadlineSection';
import { SuggestedBriefsSection } from '../../ContentActionPlanReport/sections/SuggestedBriefsSection';
import { TopCitationTargetsSection } from '../../ContentActionPlanReport/sections/TopCitationTargetsSection';
import { EngineKpisSection } from '../../KeywordDeepDiveReport/sections/EngineKpisSection';
import { PersonaImpactSection } from '../../KeywordDeepDiveReport/sections/PersonaImpactSection';
import { ProviderDeltaSection } from '../../KeywordDeepDiveReport/sections/ProviderDeltaSection';
import { RankHistorySection } from '../../KeywordDeepDiveReport/sections/RankHistorySection';
import { RecommendationsSection } from '../../KeywordDeepDiveReport/sections/RecommendationsSection';
import { SentimentExamplesSection } from '../../KeywordDeepDiveReport/sections/SentimentExamplesSection';
import { TopSourcesSection as KeywordSourcesSection } from '../../KeywordDeepDiveReport/sections/TopSourcesSection';
import type {
  CompetitorSource, ReportSources
} from '../reportSources';
import {
  EVERY_SCOPE, type DataBlockDefinition
} from './catalogTypes';

/**
 * Blocks with an input of their own: one competitor (Competitor Gap), every
 * keyword whatever the scope (Content Action Plan), or exactly one keyword
 * (Keyword Deep Dive).
 */

interface CompetitorGateProps {
  readonly competitor: CompetitorSource;
  readonly title: string;
  readonly children: (selected: string) => ReactNode;
}

/** A competitor section once a competitor is picked; why there is none otherwise. */
function CompetitorGate({
  competitor, title, children
}: CompetitorGateProps) {
  if (competitor.selected !== null) return <>{children(competitor.selected)}</>;
  if (!competitor.ready) {
    return <ReportSectionPlaceholder title={title} variant="loading" message="Loading the tracked competitors…" />;
  }
  return (
    <ReportSectionPlaceholder
      title={title}
      variant="empty"
      message="No competitors configured. Add competitors in Settings › Brand Tracking to show this block."
    />
  );
}

function competitorBlock(
  type: string,
  label: string,
  description: string,
  section: (competitor: CompetitorSource, selected: string) => ReactNode,
): DataBlockDefinition {
  return {
    type,
    category: 'competitor_gap',
    label,
    description,
    sources: ['competitor'],
    scopes: EVERY_SCOPE,
    everyKeyword: true,
    render: ({ competitor }) => competitor && (
      <CompetitorGate competitor={competitor} title={label}>
        {(selected) => section(competitor, selected)}
      </CompetitorGate>
    ),
  };
}

const COMPETITOR_BLOCKS: readonly DataBlockDefinition[] = [
  competitorBlock('competitor_headline', 'Headline', 'Where the competitor stands against you.', ({ gap }, selected) => (
    <CompetitorHeadlineSection
      competitor={selected}
      rollup={gap.rollup}
      keywordsAnalyzed={gap.keywordsAnalyzed}
      loading={gap.loading}
      error={gap.error}
    />
  )),
  competitorBlock('competitor_outranked_keywords', 'Outranked keywords', 'The keywords where the competitor ranks above you.', ({ gap }) => (
    <OutrankedKeywordsSection rollup={gap.rollup} loading={gap.loading} error={gap.error} />
  )),
  competitorBlock('competitor_outreach_targets', 'Top outreach targets', 'Who cites the competitor but not you, by visibility lift.', ({ gap }) => (
    <OutreachTargetsSection rollup={gap.rollup} loading={gap.loading} error={gap.error} />
  )),
];

function contentPlanBlock(type: string, label: string, description: string, render: DataBlockDefinition['render']): DataBlockDefinition {
  return {
    type,
    category: 'content_plan',
    label,
    description,
    sources: ['contentPlan'],
    scopes: EVERY_SCOPE,
    everyKeyword: true,
    render,
  };
}

const CONTENT_PLAN_BLOCKS: readonly DataBlockDefinition[] = [
  contentPlanBlock('content_plan_headline', 'Headline', 'Open gaps, ready briefs and suggested ideas.', ({ contentPlan }) => (
    contentPlan && <ContentPlanHeadlineSection {...joinedContentPlan(contentPlan)} />
  )),
  contentPlanBlock('content_plan_citation_targets', 'Top citation targets', 'The citation gaps worth closing first.', ({ contentPlan }) => (
    contentPlan && <TopCitationTargetsSection gaps={contentPlan.gaps} loading={contentPlan.gapsLoading} error={contentPlan.gapsError} />
  )),
  contentPlanBlock('content_plan_coverage', 'Coverage map', 'Which gaps already have a brief.', ({ contentPlan }) => (
    contentPlan && <CoverageMapSection {...joinedContentPlan(contentPlan)} />
  )),
  contentPlanBlock('content_plan_briefs_ready', 'Briefs ready to use', 'The briefs Content Studio already generated.', ({ contentPlan }) => (
    contentPlan && <BriefsReadySection history={contentPlan.history} loading={contentPlan.studioLoading} error={contentPlan.studioError} />
  )),
  contentPlanBlock('content_plan_suggested_briefs', 'Suggested next briefs', 'The content ideas to brief next.', ({ contentPlan }) => (
    contentPlan && <SuggestedBriefsSection ideas={contentPlan.ideas} loading={contentPlan.studioLoading} error={contentPlan.studioError} />
  )),
];

function keywordBlock(type: string, label: string, description: string, render: (sources: ReportSources) => ReactNode): DataBlockDefinition {
  return {
    type,
    category: 'keyword_deep_dive',
    label,
    description,
    sources: ['deepDive'],
    scopes: ['keyword'],
    render,
  };
}

const KEYWORD_BLOCKS: readonly DataBlockDefinition[] = [
  keywordBlock('keyword_kpi_history', 'KPI history', 'The keyword\'s KPIs per day over the last 30 days.', ({ deepDive: dive }) => (
    dive && <RankHistorySection trends={dive.trends} loading={dive.trendsLoading} error={dive.trendsError} />
  )),
  keywordBlock('keyword_personas', 'Persona impact', 'How each persona\'s answers rank your brand.', ({ deepDive: dive }) => (
    dive && <PersonaImpactSection personas={dive.personas} loading={dive.personasLoading} error={dive.personasError} />
  )),
  keywordBlock('keyword_engine_kpis', 'KPIs per AI engine', 'Every KPI of the keyword per AI engine.', ({ deepDive: dive }) => (
    dive && <EngineKpisSection visibility={dive.visibility} loading={dive.visibilityLoading} error={dive.visibilityError} />
  )),
  keywordBlock('keyword_provider_differences', 'Provider differences', 'Where the engines disagree about your brand.', ({ deepDive: dive }) => (
    dive && <ProviderDeltaSection mentions={dive.mentions} loading={dive.mentionsLoading} error={dive.mentionsError} />
  )),
  keywordBlock('keyword_top_sources', 'Top sources', 'The sources cited for the keyword, and the ones missing you.', ({ deepDive: dive }) => (
    dive && (
      <KeywordSourcesSection
        gaps={dive.gaps}
        mentions={dive.mentions}
        loading={dive.gapsLoading || dive.mentionsLoading}
        error={dive.gapsError ?? dive.mentionsError}
      />
    )
  )),
  keywordBlock('keyword_sentiment_examples', 'Sentiment examples', 'Answers that word your brand positively and negatively.', ({ deepDive: dive }) => (
    dive && <SentimentExamplesSection mentions={dive.mentions} loading={dive.mentionsLoading} error={dive.mentionsError} />
  )),
  keywordBlock('keyword_recommendations', 'Recommended actions', 'The actions recommended for the keyword.', ({ deepDive: dive }) => (
    dive && (
      <RecommendationsSection
        recommendations={dive.recommendations}
        keyword={dive.keyword}
        loading={dive.recommendationsLoading}
        error={dive.recommendationsError}
      />
    )
  )),
];

export const FOCUS_BLOCKS: readonly DataBlockDefinition[] = [...COMPETITOR_BLOCKS, ...CONTENT_PLAN_BLOCKS, ...KEYWORD_BLOCKS];
