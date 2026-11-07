import {
  describe, expect, it
} from 'vitest';
import { buildCompletedResult } from '../../../api/seoPerformance-fixtures';
import { excelTableRows } from '../../../exporters/tableExcel';
import {
  METRIC_COLUMNS, OPPORTUNITY_COLUMNS, metricRows
} from './lighthouseExcel';

const LINKED_DESCRIPTION = 'Inline critical CSS. [Learn more](https://developer.chrome.com/docs/lighthouse/render-blocking).';

describe('opportunities Excel columns', () => {
  it('writes each failed audit with raw savings and score numbers', () => {
    const result = buildCompletedResult();

    expect(excelTableRows(OPPORTUNITY_COLUMNS, result.failed_audits)).toStrictEqual([{
      'Severity': 'critical',
      'Category': 'Performance',
      'Audit': 'Eliminate render-blocking resources',
      'Savings (ms)': 350,
      'Savings (bytes)': 153_600,
      'Score (0-100)': 40,
      'Description': 'Resources are blocking the first paint of the page.',
    }]);
  });

  it('keeps the Markdown links of a description as text', () => {
    const [audit] = buildCompletedResult().failed_audits;
    const linked = {
      ...audit,
      description: LINKED_DESCRIPTION,
    };

    expect(excelTableRows(OPPORTUNITY_COLUMNS, [linked])[0]['Description']).toBe(LINKED_DESCRIPTION);
  });

  it('leaves the savings and score empty when Lighthouse gives none', () => {
    const [audit] = buildCompletedResult().failed_audits;
    const bare = {
      ...audit,
      savings_ms: null,
      savings_bytes: null,
      score: null,
    };
    const [row] = excelTableRows(OPPORTUNITY_COLUMNS, [bare]);

    expect([row['Savings (ms)'], row['Savings (bytes)'], row['Score (0-100)']]).toStrictEqual(['', '', '']);
  });
});

describe('metrics Excel columns', () => {
  it('writes the six metrics in the table order', () => {
    expect(excelTableRows(METRIC_COLUMNS, metricRows(buildCompletedResult())).map((row) => row['Metric'])).toStrictEqual([
      'Largest Contentful Paint', 'Cumulative Layout Shift', 'Interaction to Next Paint',
      'Server response time (TTFB)', 'First Contentful Paint', 'Total Blocking Time',
    ]);
  });

  it('writes a millisecond metric with its raw value, rating and thresholds', () => {
    const [lcp] = excelTableRows(METRIC_COLUMNS, metricRows(buildCompletedResult()));

    expect(lcp).toStrictEqual({
      'Metric': 'Largest Contentful Paint',
      'Core Web Vital': 'Yes',
      'Value': 4600,
      'Unit': 'ms',
      'Rating': 'Poor',
      'Good up to': 2500,
      'Poor above': 4000,
    });
  });

  it('writes the unitless layout shift without a unit', () => {
    const cls = excelTableRows(METRIC_COLUMNS, metricRows(buildCompletedResult()))[1];

    expect([cls['Value'], cls['Unit'], cls['Rating']]).toStrictEqual([0.05, '', 'Good']);
  });

  it('leaves the value and rating empty for a metric the lab run could not measure', () => {
    const inp = excelTableRows(METRIC_COLUMNS, metricRows(buildCompletedResult()))[2];

    expect([inp['Value'], inp['Rating'], inp['Core Web Vital']]).toStrictEqual(['', '', 'Yes']);
  });
});
