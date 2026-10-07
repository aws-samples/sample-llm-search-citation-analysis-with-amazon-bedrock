import type { ComponentType } from 'react';
import {
  describe, expect, it
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import type { ReportInsightsResponse } from '../../../types/domain/insights';
import {
  buildInsights, buildReportInsights
} from '../../../types/domain/insights-fixtures';
import { buildPhase2Insights } from '../../../types/domain/insightFacts-fixtures';
import { expectRendersNothing } from '../../../test/renderNothing';
import { settledSlice } from '../layout/reportSlice-fixtures';
import { sectionTitled } from '../layout/reportQueries-fixtures';
import { sectionPlaceholderCases } from '../layout/sectionGate-fixtures';
import {
  bodyRowCells, columnHeadingTexts
} from '../../Visibility/visibilityTables-fixtures';
import type { InsightsSectionProps } from './InsightsTableSection';

/** The insights slice of a block section once `buildReportInsights(overrides)` has loaded, with every insight kind by default. */
export function loadedInsights(overrides: Partial<ReportInsightsResponse> = {}): InsightsSectionProps {
  return settledSlice(buildReportInsights({
    insights: [...buildInsights(), ...buildPhase2Insights()],
    ...overrides,
  }));
}

/** `buildReportInsights()` with its facts replaced by `facts`; the insights stay. */
export function insightsWithFacts(facts: Partial<ReportInsightsResponse['facts']>): InsightsSectionProps {
  return loadedInsights({
    facts: {
      ...buildReportInsights().facts,
      ...facts,
    },
  });
}

/** The one table of the section headed `title`. */
export function sectionTable(title: string): HTMLElement {
  return within(sectionTitled(title)).getByRole('table');
}

/** Each column heading of the section's table, without its tooltip. */
export function sectionColumnHeadings(title: string): string[] {
  return columnHeadingTexts(sectionTable(title));
}

/** The text of every body cell of the section's table, row by row, chips included. */
export function sectionRows(title: string): string[][] {
  return bodyRowCells(sectionTable(title));
}

/** The insight sentences read out above the section's table, top to bottom (list items inside the table left out). */
export function insightLines(title: string): string[] {
  return within(sectionTitled(title)).queryAllByRole('listitem')
    .filter((item) => item.closest('table') === null)
    .map((item) => item.textContent ?? '');
}

/** The tooltip explaining the column headed `header`. */
export function columnTooltip(header: string): HTMLElement {
  return screen.getByRole('button', { name: `About ${header}` });
}

/** Whether the section headed `title` shows `message` in place of a table. */
export function expectEmptySection(title: string, message: string): void {
  const section = within(sectionTitled(title));
  expect(section.getByText(message)).toBeInTheDocument();
  expect(section.queryByRole('table')).not.toBeInTheDocument();
}

/**
 * The placeholder states every insights block section shares: nothing before
 * the insights are requested, the loading message, then the error.
 */
export function describeInsightsSectionPlaceholders(section: ComponentType<InsightsSectionProps>): void {
  const Section = section;
  describe('placeholder states', () => {
    it('renders nothing before the insights are requested', () => {
      expectRendersNothing(<Section {...settledSlice(null)} />);
    });

    it.each(sectionPlaceholderCases('Loading insights…'))('renders the $name', ({
      state, text
    }) => {
      const { container } = render(<Section {...state} data={null} />);

      expect(container).toHaveTextContent(text);
    });
  });
}
