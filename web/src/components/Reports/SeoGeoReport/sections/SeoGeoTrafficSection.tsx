import { SEO_GEO_METRICS } from '../../../../constants/seoGeoDefinitions';
import type { TrafficShareEntry } from '../../../../types/api/seo';
import { ChartPanel } from '../../charts/ChartPanel';
import { SeoGeoTrafficChart } from '../../charts/SeoGeoTrafficChart';
import {
  ReportTable, type ReportTableColumn
} from '../../layout';
import {
  percentText, trafficText
} from '../seoGeoView';
import {
  SeoGeoSectionFrame, type SeoGeoSectionProps 
} from './seoGeoGate';
import { SeoGeoExportToolbar } from './SeoGeoExportToolbar';

const TITLE = 'Share of estimated search traffic vs share of AI mentions';

const CHART_INFO = `${SEO_GEO_METRICS.traffic_share.definition} ${SEO_GEO_METRICS.share_of_voice.definition}`;

const COLUMNS: ReadonlyArray<ReportTableColumn<TrafficShareEntry>> = [
  {
    header: 'Brand',
    cellClassName: 'font-medium',
    render: (entry) => entry.name,
  },
  {
    header: SEO_GEO_METRICS.estimated_traffic.label,
    info: SEO_GEO_METRICS.estimated_traffic.definition,
    render: (entry) => trafficText(entry.estimated_traffic),
  },
  {
    header: SEO_GEO_METRICS.traffic_share.label,
    info: SEO_GEO_METRICS.traffic_share.definition,
    render: (entry) => percentText(entry.traffic_share),
  },
  {
    header: SEO_GEO_METRICS.share_of_voice.label,
    info: SEO_GEO_METRICS.share_of_voice.definition,
    render: (entry) => percentText(entry.share_of_voice),
  },
];

function snapshotNote(snapshotAt: string | null): string {
  const when = snapshotAt === null ? 'no snapshot of your domains yet' : `your latest snapshot ${snapshotAt.slice(0, 10)}`;
  return `Estimated by DataForSEO from weekly domain snapshots (${when}); not measured clicks.`;
}

/** You and each competitor: estimated organic traffic share beside the AI share of voice, as bars and a table. */
export function SeoGeoTrafficSection({
  state, exportScope
}: SeoGeoSectionProps) {
  return (
    <SeoGeoSectionFrame title={TITLE} subtitle={(response) => snapshotNote(response.traffic_snapshot_at)} state={state}>
      {(response) => (
        <div className="space-y-4">
          <ChartPanel title={TITLE} info={CHART_INFO} subtitle="Indigo: estimated search traffic. Amber: AI mentions.">
            <SeoGeoTrafficChart entries={response.traffic_comparison} />
          </ChartPanel>
          <div>
            <SeoGeoExportToolbar scope={exportScope} table="Traffic share" />
            <ReportTable columns={COLUMNS} rows={response.traffic_comparison} rowKey={(entry) => entry.name} />
          </div>
        </div>
      )}
    </SeoGeoSectionFrame>
  );
}
