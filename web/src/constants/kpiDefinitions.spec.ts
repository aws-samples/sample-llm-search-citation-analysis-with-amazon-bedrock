import {
  describe, expect, it
} from 'vitest';
import {
  GROUP_REPORT_DEFINITIONS, GROUP_RUN_DEFINITION, KPI_DEFINITIONS, KPI_IDS, KPI_SPECS, TREND_DEFINITION
} from './kpiDefinitions';

describe('KPI_SPECS', () => {
  it('lists every KPI in the order of KPI_IDS', () => {
    expect(KPI_SPECS.map((spec) => spec.id)).toStrictEqual([...KPI_IDS]);
  });

  it('gives every KPI a distinct label', () => {
    expect(new Set(KPI_SPECS.map((spec) => spec.label)).size).toBe(KPI_IDS.length);
  });
});

describe('KPI_DEFINITIONS', () => {
  it('keys every KPI by its own id', () => {
    expect(Object.entries(KPI_DEFINITIONS).filter(([key, spec]) => key !== spec.id)).toStrictEqual([]);
  });

  it('defines exactly the KPIs of KPI_IDS', () => {
    expect(Object.keys(KPI_DEFINITIONS)).toStrictEqual([...KPI_IDS]);
  });

  it.each([
    ['answers', 'count'],
    ['mentions', 'count'],
    ['mention_rate', 'percent'],
    ['share_of_voice', 'percent'],
    ['average_position', 'position'],
    ['top_1_share', 'percent'],
    ['top_3_share', 'percent'],
    ['visibility_score', 'score'],
    ['citations', 'count'],
    ['citation_rate', 'percent'],
    ['citation_share', 'percent'],
    ['net_sentiment', 'net'],
    ['engine_coverage', 'percent'],
    ['keyword_coverage', 'percent'],
  ] as const)('measures %s as a %s', (id, unit) => {
    expect(KPI_DEFINITIONS[id].unit).toBe(unit);
  });
});

describe('GROUP_REPORT_DEFINITIONS', () => {
  it('lists every KPI, then the group run, then the trend rule', () => {
    expect(GROUP_REPORT_DEFINITIONS).toStrictEqual([...KPI_SPECS, GROUP_RUN_DEFINITION, TREND_DEFINITION]);
  });

  it('labels every entry distinctly, so each can key its definitions block row', () => {
    expect(new Set(GROUP_REPORT_DEFINITIONS.map((entry) => entry.label)).size).toBe(GROUP_REPORT_DEFINITIONS.length);
  });
});
