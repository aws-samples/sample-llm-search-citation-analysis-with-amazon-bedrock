import { buildTrackedBrandsHookResult } from '../../../test/brandConfigHookMock';
import type { ReportInsightsResponse } from '../../../types/domain/insights';
import { buildReportInsights } from '../../../types/domain/insights-fixtures';
import {
  LOADING_SLICE, settledSlice
} from '../layout/reportSlice-fixtures';
import {
  useReportSources, type InsightsSource, type ReportSources
} from './reportSources';

const SOURCE_NAMES = ['scope', 'overview', 'groupKpis', 'competitor', 'contentPlan', 'deepDive', 'insights'] as const satisfies readonly (keyof ReportSources)[];

/** Lists the sources its provider mounted, by name. */
export function ReportSourcesProbe() {
  const sources = useReportSources();
  return <p>{SOURCE_NAMES.filter((name) => sources[name] !== null).join(', ')}</p>;
}

/** Shows the competitor the competitor source picked. */
export function BrandConfigProbe() {
  const { competitor } = useReportSources();
  return <p>{competitor?.selected ?? 'none'}</p>;
}

/** `useBrandConfig()` once loaded with `competitors` tracked. */
export function mockBrandConfigWith(competitors: string[]) {
  return buildTrackedBrandsHookResult(['MyHotel'], competitors);
}

/** The insights source settled with `data` (the airline group unless given). */
export function buildInsightsSource(data: ReportInsightsResponse | null = buildReportInsights()): InsightsSource {
  return {
    ...settledSlice(data),
    ready: true,
  };
}

/** The insights source while its request is in flight. */
export function loadingInsightsSource(): InsightsSource {
  return {
    ...LOADING_SLICE,
    ready: false,
  };
}
