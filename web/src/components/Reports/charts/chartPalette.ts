/**
 * Dataset colours of the report charts (`docs/design-system.md` §2 and
 * §7.5): emerald is your brand and success, amber the competitors, gray the
 * neutral series and the other brands, red the negative. Saturated colours
 * read on both backgrounds and stay fixed; the grays have a light and a dark
 * variant.
 */
import type { BrandClassification } from '../../../types/domain/brands';

/** A dataset colour in the light and the dark theme. */
export interface ThemedColour {
  readonly light: string;
  readonly dark: string;
}

function fixed(colour: string): ThemedColour {
  return {
    light: colour,
    dark: colour,
  };
}

/** The variant of `colour` for the current theme. */
export function resolveColour(colour: ThemedColour, isDark: boolean): string {
  return colour[isDark ? 'dark' : 'light'];
}

/** emerald-500: your brand, your domains, positive sentiment. */
export const EMERALD = fixed('rgb(16, 185, 129)');
/** amber-500: competitors, mixed sentiment. */
export const AMBER = fixed('rgb(245, 158, 11)');
/** red-500: negative sentiment. */
export const RED = fixed('rgb(239, 68, 68)');
/** indigo-500: domains that are not yours. */
export const INDIGO = fixed('rgb(99, 102, 241)');
/** gray-400 on light, gray-500 on dark: neutral sentiment. */
export const GRAY: ThemedColour = {
  light: 'rgb(156, 163, 175)',
  dark: 'rgb(107, 114, 128)',
};
/** gray-300 on light, gray-600 on dark: everything grouped as "Other brands". */
export const OTHER_BRANDS_GRAY: ThemedColour = {
  light: 'rgb(209, 213, 219)',
  dark: 'rgb(75, 85, 99)',
};

/** Slice shades per brand classification, used in turn: first-party emerald, competitors amber, others gray. */
export const CLASSIFICATION_SHADES: Readonly<Record<BrandClassification, readonly ThemedColour[]>> = {
  first_party: [
    EMERALD,
    fixed('rgb(5, 150, 105)'),
    fixed('rgb(110, 231, 183)'),
    fixed('rgb(4, 120, 87)'),
  ],
  competitor: [
    AMBER,
    fixed('rgb(252, 211, 77)'),
    fixed('rgb(217, 119, 6)'),
    fixed('rgb(253, 230, 138)'),
    fixed('rgb(180, 83, 9)'),
  ],
  other: [
    GRAY,
    {
      light: 'rgb(107, 114, 128)',
      dark: 'rgb(156, 163, 175)',
    },
    {
      light: 'rgb(75, 85, 99)',
      dark: 'rgb(209, 213, 219)',
    },
  ],
};

/** Competitor lines, used in turn: amber, orange, rose, violet, sky (all -500). */
export const COMPETITOR_LINE_COLOURS: readonly ThemedColour[] = [
  AMBER,
  fixed('rgb(249, 115, 22)'),
  fixed('rgb(244, 63, 94)'),
  fixed('rgb(139, 92, 246)'),
  fixed('rgb(14, 165, 233)'),
];

/** The `index`-th colour of `palette`, starting over after the last. */
export function paletteColour(palette: readonly ThemedColour[], index: number): ThemedColour {
  return palette[index % palette.length];
}
