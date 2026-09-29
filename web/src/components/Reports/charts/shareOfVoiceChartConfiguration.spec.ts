import {
  describe, expect, it
} from 'vitest';
import { buildBrandRow } from '../layout/reportPayload-fixtures';
import {
  DEFAULT_SHARE_OF_VOICE_LIMIT, describeShareOfVoice, OTHER_BRANDS_LABEL, shareOfVoiceSlices, sliceTooltipLabel
} from './shareOfVoiceChartConfiguration';
import {
  CLASSIFICATION_SHADES, OTHER_BRANDS_GRAY
} from './chartPalette';
import {
  LEADERBOARD, shareOfVoiceChart
} from './charts-fixtures';

describe('buildShareOfVoiceChartConfiguration', () => {
  it('gives six brands their own slice by default', () => {
    expect(DEFAULT_SHARE_OF_VOICE_LIMIT).toBe(6);
  });

  it('is a doughnut chart', () => {
    expect(shareOfVoiceChart().type).toBe('doughnut');
  });

  it('labels the top brands by share of voice, then the other brands, with each share', () => {
    expect(shareOfVoiceChart(LEADERBOARD, 3).data.labels).toStrictEqual(['Nike 30.0%', 'Adidas 20.0%', 'Asics 15.0%', 'Other brands 30.0%']);
  });

  it('sizes each slice by its share of voice, the other brands by their summed share', () => {
    expect(shareOfVoiceChart(LEADERBOARD, 3).data.datasets[0].data).toStrictEqual([30, 20, 15, 30]);
  });

  it('shades first-party brands emerald, competitors amber and other brands gray, each in turn', () => {
    expect(shareOfVoiceChart().data.datasets[0].backgroundColor).toStrictEqual([
      CLASSIFICATION_SHADES.first_party[0].light,
      CLASSIFICATION_SHADES.competitor[0].light,
      CLASSIFICATION_SHADES.competitor[1].light,
      CLASSIFICATION_SHADES.first_party[1].light,
      CLASSIFICATION_SHADES.competitor[2].light,
      CLASSIFICATION_SHADES.other[0].light,
    ]);
  });

  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('draws the other brands in the %s neutral gray', (variant, isDark) => {
    expect(shareOfVoiceChart(LEADERBOARD, 5, isDark).data.datasets[0].backgroundColor).toContain(OTHER_BRANDS_GRAY[variant]);
  });

  it('shows the tooltip with the slice label alone', () => {
    expect(shareOfVoiceChart().options?.plugins?.tooltip?.callbacks?.label).toBe(sliceTooltipLabel);
  });

  it('draws nothing without a brand', () => {
    expect(shareOfVoiceChart([]).data.labels).toStrictEqual([]);
  });
});

describe('shareOfVoiceSlices', () => {
  it('leaves out brands without a share and adds no other-brands slice when every brand fits', () => {
    expect(shareOfVoiceSlices(LEADERBOARD, 10).map((slice) => slice.name)).toStrictEqual(['Nike', 'Adidas', 'Asics', 'Jordan', 'Puma', 'Decathlon']);
  });

  it('keeps leaderboard order between brands with the same share', () => {
    const brands = [buildBrandRow('Saucony', { share_of_voice: 10 }), buildBrandRow('Brooks', { share_of_voice: 10 })];

    expect(shareOfVoiceSlices(brands, 6).map((slice) => slice.name)).toStrictEqual(['Saucony', 'Brooks']);
  });

  it('puts every brand in the other-brands slice with a limit of zero', () => {
    expect(shareOfVoiceSlices(LEADERBOARD, 0).map((slice) => [slice.name, slice.share])).toStrictEqual([[OTHER_BRANDS_LABEL, 95]]);
  });

  it('adds no other-brands slice when the rest have no share', () => {
    const brands = [buildBrandRow('Nike', { share_of_voice: 40 }), buildBrandRow('Puma', { share_of_voice: 0 })];

    expect(shareOfVoiceSlices(brands, 1).map((slice) => slice.name)).toStrictEqual(['Nike']);
  });

  it('rounds the other brands\' share to one decimal', () => {
    const brands = [buildBrandRow('On', { share_of_voice: 0.1 }), buildBrandRow('Hoka', { share_of_voice: 0.2 })];

    expect(shareOfVoiceSlices(brands, 0)[0].share).toBe(0.3);
  });

  it.each([
    ['no brand has a share', [buildBrandRow('Reebok', { share_of_voice: null })]],
    ['every share is zero', [buildBrandRow('Fila', { share_of_voice: 0 })]],
  ])('draws nothing when %s', (_case, brands) => {
    expect(shareOfVoiceSlices(brands, 6)).toStrictEqual([]);
  });
});

describe('sliceTooltipLabel', () => {
  it('returns the slice label, which already carries the share', () => {
    expect(sliceTooltipLabel({ label: 'Nike 30.0%' })).toBe('Nike 30.0%');
  });
});

describe('describeShareOfVoice', () => {
  it('lists every slice with its share in words', () => {
    expect(describeShareOfVoice(shareOfVoiceSlices(LEADERBOARD, 2))).toBe('Share of voice: Nike 30.0%, Adidas 20.0% and Other brands 45.0%.');
  });

  it('says nothing without a slice', () => {
    expect(describeShareOfVoice([])).toBe('');
  });
});
