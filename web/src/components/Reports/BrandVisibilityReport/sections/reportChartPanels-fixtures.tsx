import type { ReactElement } from 'react';
import {
  screen, within
} from '@testing-library/react';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';
import {
  buildBrandTrends, buildLatestBrands, buildTrendView
} from '../../layout/reportPayload-fixtures';
import {
  KPI_TREND_INFO, KPI_TREND_TITLE, KpiTrendPanel, SHARE_OF_VOICE_TITLE, SHARE_OF_VOICE_TREND_SUBTITLE, SHARE_OF_VOICE_TREND_TITLE,
  ShareOfVoicePanel, ShareOfVoiceTrendPanel
} from './ReportChartPanels';

/** The words of the KPI trend chart of `buildTrendView()`: both periods, the latest with the KPIs of `buildKpis()`. */
export const TREND_VIEW_KPI_CAPTION = 'Mention rate, Share of voice, Visibility score and Citation rate over 2 periods '
  + 'from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
  + 'Latest (2026-09-08): Mention rate 60.0%, Share of voice 25.0%, Visibility score 52.4, Citation rate 30.0%.';

/** The words of the share-of-voice donut of `buildLatestBrands()`. */
export const LATEST_BRANDS_SOV_CAPTION = 'Share of voice: Nike 25.0%, Adidas 20.8% and Puma 12.5%.';

/** The words of the donut of `buildVisibility().brands`: Nike and Adidas tied. */
export const VISIBILITY_BRANDS_SOV_CAPTION = 'Share of voice: Nike 25.0% and Adidas 25.0%.';

/** The words of the share of voice over time of `buildBrandTrends()`, the tracked brand unnamed. */
export const BRAND_TRENDS_SOV_CAPTION = 'Share of voice of Your brand, Adidas and Puma over 2 periods from 2026-09-01 to 2026-09-08, '
  + 'on a 0–100 scale. Latest (2026-09-08): Your brand 25.0%, Adidas 20.8%, Puma 12.5%.';

/** A chart panel of the reports: its title, the panel with fixture data, its subtitle and its chart in words. */
export type ReportChartPanelCase = readonly [string, () => ReactElement, string, string];

export const REPORT_CHART_PANELS: readonly ReportChartPanelCase[] = [
  [KPI_TREND_TITLE, () => <KpiTrendPanel points={buildTrendView().trend_data} />, KPI_TREND_INFO, TREND_VIEW_KPI_CAPTION],
  [
    SHARE_OF_VOICE_TITLE,
    () => <ShareOfVoicePanel brands={buildLatestBrands()} />,
    KPI_DEFINITIONS.share_of_voice.definition,
    LATEST_BRANDS_SOV_CAPTION,
  ],
  [
    SHARE_OF_VOICE_TREND_TITLE,
    () => <ShareOfVoiceTrendPanel trends={buildBrandTrends()} />,
    SHARE_OF_VOICE_TREND_SUBTITLE,
    BRAND_TRENDS_SOV_CAPTION,
  ],
];

/** The words of the chart in the panel named `title`, inside `container` (the whole page unless given). */
export function chartCaption(title: string, container: HTMLElement = document.body): string | null {
  return within(within(container).getByRole('region', { name: title })).getByRole('figure').textContent;
}

/** Whether a chart panel named `title` is on the page. */
export function hasChartPanel(title: string): boolean {
  return screen.queryByRole('region', { name: title }) !== null;
}
