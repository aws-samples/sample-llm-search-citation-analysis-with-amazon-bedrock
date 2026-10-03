import {
  describe, it, expect
} from 'vitest';
import { buildChartData } from './KeywordDetailComponents';

describe('buildChartData', () => {
  it('labels the per-run citation lines with the provider display names', () => {
    const { lineChartData } = buildChartData([], {});

    expect(lineChartData.datasets.map((dataset) => dataset.label)).toStrictEqual([
      'Anthropic Claude', 'Google Gemini', 'OpenAI', 'Perplexity',
    ]);
  });

  it('labels the citation-frequency bars with the provider display names', () => {
    const { barChartData } = buildChartData([], {});

    expect(barChartData.datasets.map((dataset) => dataset.label)).toStrictEqual([
      'Anthropic Claude', 'Google Gemini', 'OpenAI', 'Perplexity',
    ]);
  });

  it('draws each provider line in its own colour', () => {
    const { lineChartData } = buildChartData([], {});

    expect(lineChartData.datasets.map((dataset) => dataset.borderColor)).toStrictEqual([
      'rgb(168, 85, 247)', 'rgb(59, 130, 246)', 'rgb(16, 185, 129)', 'rgb(249, 115, 22)',
    ]);
  });
});
