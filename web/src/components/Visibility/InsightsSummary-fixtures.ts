import { within } from '@testing-library/react';
import { INSIGHTS_TITLE } from './InsightsSummary';
import { panelTitled } from './visibilityTables-fixtures';

/** The Insights panel of the Visibility tab. */
export function insightsPanel() {
  return within(panelTitled(INSIGHTS_TITLE));
}

/** The text of every insight the panel reads out, top to bottom: its severity, then its sentence. */
export function insightItemTexts(): string[] {
  return insightsPanel().queryAllByRole('listitem').map((item) => item.textContent ?? '');
}
