import {
  describe, expect, it
} from 'vitest';
import {
  KPI_DEFINITIONS, KPI_IDS
} from '../../../constants/kpiDefinitions';
import {
  CHART_KPI_IDS, KPI_COLOURS, kpiLabelsInWords, kpiSeries, kpiValuesInWords
} from './chartKpis';
import { kpiPointSeries } from './charts-fixtures';

describe('CHART_KPI_IDS', () => {
  it('holds only percentages and scores', () => {
    expect(new Set(CHART_KPI_IDS.map((id) => KPI_DEFINITIONS[id].unit))).toStrictEqual(new Set(['percent', 'score']));
  });

  it('leaves out the counts, the average position and the net sentiment', () => {
    const charted = new Set<string>(CHART_KPI_IDS);

    expect(KPI_IDS.filter((id) => !charted.has(id))).toStrictEqual(['answers', 'mentions', 'average_position', 'citations', 'net_sentiment']);
  });
});

describe('KPI_COLOURS', () => {
  it.each(['light', 'dark'] as const)('gives every KPI its own %s colour', (variant) => {
    expect(new Set(CHART_KPI_IDS.map((id) => KPI_COLOURS[id][variant])).size).toBe(CHART_KPI_IDS.length);
  });
});

describe('kpiSeries', () => {
  it('names each series after its KPI definition', () => {
    expect(kpiPointSeries(['top_3_share', 'keyword_coverage']).map((line) => line.label)).toStrictEqual(['Top-3 share', 'Keyword coverage']);
  });

  it('colours each series with its KPI colour', () => {
    expect(kpiPointSeries(['citation_share']).map((line) => line.colour)).toStrictEqual([KPI_COLOURS.citation_share]);
  });

  it('takes one point per category, in the given order', () => {
    expect(kpiPointSeries(['citation_rate'])[0].points).toStrictEqual([
      {
        label: '2026-09-01',
        value: 29,
      },
      {
        label: '2026-09-08',
        value: null,
      },
    ]);
  });

  it('returns no series without a category', () => {
    expect(kpiSeries([], ['mention_rate'])).toStrictEqual([]);
  });
});

describe('kpiLabelsInWords', () => {
  it('lists the KPI labels in words', () => {
    expect(kpiLabelsInWords(['mention_rate', 'top_1_share', 'engine_coverage'])).toBe('Mention rate, Top-1 share and Engine coverage');
  });
});

describe('kpiValuesInWords', () => {
  it('writes each KPI value at the point as its KPI reads, unknown as a dash', () => {
    expect(kpiValuesInWords(kpiPointSeries(['visibility_score', 'citation_rate']), 1)).toBe('Visibility score 52.4, Citation rate —');
  });
});
