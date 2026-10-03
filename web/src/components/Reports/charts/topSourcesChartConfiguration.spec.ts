import {
  describe, expect, it
} from 'vitest';
import { themedAxis } from '../../ui/chartTheme';
import {
  buildSourceRow, buildSources
} from '../layout/reportPayload-fixtures';
import {
  DEFAULT_TOP_SOURCES_LIMIT, describeTopSources, sourceTooltipLines, topSources
} from './topSourcesChartConfiguration';
import {
  EMERALD, INDIGO
} from './chartPalette';
import {
  LIGHT_THEME, topSourcesChart
} from './charts-fixtures';

/** Twelve domains cited once each, in name order. */
const TWELVE_SOURCES = Array.from({ length: 12 }, (_unused, index) => buildSourceRow(`site-${String(index).padStart(2, '0')}.com`, { citations: 1 }));

describe('buildTopSourcesChartConfiguration', () => {
  it('ranks the domains most cited first, whatever their given order', () => {
    expect(topSourcesChart([...buildSources()].reverse()).data.labels).toStrictEqual(['runnersworld.com', 'nike.com', 'reddit.com']);
  });

  it('draws owned domains in the "Your domains" dataset and the rest in "Other domains"', () => {
    expect(topSourcesChart().data.datasets.map((dataset) => [dataset.label, dataset.data]))
      .toStrictEqual([['Your domains', [null, 6, null]], ['Other domains', [9, null, 5]]]);
  });

  it('colours owned domains emerald and the others indigo', () => {
    expect(topSourcesChart().data.datasets.map((dataset) => dataset.backgroundColor)).toStrictEqual([EMERALD.light, INDIGO.light]);
  });

  it('counts citations from zero in whole numbers, one bar per domain', () => {
    expect(topSourcesChart().options?.scales?.x).toStrictEqual(themedAxis(LIGHT_THEME, {
      stacked: true,
      beginAtZero: true,
      ticks: { precision: 0 },
    }));
  });

  it('adds the citation rate and share under the tooltip\'s citation count', () => {
    expect(topSourcesChart().options?.plugins?.tooltip?.callbacks).toStrictEqual({ afterLabel: expect.any(Function) });
  });

  it('draws nothing without a source', () => {
    expect(topSourcesChart([]).data.labels).toStrictEqual([]);
  });
});

describe('topSources', () => {
  it('ranks ten domains by default', () => {
    expect([DEFAULT_TOP_SOURCES_LIMIT, topSources(TWELVE_SOURCES, DEFAULT_TOP_SOURCES_LIMIT).length]).toStrictEqual([10, 10]);
  });

  it('keeps the given order between domains cited as often', () => {
    expect(topSources(TWELVE_SOURCES, 3).map((source) => source.domain)).toStrictEqual(['site-00.com', 'site-01.com', 'site-02.com']);
  });

  it('keeps only the most cited domains up to the limit', () => {
    expect(topSources(buildSources(), 1).map((source) => source.domain)).toStrictEqual(['runnersworld.com']);
  });

  it('ranks no domain with a negative limit', () => {
    expect(topSources(buildSources(), -1)).toStrictEqual([]);
  });
});

describe('sourceTooltipLines', () => {
  it('writes the hovered domain\'s citation rate and citation share', () => {
    expect(sourceTooltipLines(buildSources())({ dataIndex: 1 })).toStrictEqual(['Citation rate: 30.0%', 'Citation share: 30.0%']);
  });

  it('writes an unknown rate or share as a dash', () => {
    const sources = [buildSourceRow('example.com', {
      citation_rate: null,
      citation_share: null,
    })];

    expect(sourceTooltipLines(sources)({ dataIndex: 0 })).toStrictEqual(['Citation rate: —', 'Citation share: —']);
  });
});

describe('describeTopSources', () => {
  it('lists every ranked domain with its citations and marks the owned ones', () => {
    expect(describeTopSources(buildSources())).toBe(
      'Answers citing each of the 3 most cited domains: runnersworld.com 9, nike.com 6 (yours) and reddit.com 5.',
    );
  });

  it('says nothing without a domain', () => {
    expect(describeTopSources([])).toBe('');
  });
});
