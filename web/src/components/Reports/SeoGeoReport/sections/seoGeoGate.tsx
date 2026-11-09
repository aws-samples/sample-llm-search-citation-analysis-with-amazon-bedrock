import type { ReactNode } from 'react';
import type { SeoGeoState } from '../../../../hooks/useSeoGeo';
import type { SeoScopeParams } from '../../../../hooks/useSeoGeoRequest';
import type { SeoGeoResponse } from '../../../../types/api/seo';
import {
  gateSection, ReportSection, ReportSectionPlaceholder
} from '../../layout';
import type { SectionGate } from '../../layout/sectionGate';
import type { SectionShape } from '../../layout/SectionSkeleton';

export const SEO_NOT_DEPLOYED_MESSAGE = 'The SEO stack is not deployed, so there is no Google organic data to compare. '
  + 'Deploy it and rebuild the dashboard to see this view.';

export const SEO_GEO_EMPTY_MESSAGE = 'No active keyword in this market and scope yet. Add keywords and run an analysis with Google AI Overviews enabled.';

/** Props of every SEO vs GEO section, in the report and as custom report blocks. */
export interface SeoGeoSectionProps {
  readonly state: SeoGeoState;
  /** The report's market and keyword group, which a table's "Export all" exports; left out, no export is offered. */
  readonly exportScope?: SeoScopeParams;
}

/**
 * The opening moves of an SEO vs GEO section: "not deployed", loading,
 * error, then "no keyword" before the section renders the response.
 */
function gateSeoGeo(title: string, state: SeoGeoState, loadingShape: SectionShape): SectionGate<SeoGeoResponse> {
  if (state.notConfigured) {
    return {
      ready: false,
      placeholder: <ReportSectionPlaceholder title={title} variant="empty" message={SEO_NOT_DEPLOYED_MESSAGE} />,
    };
  }
  return gateSection({
    title,
    loading: state.loading,
    error: state.error,
    loadingMessage: 'Loading the SEO vs GEO comparison…',
    loadingShape,
    value: state.data !== null && state.data.rows.length > 0 ? state.data : null,
    emptyMessage: SEO_GEO_EMPTY_MESSAGE,
  });
}

interface SeoGeoSectionFrameProps extends SeoGeoSectionProps {
  /** The heading of the section and of its placeholders. */
  readonly title: string;
  /** Leave the heading to the content (a chart panel carries its own). */
  readonly untitled?: boolean;
  readonly subtitle?: string | ((response: SeoGeoResponse) => string);
  /** What the section shows, so its loading skeleton takes that shape. */
  readonly loadingShape?: SectionShape;
  readonly children: (response: SeoGeoResponse) => ReactNode;
}

/** A report section over the SEO vs GEO response, behind `gateSeoGeo`. */
export function SeoGeoSectionFrame({
  title, untitled = false, subtitle, loadingShape = 'block', state, children
}: SeoGeoSectionFrameProps) {
  const gate = gateSeoGeo(title, state, loadingShape);
  if (!gate.ready) return gate.placeholder;
  return (
    <ReportSection title={untitled ? undefined : title} subtitle={typeof subtitle === 'function' ? subtitle(gate.value) : subtitle}>
      {children(gate.value)}
    </ReportSection>
  );
}
