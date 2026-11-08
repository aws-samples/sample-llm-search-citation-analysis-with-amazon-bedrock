import { SEO_GEO_METRICS } from '../../../../constants/seoGeoDefinitions';
import type { SeoGeoRow } from '../../../../types/api/seo';
import {
  ReportTable, type ReportTableColumn
} from '../../layout';
import {
  organicPositionText, percentText, quadrantBadgeClass, quadrantLabel, rankedPositionText, trafficText, volumeText, yesNoText
} from '../seoGeoView';
import { SeoGeoExportToolbar } from './SeoGeoExportToolbar';
import {
  SeoGeoSectionFrame, type SeoGeoSectionProps
} from './seoGeoGate';

const TITLE = 'Keywords';

const QuadrantBadge = ({ row }: { readonly row: SeoGeoRow }) => (
  <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${quadrantBadgeClass(row.quadrant)}`}>
    {quadrantLabel(row.quadrant)}
  </span>
);

const COLUMNS: ReadonlyArray<ReportTableColumn<SeoGeoRow>> = [
  {
    header: 'Keyword',
    cellClassName: 'font-medium',
    render: (row) => row.keyword,
  },
  {
    header: SEO_GEO_METRICS.search_volume.label,
    info: SEO_GEO_METRICS.search_volume.definition,
    render: (row) => volumeText(row.search_volume),
  },
  {
    header: SEO_GEO_METRICS.organic_position.label,
    info: SEO_GEO_METRICS.organic_position.definition,
    render: organicPositionText,
  },
  {
    header: SEO_GEO_METRICS.ranked_position.label,
    info: SEO_GEO_METRICS.ranked_position.definition,
    render: rankedPositionText,
  },
  {
    header: SEO_GEO_METRICS.estimated_traffic.label,
    info: SEO_GEO_METRICS.estimated_traffic.definition,
    render: (row) => trafficText(row.estimated_traffic),
  },
  {
    header: SEO_GEO_METRICS.ai_overview_shown.label,
    info: SEO_GEO_METRICS.ai_overview_shown.definition,
    render: (row) => yesNoText(row.ai_overview_shown),
  },
  {
    header: SEO_GEO_METRICS.ai_overview_cites_you.label,
    info: SEO_GEO_METRICS.ai_overview_cites_you.definition,
    render: (row) => yesNoText(row.ai_overview_cites_you),
  },
  {
    header: SEO_GEO_METRICS.ai_mention_rate.label,
    info: SEO_GEO_METRICS.ai_mention_rate.definition,
    render: (row) => percentText(row.ai_mention_rate),
  },
  {
    header: SEO_GEO_METRICS.answers.label,
    info: SEO_GEO_METRICS.answers.definition,
    render: (row) => row.answers,
  },
  {
    header: SEO_GEO_METRICS.citation_overlap.label,
    info: SEO_GEO_METRICS.citation_overlap.definition,
    render: (row) => percentText(row.citation_overlap),
  },
  {
    header: SEO_GEO_METRICS.quadrant.label,
    info: SEO_GEO_METRICS.quadrant.definition,
    render: (row) => <QuadrantBadge row={row} />,
  },
];

/** Every keyword of the scope with its organic and AI figures, in the server's order (largest volume first). */
export function SeoGeoTableSection({
  state, exportScope
}: SeoGeoSectionProps) {
  return (
    <SeoGeoSectionFrame title={TITLE} subtitle="Largest search volume first; keywords without metrics last." state={state}>
      {(response) => (
        <>
          <SeoGeoExportToolbar scope={exportScope} table="Keywords" />
          <ReportTable columns={COLUMNS} rows={response.rows} rowKey={(row) => row.keyword_id} />
        </>
      )}
    </SeoGeoSectionFrame>
  );
}
