import type { ComponentType } from 'react';
import type { HistoricalTrendsResponse } from '../../../../types';
import {
  EngineSentimentSection, type ScopeSectionProps
} from '../../scopeReport';
import type { ScopeReportData } from '../../scopeReport/useScopeReportData';
import { VisibilityHeadlineSection } from '../../layout';
import { ALL_KEYWORDS_RANKINGS_SUBTITLE } from '../../BrandVisibilityReport/BrandVisibilityReport';
import { BrandRankingsSection } from '../../BrandVisibilityReport/sections/BrandRankingsSection';
import { CrossKeywordHeadlineSection } from '../../BrandVisibilityReport/sections/CrossKeywordHeadlineSection';
import { MoversSection } from '../../BrandVisibilityReport/sections/MoversSection';
import { PerKeywordTableSection } from '../../BrandVisibilityReport/sections/PerKeywordTableSection';
import { TrendHistorySection } from '../../BrandVisibilityReport/sections/TrendHistorySection';
import { BenchmarkHeadlineSection } from '../../CompetitorBenchmarkReport/sections/BenchmarkHeadlineSection';
import { BrandTrendSection } from '../../CompetitorBenchmarkReport/sections/BrandTrendSection';
import { LeaderboardSection } from '../../CompetitorBenchmarkReport/sections/LeaderboardSection';
import { ShareOfVoiceSection } from '../../CompetitorBenchmarkReport/sections/ShareOfVoiceSection';
import { EngineChartSection } from '../../AiEnginesReport/sections/EngineChartSection';
import { EngineHeadlineSection } from '../../AiEnginesReport/sections/EngineHeadlineSection';
import { EngineTableSection } from '../../AiEnginesReport/sections/EngineTableSection';
import { DomainsTableSection } from '../../SourcesReport/sections/DomainsTableSection';
import { SourcesHeadlineSection } from '../../SourcesReport/sections/SourcesHeadlineSection';
import { TopSourcesSection } from '../../SourcesReport/sections/TopSourcesSection';
import { BrandSentimentSection } from '../../SentimentReport/sections/BrandSentimentSection';
import { NetSentimentTrendSection } from '../../SentimentReport/sections/NetSentimentTrendSection';
import { SentimentHeadlineSection } from '../../SentimentReport/sections/SentimentHeadlineSection';
import {
  EVERY_SCOPE, type DataBlockDefinition, type ScopeKind
} from './catalogTypes';

/**
 * Blocks drawn from the scope source (`/visibility` and `/trends`): the
 * sections of the Brand Visibility, Competitor Benchmark, AI Engines,
 * Sources and Sentiment reports.
 */

