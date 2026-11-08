import {
  describe, expect, it
} from 'vitest';
import {
  bubbleRadius, buildSeoGeoChartConfiguration, describeSeoGeoChart, pointLabel, seoGeoPoints
} from './seoGeoChartConfiguration';
import { getChartTheme } from '../../ui/chartTheme';
import {
  BEYOND_TOP_ROW, buildSeoGeoRow, NO_DATA_ROW
} from '../../../hooks/useSeoGeo-fixtures';

const ROWS = [buildSeoGeoRow(), BEYOND_TOP_ROW, NO_DATA_ROW];
const CONFIGURATION = buildSeoGeoChartConfiguration(seoGeoPoints(ROWS), getChartTheme(false), false);

describe('seoGeoPoints', () => {
  it('plots every keyword with data and leaves out the ones without', () => {
    expect(seoGeoPoints(ROWS).map((point) => point.keyword)).toStrictEqual(['cheap flights geneva', 'example air lounge access']);
  });

  it('places a keyword beyond the organic top 10 in the column after position 10', () => {
    expect(seoGeoPoints([BEYOND_TOP_ROW])[0].x).toBe(11);
  });
});

describe('bubbleRadius', () => {
  it('gives the largest volume the largest bubble', () => {
    expect(bubbleRadius(12100, 12100)).toBe(18);
  });

  it('gives a keyword without volume the smallest bubble', () => {
    expect(bubbleRadius(null, 12100)).toBe(4);
  });

  it('grows the bubble area with the volume', () => {
    expect(bubbleRadius(3025, 12100)).toBe(11);
  });
});

describe('buildSeoGeoChartConfiguration', () => {
  it('draws one bubble dataset per quadrant with data', () => {
    expect(CONFIGURATION.data.datasets.map((dataset) => [dataset.label, dataset.data.length])).toStrictEqual([
      ['Both strong', 0],
      ['AI gap', 1],
      ['SEO gap', 1],
      ['Both weak', 0],
    ]);
  });

  it('colours the AI gap bubbles amber', () => {
    expect(CONFIGURATION.data.datasets[1].backgroundColor).toBe('rgb(245, 158, 11)');
  });
});

describe('pointLabel', () => {
  it('names the keyword, its position and its mention rate', () => {
    const label = pointLabel([[], seoGeoPoints([BEYOND_TOP_ROW])]);

    expect(label({
      datasetIndex: 1,
      dataIndex: 0,
    })).toBe('example air lounge access: >10, 80.0%');
  });
});

describe('describeSeoGeoChart', () => {
  it('counts the plotted keywords per quadrant', () => {
    expect(describeSeoGeoChart(seoGeoPoints(ROWS))).toBe(
      '2 keywords by organic position and AI mention rate, bubble size by search volume: 0 Both strong, 1 AI gap, 1 SEO gap and 0 Both weak.',
    );
  });
});
