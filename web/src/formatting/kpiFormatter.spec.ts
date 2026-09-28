import {
  describe, expect, it
} from 'vitest';
import {
  EMPTY_KPI, formatKpi, formatKpiDelta
} from './kpiFormatter';
import {
  KPI_IDS, type KpiId
} from '../constants/kpiDefinitions';

describe('EMPTY_KPI', () => {
  it('is an em dash', () => {
    expect(EMPTY_KPI).toBe('—');
  });
});

describe('formatKpi', () => {
  it.each([
    ['answers', 12, '12'],
    ['mentions', 0, '0'],
    ['mention_rate', 42.54, '42.5%'],
    ['share_of_voice', 0, '0.0%'],
    ['keyword_coverage', 100, '100.0%'],
    ['average_position', 2.25, '2.25'],
    ['average_position', 1, '1.00'],
    ['visibility_score', 61.34, '61.3'],
    ['visibility_score', 0, '0.0'],
    ['net_sentiment', 20, '+20.0'],
    ['net_sentiment', -12.5, '-12.5'],
    ['net_sentiment', 0, '0.0'],
  ] as const)('writes the %s value %s as %s', (id, value, expected) => {
    expect(formatKpi(id, value)).toBe(expected);
  });

  it.each(KPI_IDS.map((id) => [id]))('writes an unknown %s value as a dash', (id: KpiId) => {
    expect([formatKpi(id, null), formatKpi(id, undefined)]).toStrictEqual([EMPTY_KPI, EMPTY_KPI]);
  });
});

describe('formatKpiDelta', () => {
  it.each([
    ['answers', 3, '+3'],
    ['citations', -2, '-2'],
    ['mentions', 0, '0'],
    ['mention_rate', 2.54, '+2.5 pts'],
    ['citation_rate', -2.54, '-2.5 pts'],
    ['top_1_share', 0, '0.0 pts'],
    ['average_position', 0.5, '+0.50'],
    ['average_position', -0.25, '-0.25'],
    ['average_position', 0, '0.00'],
    ['visibility_score', 4, '+4.0 pts'],
    ['visibility_score', -8.2, '-8.2 pts'],
    ['net_sentiment', 10, '+10.0 pts'],
    ['net_sentiment', -10, '-10.0 pts'],
    ['mention_rate', -0.04, '0.0 pts'],
    ['mention_rate', 0.04, '0.0 pts'],
    ['mention_rate', 0.05, '+0.1 pts'],
    ['average_position', -0.001, '0.00'],
  ] as const)('writes the %s change %s as %s', (id, value, expected) => {
    expect(formatKpiDelta(id, value)).toBe(expected);
  });

  it.each(KPI_IDS.map((id) => [id]))('writes an unknown %s change as a dash', (id: KpiId) => {
    expect([formatKpiDelta(id, null), formatKpiDelta(id, undefined)]).toStrictEqual([EMPTY_KPI, EMPTY_KPI]);
  });
});
