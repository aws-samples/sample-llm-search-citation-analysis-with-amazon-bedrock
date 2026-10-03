import {
  describe, expect, it
} from 'vitest';
import {
  isCustomReport, isCustomReportResponse, isCustomReportsResponse
} from './customReportDecoders';
import { buildCustomReport } from './customReports-fixtures';

const REQUIRED_FIELDS = ['id', 'title', 'blocks', 'days', 'created_at', 'created_by', 'updated_at', 'updated_by'];

describe('isCustomReport', () => {
  it('accepts a report with a data block and a content block', () => {
    expect(isCustomReport(buildCustomReport())).toBe(true);
  });

  it('accepts a report without blocks', () => {
    expect(isCustomReport(buildCustomReport({ blocks: [] }))).toBe(true);
  });

  it('accepts a block carrying fields it does not know', () => {
    const report = buildCustomReport({
      blocks: [{
        type: 'future_block',
        settings: { compact: true },
      }],
    });

    expect(isCustomReport(report)).toBe(true);
  });

  it.each(REQUIRED_FIELDS)('rejects a report without %s', (field) => {
    const report = Object.fromEntries(Object.entries(buildCustomReport()).filter(([key]) => key !== field));

    expect(isCustomReport(report)).toBe(false);
  });

  it.each([30, 90, 180])('accepts a %i-day period', (days) => {
    expect(isCustomReport({
      ...buildCustomReport(),
      days,
    })).toBe(true);
  });

  it.each([60, '90', null])('rejects a period of %s', (days) => {
    expect(isCustomReport({
      ...buildCustomReport(),
      days,
    })).toBe(false);
  });

  it('rejects a title that is not a string', () => {
    expect(isCustomReport({
      ...buildCustomReport(),
      title: 7,
    })).toBe(false);
  });

  it('rejects blocks that are not an array', () => {
    expect(isCustomReport({
      ...buildCustomReport(),
      blocks: { type: 'heading' },
    })).toBe(false);
  });

  it.each([
    {
      description: 'a block without a type',
      block: { text: 'Orphan' },
    },
    {
      description: 'a block whose type is a number',
      block: { type: 2 },
    },
    {
      description: 'a block that is a string',
      block: 'heading',
    },
    {
      description: 'a block that is an array',
      block: ['heading'],
    },
    {
      description: 'a null block',
      block: null,
    },
  ])('rejects $description', ({ block }) => {
    expect(isCustomReport({
      ...buildCustomReport(),
      blocks: [block],
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(isCustomReport(null)).toBe(false);
  });
});

describe('isCustomReportsResponse', () => {
  it('accepts a list of reports', () => {
    expect(isCustomReportsResponse({ reports: [buildCustomReport(), buildCustomReport({ id: 'report-launch' })] })).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(isCustomReportsResponse({ reports: [] })).toBe(true);
  });

  it('rejects a list holding an invalid report', () => {
    expect(isCustomReportsResponse({ reports: [buildCustomReport(), { id: 'report-broken' }] })).toBe(false);
  });

  it('rejects a response without a list', () => {
    expect(isCustomReportsResponse({ report: buildCustomReport() })).toBe(false);
  });
});

describe('isCustomReportResponse', () => {
  it('accepts a response wrapping a report', () => {
    expect(isCustomReportResponse({ report: buildCustomReport() })).toBe(true);
  });

  it('rejects a bare report', () => {
    expect(isCustomReportResponse(buildCustomReport())).toBe(false);
  });
});
