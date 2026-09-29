import {
  describe, expect, it
} from 'vitest';
import {
  AMBER, CLASSIFICATION_SHADES, COMPETITOR_LINE_COLOURS, EMERALD, GRAY, INDIGO, OTHER_BRANDS_GRAY, paletteColour, RED, resolveColour
} from './chartPalette';

describe('resolveColour', () => {
  it('returns the light variant in light mode', () => {
    expect(resolveColour(GRAY, false)).toBe('rgb(156, 163, 175)');
  });

  it('returns the dark variant in dark mode', () => {
    expect(resolveColour(GRAY, true)).toBe('rgb(107, 114, 128)');
  });
});

describe('paletteColour', () => {
  it('returns the colour at the index within the palette', () => {
    expect(paletteColour(COMPETITOR_LINE_COLOURS, 1)).toStrictEqual(COMPETITOR_LINE_COLOURS[1]);
  });

  it('starts over after the last colour', () => {
    expect(paletteColour(COMPETITOR_LINE_COLOURS, 5)).toStrictEqual(AMBER);
  });
});

describe('the named chart colours', () => {
  it.each([
    ['EMERALD', 'rgb(16, 185, 129)', 'rgb(16, 185, 129)', EMERALD],
    ['AMBER', 'rgb(245, 158, 11)', 'rgb(245, 158, 11)', AMBER],
    ['RED', 'rgb(239, 68, 68)', 'rgb(239, 68, 68)', RED],
    ['INDIGO', 'rgb(99, 102, 241)', 'rgb(99, 102, 241)', INDIGO],
    ['GRAY', 'rgb(156, 163, 175)', 'rgb(107, 114, 128)', GRAY],
    ['OTHER_BRANDS_GRAY', 'rgb(209, 213, 219)', 'rgb(75, 85, 99)', OTHER_BRANDS_GRAY],
  ] as const)('%s is %s on light and %s on dark', (_name, light, dark, colour) => {
    expect(colour).toStrictEqual({
      light,
      dark,
    });
  });
});

describe('CLASSIFICATION_SHADES', () => {
  it.each([
    ['first_party', [
      ['rgb(16, 185, 129)', 'rgb(16, 185, 129)'],
      ['rgb(5, 150, 105)', 'rgb(5, 150, 105)'],
      ['rgb(110, 231, 183)', 'rgb(110, 231, 183)'],
      ['rgb(4, 120, 87)', 'rgb(4, 120, 87)'],
    ]],
    ['competitor', [
      ['rgb(245, 158, 11)', 'rgb(245, 158, 11)'],
      ['rgb(252, 211, 77)', 'rgb(252, 211, 77)'],
      ['rgb(217, 119, 6)', 'rgb(217, 119, 6)'],
      ['rgb(253, 230, 138)', 'rgb(253, 230, 138)'],
      ['rgb(180, 83, 9)', 'rgb(180, 83, 9)'],
    ]],
    ['other', [
      ['rgb(156, 163, 175)', 'rgb(107, 114, 128)'],
      ['rgb(107, 114, 128)', 'rgb(156, 163, 175)'],
      ['rgb(75, 85, 99)', 'rgb(209, 213, 219)'],
    ]],
  ] as const)('shades %s brands in turn with these light and dark colours', (classification, shades) => {
    expect(CLASSIFICATION_SHADES[classification].map((shade) => [shade.light, shade.dark])).toStrictEqual(shades);
  });

  it.each([
    ['first_party', EMERALD],
    ['competitor', AMBER],
    ['other', GRAY],
  ] as const)('starts the %s shades with the design-system colour', (classification, first) => {
    expect(CLASSIFICATION_SHADES[classification][0]).toStrictEqual(first);
  });

  it('gives every first-party shade a distinct colour', () => {
    expect(new Set(CLASSIFICATION_SHADES.first_party.map((shade) => shade.light)).size).toBe(CLASSIFICATION_SHADES.first_party.length);
  });

  it('gives every competitor shade a distinct colour', () => {
    expect(new Set(CLASSIFICATION_SHADES.competitor.map((shade) => shade.light)).size).toBe(CLASSIFICATION_SHADES.competitor.length);
  });
});

describe('COMPETITOR_LINE_COLOURS', () => {
  it('draws competitors in amber, orange, rose, violet and sky', () => {
    expect(COMPETITOR_LINE_COLOURS.map((colour) => colour.light)).toStrictEqual([
      'rgb(245, 158, 11)', 'rgb(249, 115, 22)', 'rgb(244, 63, 94)', 'rgb(139, 92, 246)', 'rgb(14, 165, 233)',
    ]);
  });
});
