import { useEffect } from 'react';
import {
  useNavigate, useParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import {
  KpiDefinitionsSection,
  ReportLayout,
  ReportKeywordSelector,
  VisibilityHeadlineSection,
} from '../layout';
import { useKeywordDeepDive } from './useKeywordDeepDive';
import { RankHistorySection } from './sections/RankHistorySection';
import { PersonaImpactSection } from './sections/PersonaImpactSection';
import { EngineKpisSection } from './sections/EngineKpisSection';
import { ProviderDeltaSection } from './sections/ProviderDeltaSection';
import { TopSourcesSection } from './sections/TopSourcesSection';
import { SentimentExamplesSection } from './sections/SentimentExamplesSection';
import { RecommendationsSection } from './sections/RecommendationsSection';
import { BrandRankingsSection } from '../BrandVisibilityReport/sections/BrandRankingsSection';
import type { Keyword } from '../../../types';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Keyword Deep Dive report — a printable, single-keyword drill-down for
 * SEO/AI search leads investigating one specific keyword's ranking story.
 *
 * URL contract:
 *   /reports/keyword           — show selector, no report yet
 *   /reports/keyword/:keyword  — render the report for that keyword
 *
 * Print contract:
 *   ?print=1 + keyword set + all data hooks settled => auto-fire window.print().
 *   The MainApp print scheduler is gated off for /reports/* routes so this
 *   component owns the timing.
 */
export function KeywordDeepDiveReport({ keywords }: Props) {
  const navigate = useNavigate();
  const params = useParams<{ keyword?: string }>();
  const selectedKeyword = params.keyword
    ? decodeURIComponent(params.keyword)
    : null;

  const data = useKeywordDeepDive(selectedKeyword);

  // Auto-print only fires once `selectedKeyword` is set AND every fetch has
  // settled. Without the keyword guard the print would fire on the selector
  // page (`/reports/keyword` with no slug) and produce an empty PDF.
  usePrintMode({ ready: Boolean(selectedKeyword) && data.ready });

  // When the user lands on the bare `/reports/keyword` and has at least one
  // keyword configured, auto-select the first so the report has something to
  // render. Skipping this would force the user to interact with the selector
  // every time, which is a regression from the dashboard pattern.
  useEffect(() => {
    if (!selectedKeyword && keywords.length > 0) {
      navigate(
        `/reports/keyword/${encodeURIComponent(keywords[0].keyword)}`,
        { replace: true },
      );
    }
  }, [selectedKeyword, keywords, navigate]);

  const handleKeywordChange = (keyword: string) => {
    navigate(`/reports/keyword/${encodeURIComponent(keyword)}`);
  };

  if (keywords.length === 0) {
    return (
      <ReportLayout
        title="Keyword Deep Dive"
        subtitle="Configure tracked keywords in Settings to generate this report."
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No keywords configured. Add at least one keyword in
          <span className="font-medium"> Settings &rarr; Keywords </span>
          to generate this report.
        </p>
      </ReportLayout>
    );
  }

  if (!selectedKeyword) {
    return (
      <ReportLayout
        title="Keyword Deep Dive"
        subtitle="Pick a keyword to drill into."
      >
        <ReportKeywordSelector
          keywords={keywords}
          selected={null}
          onChange={handleKeywordChange}
        />
      </ReportLayout>
    );
  }

  return (
    <ReportLayout
      title={`Keyword Deep Dive: ${selectedKeyword}`}
      subtitle="KPIs and their history, brand rankings, persona impact, KPIs per AI engine, provider differences, top sources, and recommended actions for this keyword."
      actions={
        <ReportKeywordSelector
          keywords={keywords}
          selected={selectedKeyword}
          onChange={handleKeywordChange}
        />
      }
    >
      <VisibilityHeadlineSection
        visibility={data.visibility}
        trends={data.trends}
        loading={data.visibilityLoading || data.trendsLoading}
        error={data.visibilityError ?? data.trendsError}
        emptyMessage="No visibility data found for this keyword. Run an analysis to populate the report."
      />
      <RankHistorySection
        trends={data.trends}
        loading={data.trendsLoading}
        error={data.trendsError}
      />
      <BrandRankingsSection
        brands={data.visibility?.brands ?? null}
        loading={data.visibilityLoading}
        error={data.visibilityError}
      />
      <PersonaImpactSection
        personas={data.personas}
        loading={data.personasLoading}
        error={data.personasError}
      />
      <EngineKpisSection
        visibility={data.visibility}
        loading={data.visibilityLoading}
        error={data.visibilityError}
      />
      <ProviderDeltaSection
        mentions={data.mentions}
        loading={data.mentionsLoading}
        error={data.mentionsError}
      />
      <TopSourcesSection
        gaps={data.gaps}
        mentions={data.mentions}
        loading={data.gapsLoading || data.mentionsLoading}
        error={data.gapsError ?? data.mentionsError}
      />
      <SentimentExamplesSection
        mentions={data.mentions}
        loading={data.mentionsLoading}
        error={data.mentionsError}
      />
      <RecommendationsSection
        recommendations={data.recommendations}
        keyword={selectedKeyword}
        loading={data.recommendationsLoading}
        error={data.recommendationsError}
      />
      <KpiDefinitionsSection definitions={VISIBILITY_DEFINITIONS} />
    </ReportLayout>
  );
}
