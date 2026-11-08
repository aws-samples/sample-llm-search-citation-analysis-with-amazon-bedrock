import { SEO_GEO_QUADRANTS } from '../../../../constants/seoGeoDefinitions';
import {
  ReportStatCard, ReportStatGrid
} from '../../layout';
import type { ReportAccent } from '../../layout/reportAccent';
import type { SeoGeoQuadrant } from '../../../../types/api/seo';
import {
  SeoGeoSectionFrame, type SeoGeoSectionProps
} from './seoGeoGate';

const TITLE = 'Keywords per quadrant';

/** Shown while no keyword has a run with a Google AI Overviews row, so every keyword reads "No data". */
export const NO_AIO_RUN_NOTE = 'No analysis run of these keywords has a Google AI Overviews result yet: the comparison fills in after the next run with the Google AI Overviews engine.';

const QUADRANT_ACCENTS: Readonly<Record<SeoGeoQuadrant, ReportAccent>> = {
  both_strong: 'positive',
  ai_gap: 'neutral',
  seo_gap: 'neutral',
  both_weak: 'negative',
  no_data: 'neutral',
};

/** One tile per quadrant with its keyword count, its definition behind the "i". */
export function SeoGeoQuadrantSection({ state }: SeoGeoSectionProps) {
  return (
    <SeoGeoSectionFrame
      title={TITLE}
      subtitle={({ rows }) => `${rows.length} keywords: where you stand on Google against how often the AI answers name you.`}
      state={state}
    >
      {({
        summary, rows 
      }) => (
        <>
          {rows.length > 0 && summary.no_data === rows.length && (
            <p className="mb-3 text-sm text-gray-600">{NO_AIO_RUN_NOTE}</p>
          )}
          <ReportStatGrid columns={5}>
            {SEO_GEO_QUADRANTS.map((quadrant) => (
              <ReportStatCard
                key={quadrant.id}
                label={quadrant.label}
                value={summary[quadrant.id]}
                info={quadrant.definition}
                accent={QUADRANT_ACCENTS[quadrant.id]}
              />
            ))}
          </ReportStatGrid>
        </>
      )}
    </SeoGeoSectionFrame>
  );
}
