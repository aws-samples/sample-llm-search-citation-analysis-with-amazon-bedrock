import type { ReportsOverviewResponse } from '../../../../api/reports';
import {
  ReportSection, gateSection, type ReportSlice
} from '../../layout';
import {
  KpiTrendPanel, ShareOfVoicePanel
} from '../../BrandVisibilityReport/sections/ReportChartPanels';

/**
 * The headline at a glance: the KPIs per period of the window as lines and
 * the latest share of voice of every brand as a donut, side by side. The
 * headline above keeps every figure; without analysis data (which the
 * headline says) the section drops out.
 */
export function TrendSnapshotSection({
  data, loading, error
}: ReportSlice<ReportsOverviewResponse>) {
  const gate = gateSection({
    title: 'Trend and share of voice',
    loading,
    loadingMessage: 'Loading the KPI trend…',
    error,
    value: data !== null && data.keywords_with_data > 0 ? data : null,
  });
  if (!gate.ready) return gate.placeholder;

  return (
    <ReportSection
      title="Trend and share of voice"
      subtitle={`The KPIs per ${gate.value.period_type} over the last ${gate.value.days_analyzed} days, and each brand's share of voice in the latest periods.`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KpiTrendPanel points={gate.value.trend_data} />
        <ShareOfVoicePanel brands={gate.value.latest_brands} />
      </div>
    </ReportSection>
  );
}
