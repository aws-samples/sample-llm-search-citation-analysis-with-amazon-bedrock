import {
  describe, expect, it
} from 'vitest';
import { themedAxis } from '../../ui/chartTheme';
import {
  describeSentimentSplit, labelledMentions
} from './sentimentSplitChartConfiguration';
import {
  AMBER, EMERALD, GRAY, RED
} from './chartPalette';
import {
  buildSentimentRow, LIGHT_THEME, SENTIMENT_ROWS, sentimentChart
} from './charts-fixtures';

describe('buildSentimentSplitChartConfiguration', () => {
  it('is a horizontal bar chart', () => {
    const chart = sentimentChart();

    expect([chart.type, chart.options?.indexAxis]).toStrictEqual(['bar', 'y']);
  });

  it('draws a bar per row, top to bottom', () => {
    expect(sentimentChart().data.labels).toStrictEqual(['Nike', 'Puma']);
  });

  it('stacks positive, neutral, mixed and negative, in that order', () => {
    expect(sentimentChart().data.datasets.map((dataset) => dataset.label)).toStrictEqual(['Positive', 'Neutral', 'Mixed', 'Negative']);
  });

  it('plots each sentiment as a % of the row\'s labelled mentions, a row without one as an empty bar', () => {
    expect(sentimentChart().data.datasets.map((dataset) => dataset.data)).toStrictEqual([[41.7, null], [33.3, null], [16.7, null], [8.3, null]]);
  });

  it('colours positive emerald, neutral gray, mixed amber and negative red', () => {
    expect(sentimentChart().data.datasets.map((dataset) => dataset.backgroundColor)).toStrictEqual([EMERALD.light, GRAY.light, AMBER.light, RED.light]);
  });

  it('draws neutral in the dark gray in dark mode', () => {
    expect(sentimentChart(SENTIMENT_ROWS, true).data.datasets[1].backgroundColor).toBe(GRAY.dark);
  });

  it('stacks the sentiments to 100% along the value axis', () => {
    expect(sentimentChart().options?.scales?.x).toStrictEqual(themedAxis(LIGHT_THEME, {
      stacked: true,
      min: 0,
      max: 100,
    }));
  });

  it('stacks the sentiments of a row in one bar', () => {
    expect(sentimentChart().options?.scales?.y).toStrictEqual(themedAxis(LIGHT_THEME, { stacked: true }));
  });

  it('draws nothing without a row', () => {
    expect(sentimentChart([]).data).toStrictEqual({
      labels: [],
      datasets: [],
    });
  });
});

describe('labelledMentions', () => {
  it('adds up the positive, neutral, mixed and negative mentions', () => {
    expect(labelledMentions(buildSentimentRow('Nike', [5, 4, 2, 1]).split)).toBe(12);
  });
});

describe('describeSentimentSplit', () => {
  it('summarises each row\'s split in words and says which rows have no labelled mention', () => {
    expect(describeSentimentSplit(SENTIMENT_ROWS)).toBe(
      'Sentiment of the labelled mentions per row, stacked to 100%. '
      + 'Nike: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions. Puma: no labelled mention.',
    );
  });

  it('counts a single labelled mention in the singular', () => {
    expect(describeSentimentSplit([buildSentimentRow('Asics', [0, 0, 0, 1])])).toBe(
      'Sentiment of the labelled mentions per row, stacked to 100%. Asics: 0.0% positive, 0.0% neutral, 0.0% mixed, 100.0% negative of 1 labelled mention.',
    );
  });

  it('says nothing without a row', () => {
    expect(describeSentimentSplit([])).toBe('');
  });
});
