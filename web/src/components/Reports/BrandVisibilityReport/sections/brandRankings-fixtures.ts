import {
  sectionTable, sectionTitled
} from '../../layout/reportQueries-fixtures';
import { chartCaption } from './reportChartPanels-fixtures';
import { SHARE_OF_VOICE_TITLE } from './ReportChartPanels';

const TITLE = 'Brand rankings';

/** The brand of every leaderboard row of the rendered brand rankings, top to bottom. */
export function rankedBrandNames(): string[] {
  return sectionTable(TITLE).slice(1).map(([brand]) => brand);
}

/** The words of the share-of-voice donut of the rendered brand rankings. */
export function rankingsShareOfVoiceCaption(): string | null {
  return chartCaption(SHARE_OF_VOICE_TITLE, sectionTitled(TITLE));
}
