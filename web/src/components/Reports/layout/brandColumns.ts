import type { ReactNode } from 'react';
import type { BrandLeaderboardRow } from '../../../types';
import type { KpiId } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { kpiColumn } from './kpiColumn';
import type { ReportTableColumn } from './ReportTable';

/** The KPIs of each brand of a leaderboard, in column order. */
const BRAND_KPIS = ['visibility_score', 'mention_rate', 'share_of_voice', 'average_position'] as const satisfies readonly KpiId[];

/** A brand leaderboard's KPI columns, after the brand's name. */
export function brandKpiColumns(): Array<ReportTableColumn<BrandLeaderboardRow>> {
  return BRAND_KPIS.map((id) => kpiColumn<BrandLeaderboardRow>(id, (brand) => formatKpi(id, brand[id])));
}

/** The AI engines naming the brand, drawn by `render`, then how many keywords' answers name it. */
export function brandReachColumns(
  renderEngines: (brand: BrandLeaderboardRow) => ReactNode,
): Array<ReportTableColumn<BrandLeaderboardRow>> {
  return [
    {
      header: 'Engines',
      info: 'The AI engines whose answers name the brand.',
      render: renderEngines,
    },
    {
      header: 'Keywords',
      info: 'How many keywords\' answers name the brand.',
      render: (brand) => brand.keywords,
    },
  ];
}
