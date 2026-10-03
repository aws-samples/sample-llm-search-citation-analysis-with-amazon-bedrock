import type {
  CustomReport, CustomReportInput
} from './customReports';

/** A saved report with one data block and one content block; every field can be overridden. */
export function buildCustomReport(overrides: Partial<CustomReport> = {}): CustomReport {
  return {
    id: 'report-quarterly',
    title: 'Quarterly brand review',
    blocks: [
      { type: 'sentiment_headline' },
      {
        type: 'heading',
        text: 'What changed this quarter',
        level: 2,
      },
    ],
    days: 90,
    created_at: '2026-09-18T09:00:00Z',
    created_by: 'analyst-1',
    updated_at: '2026-09-19T10:30:00Z',
    updated_by: 'analyst-2',
    ...overrides,
  };
}

/** The body of a create or an update; every field can be overridden. */
export function buildCustomReportInput(overrides: Partial<CustomReportInput> = {}): CustomReportInput {
  return {
    title: 'Launch recap',
    blocks: [
      { type: 'sentiment_headline' },
      {
        type: 'text',
        markdown: 'Mentions rose **after** the launch.',
      },
    ],
    days: 30,
    ...overrides,
  };
}