interface TrendSliceProps {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function trendSlice(report: ScopeReportData): TrendSliceProps {
  return {
    trends: report.trends.data,
    loading: report.trends.loading,
    error: report.trends.error,
  };
}

/** A Brand Visibility section that reads `/trends` alone, fed from the scope source. */
function fromTrends(section: ComponentType<TrendSliceProps>): ComponentType<ScopeSectionProps> {
  const Section = section;
  return function TrendBlock({ report }: ScopeSectionProps) {
    return <Section {...trendSlice(report)} />;
  };
}

function VisibilityHeadlineBlock({ report }: ScopeSectionProps) {
  return (
    <VisibilityHeadlineSection
      visibility={report.visibility.data}
      trends={report.trends.data}
      loading={report.visibility.loading || report.trends.loading}
      error={report.visibility.error ?? report.trends.error}
      emptyMessage="No visibility data found for this scope yet. Run an analysis to fill this block."
    />
  );
}

/** One keyword ranks the brands of its latest run; a wider scope pools each keyword's latest period. */
function BrandRankingsBlock({ report }: ScopeSectionProps) {
  if (report.scope.kind === 'keyword') {
    return (
      <BrandRankingsSection
        brands={report.visibility.data?.brands ?? null}
        loading={report.visibility.loading}
        error={report.visibility.error}
      />
    );
  }
  return (
    <BrandRankingsSection
      brands={report.trends.data?.latest_brands ?? null}
      brandTrends={report.trends.data?.brand_trends}
      loading={report.trends.loading}
      error={report.trends.error}
      subtitle={ALL_KEYWORDS_RANKINGS_SUBTITLE}
      emptyMessage="No brand mentions extracted in the latest periods."
    />
  );
}

function ExploredEngineSentimentBlock({ report }: ScopeSectionProps) {
  return <EngineSentimentSection report={report} explore />;
}

const KEYWORD_SETS: readonly ScopeKind[] = ['all', 'group'];

/** `[type, category, label, description, section, scopes]`; the type is what saved reports store. */
type ScopeBlockRow = readonly [string, DataBlockDefinition['category'], string, string, ComponentType<ScopeSectionProps>, readonly ScopeKind[]];

const SCOPE_BLOCK_ROWS: readonly ScopeBlockRow[] = [
  ['visibility_headline', 'visibility', 'Headline', 'Every KPI of the latest runs with its change.', VisibilityHeadlineBlock, EVERY_SCOPE],
  ['visibility_keyword_trends', 'visibility', 'KPIs and keyword trends', 'Every KPI with how many keywords improve or decline.', fromTrends(CrossKeywordHeadlineSection), KEYWORD_SETS],
  ['visibility_brand_rankings', 'visibility', 'Brand rankings', 'Every brand the answers name, by visibility score.', BrandRankingsBlock, EVERY_SCOPE],
  ['visibility_trend_history', 'visibility', 'Trend history', 'The KPIs per period over the report period.', fromTrends(TrendHistorySection), EVERY_SCOPE],
  ['visibility_movers', 'visibility', 'Top movers', 'The keywords improving and declining the most.', fromTrends(MoversSection), KEYWORD_SETS],
  ['visibility_keyword_table', 'visibility', 'Per-keyword leaderboard', 'Every keyword with its KPIs and change.', fromTrends(PerKeywordTableSection), KEYWORD_SETS],
  ['benchmark_headline', 'benchmark', 'Headline', 'Your share of voice, rank and the leading brand.', BenchmarkHeadlineSection, EVERY_SCOPE],
  ['benchmark_share_of_voice', 'benchmark', 'Share of voice', 'The share-of-voice donut of the latest runs.', ShareOfVoiceSection, EVERY_SCOPE],
  ['benchmark_brand_trend', 'benchmark', 'Brands over time', 'The leading brands over the report period.', BrandTrendSection, EVERY_SCOPE],
  ['benchmark_leaderboard', 'benchmark', 'Leaderboard', 'Every KPI per brand.', LeaderboardSection, EVERY_SCOPE],
  ['engines_headline', 'engines', 'Headline', 'Which AI engines name your brand.', EngineHeadlineSection, EVERY_SCOPE],
  ['engines_chart', 'engines', 'KPIs per engine', 'Mention rate, visibility score and citation rate side by side.', EngineChartSection, EVERY_SCOPE],
  ['engines_table', 'engines', 'Every KPI per engine', 'The full KPI table per AI engine.', EngineTableSection, EVERY_SCOPE],
  ['sources_headline', 'sources', 'Headline', 'Your citations, citation rate and citation share.', SourcesHeadlineSection, EVERY_SCOPE],
  ['sources_top_domains', 'sources', 'Most cited domains', 'The most cited websites, your own highlighted.', TopSourcesSection, EVERY_SCOPE],
  ['sources_domains_table', 'sources', 'Cited domains', 'Every cited domain with its engines and keywords.', DomainsTableSection, EVERY_SCOPE],
  ['sentiment_headline', 'sentiment', 'Headline', 'Net sentiment with its change and split.', SentimentHeadlineSection, EVERY_SCOPE],
  ['sentiment_trend', 'sentiment', 'Net sentiment over time', 'Net sentiment over the report period.', NetSentimentTrendSection, EVERY_SCOPE],
  ['sentiment_engines', 'sentiment', 'Sentiment per engine', 'The split per AI engine, with the answers behind every count.', ExploredEngineSentimentBlock, EVERY_SCOPE],
  ['sentiment_brands', 'sentiment', 'Net sentiment per brand', 'The net sentiment of every brand named.', BrandSentimentSection, EVERY_SCOPE],
];

export const SCOPE_BLOCKS: readonly DataBlockDefinition[] = SCOPE_BLOCK_ROWS.map(([type, category, label, description, section, scopes]) => {
  const Section = section;
  return {
    type,
    category,
    label,
    description,
    sources: ['scope'],
    scopes,
    render: (sources) => sources.scope && <Section report={sources.scope} />,
  };
});
