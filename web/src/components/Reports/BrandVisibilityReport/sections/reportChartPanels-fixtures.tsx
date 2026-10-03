import type { ReactElement } from 'react';
import {
  screen, within
} from '@testing-library/react';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';
import {
  buildBrandTrends, buildLatestBrands, buildTrendView
} from '../../layout/reportPayload-fixtures';
import {
  KPI_TREND_TITLE, KpiTrendPanel, ShareOfVoicePanel, ShareOfVoiceTrendPanel
} from './ReportChartPanels';
import { sectionTitled } from '../../layout/reportQueries-fixtures';

/** The words of the KPI trend chart of `buildTrendView()`: both periods, the latest with the KPIs of `buildKpis()`. */
export const TREND_VIEW_KPI_CAPTION = 'Mention rate, Share of voice, Visibility score and Citation rate over 2 periods '
  + 'from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
  + 'Latest (2026-09-08): Mention rate 60.0%, Share of voice 25.0%, Visibility score 52.4, Citation rate 30.0%.';

/** The words of the KPI trend chart of the latest period of `buildTrendView()` alone. */
export const LATEST_PERIOD_KPI_CAPTION = 'Mention rate, Share of voice, Visibility score and Citation rate over 1 period (2026-09-08), '
  + 'on a 0–100 scale. '
  + 'Latest (2026-09-08): Mention rate 60.0%, Share of voice 25.0%, Visibility score 52.4, Citation rate 30.0%.';

/** The words of the share-of-voice donut of `buildLatestBrands()`. */
export const LATEST_BRANDS_SOV_CAPTION = 'Share of voice: Nike 25.0%, Adidas 20.8% and Puma 12.5%.';

/** The words of the donut of `buildVisibility().brands`: Nike and Adidas tied. */
export const VISIBILITY_BRANDS_SOV_CAPTION = 'Share of voice: Nike 25.0% and Adidas 25.0%.';

/** The words of the share of voice over time of `buildBrandTrends()`, the tracked brand unnamed. */
export const BRAND_TRENDS_SOV_CAPTION = 'Share of voice of Your brand, Adidas and Puma over 2 periods from 2026-09-01 to 2026-09-08, '
  + 'on a 0–100 scale. Latest (2026-09-08): Your brand 25.0%, Adidas 20.8%, Puma 12.5%.';

/**
 * A chart panel of the reports: its title, the panel with fixture data, its subtitle and its chart in words.
 * Titles and subtitles are written out, so a changed constant fails the specs.
 */
export type ReportChartPanelCase = readonly [string, () => ReactElement, string, string];

export const REPORT_CHART_PANELS: readonly ReportChartPanelCase[] = [
  [
    'KPIs over time',
    () => <KpiTrendPanel points={buildTrendView().trend_data} />,
    'Mention rate, share of voice, visibility score and citation rate over every answer of each period, '
      + 'on a 0–100 scale. A period without answers is a gap in the line.',
    TREND_VIEW_KPI_CAPTION,
  ],
  [
    'Share of voice',
    () => <ShareOfVoicePanel brands={buildLatestBrands()} />,
    KPI_DEFINITIONS.share_of_voice.definition,
    LATEST_BRANDS_SOV_CAPTION,
  ],
  [
    'Share of voice over time',
    () => <ShareOfVoiceTrendPanel trends={buildBrandTrends()} />,
    'Each brand\'s share of voice per period: your brand in the thick emerald line, '
      + 'its leading competitors in thinner lines. A period where no answer names a brand is a gap.',
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

/** The words of the KPI trend chart of the rendered trend history section. */
export function trendHistoryKpiCaption(): string | null {
  return chartCaption(KPI_TREND_TITLE, sectionTitled('Trend history'));
}
