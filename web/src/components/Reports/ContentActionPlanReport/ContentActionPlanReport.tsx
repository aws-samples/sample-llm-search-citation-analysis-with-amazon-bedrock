import { usePrintMode } from '../../../hooks/usePrintMode';
import { ReportLayout } from '../layout';
import { useContentActionPlan } from './useContentActionPlan';
import { HeadlineSection } from './sections/HeadlineSection';
import { TopCitationTargetsSection } from './sections/TopCitationTargetsSection';
import { CoverageMapSection } from './sections/CoverageMapSection';
import { BriefsReadySection } from './sections/BriefsReadySection';
import { SuggestedBriefsSection } from './sections/SuggestedBriefsSection';
import type { ContentPlanSectionProps } from './sections/ContentPlanSectionProps';

/**
 * Content Action Plan — the printable version of "what to build, what to
 * pitch, what's already done". Aimed at a content / PR strategist deciding
 * which gaps to fill next and which assets are ready to use.
 *
 * The report scopes to all tracked keywords (no per-keyword variant) because
 * content planning happens at the campaign / portfolio level, not at a
 * single-keyword level — the Keyword Deep Dive report already covers that.
 *
 * Print contract: no auto-print until both citation gaps and Content Studio
 * data have settled. The MainApp print scheduler is gated off for
 * `/reports/*`, so this component owns timing.
 */
export function ContentActionPlanReport() {
  const data = useContentActionPlan();

  usePrintMode({ ready: data.ready });

  // The sections that join all three sources wait for both fetches and
  // surface whichever failed first.
  const contentPlanProps: ContentPlanSectionProps = {
    gaps: data.gaps,
    ideas: data.ideas,
    history: data.history,
    loading: data.gapsLoading || data.studioLoading,
    error: data.gapsError ?? data.studioError,
  };

  return (
    <ReportLayout
      title="Content Action Plan"
      subtitle="Prioritised citation gaps paired with the briefs and ideas that fill them. For content and PR strategists planning the next sprint."
    >
      <HeadlineSection {...contentPlanProps} />
      <TopCitationTargetsSection
        gaps={data.gaps}
        loading={data.gapsLoading}
        error={data.gapsError}
      />
      <CoverageMapSection {...contentPlanProps} />
      <BriefsReadySection
        history={data.history}
        loading={data.studioLoading}
        error={data.studioError}
      />
      <SuggestedBriefsSection
        ideas={data.ideas}
        loading={data.studioLoading}
        error={data.studioError}
      />
    </ReportLayout>
  );
}
