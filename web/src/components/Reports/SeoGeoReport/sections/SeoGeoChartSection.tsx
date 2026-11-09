import {
  GEO_MENTION_RATE, SEO_TOP_POSITION
} from '../../../../constants/seoGeoDefinitions';
import { ChartPanel } from '../../charts/ChartPanel';
import { SeoGeoChart } from '../../charts/SeoGeoChart';
import {
  SeoGeoSectionFrame, type SeoGeoSectionProps
} from './seoGeoGate';

const TITLE = 'Organic position against AI mention rate';

const CHART_INFO = `Each keyword with a Google result and AI answers. Left of position ${SEO_TOP_POSITION} is SEO strong, `
  + `above ${GEO_MENTION_RATE}% GEO strong; keywords beyond the top ${SEO_TOP_POSITION} sit in the ">${SEO_TOP_POSITION}" column. `
  + 'The bubble grows with search volume.';

/** The scatter of the scope's keywords by quadrant. */
export function SeoGeoChartSection({ state }: SeoGeoSectionProps) {
  return (
    <SeoGeoSectionFrame title={TITLE} untitled loadingShape="chart" state={state}>
      {({ rows }) => (
        <ChartPanel title={TITLE} info={CHART_INFO} subtitle="Bubble size: search volume.">
          <SeoGeoChart rows={rows} />
        </ChartPanel>
      )}
    </SeoGeoSectionFrame>
  );
}
