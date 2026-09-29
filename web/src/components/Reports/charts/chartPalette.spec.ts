import {
  describe, expect, it
} from 'vitest';
import {
  AMBER, CLASSIFICATION_SHADES, COMPETITOR_LINE_COLOURS, EMERALD, GRAY, paletteColour, resolveColour
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

describe('CLASSIFICATION_SHADES', () => {
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
