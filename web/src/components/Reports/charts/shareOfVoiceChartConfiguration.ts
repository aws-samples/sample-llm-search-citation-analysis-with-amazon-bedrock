import type {
  ChartConfiguration, TooltipItem
} from 'chart.js';
import type { BrandLeaderboardRow } from '../../../types/domain/visibility';
import { formatKpi } from '../../../formatting/kpiFormatter';
import {
  themedLegend, themedTooltip, type ChartTheme
} from '../../ui/chartTheme';
import {
  CLASSIFICATION_SHADES, OTHER_BRANDS_GRAY, paletteColour, type ThemedColour
} from './chartPalette';
import { resolveColours } from './chartOptions';
import { listInWords } from './chartSeries';

/** How many brands get their own slice unless told otherwise. */
export const DEFAULT_SHARE_OF_VOICE_LIMIT = 6;

/** The slice of every brand past the limit. */
export const OTHER_BRANDS_LABEL = 'Other brands';

export interface ShareOfVoiceSlice {
  readonly name: string;
  /** Share of voice, in %. */
  readonly share: number;
  readonly colour: ThemedColour;
}

type RankedBrand = BrandLeaderboardRow & { share_of_voice: number };

function hasShare(brand: BrandLeaderboardRow): brand is RankedBrand {
  return brand.share_of_voice !== null;
}

function brandSlice(brand: RankedBrand, index: number, shown: readonly RankedBrand[]): ShareOfVoiceSlice {
  const sameClass = shown.slice(0, index).filter((earlier) => earlier.classification === brand.classification).length;
  return {
    name: brand.name,
    share: brand.share_of_voice,
    colour: paletteColour(CLASSIFICATION_SHADES[brand.classification], sameClass),
  };
}

/**
 * The `limit` brands with the largest share of voice (ties in leaderboard
 * order), each shaded by classification, then one "Other brands" slice with
 * the rest's share when it is above zero. Brands without a share are left
 * out; nothing to draw when no brand has a share above zero.
 */
export function shareOfVoiceSlices(brands: readonly BrandLeaderboardRow[], limit: number): ShareOfVoiceSlice[] {
  const ranked = brands.filter(hasShare).sort((left, right) => right.share_of_voice - left.share_of_voice);
  const shown = ranked.slice(0, Math.max(0, limit));
  const rest = ranked.slice(shown.length);
  const slices = shown.map(brandSlice);
  const restShare = Math.round(rest.reduce((sum, brand) => sum + brand.share_of_voice, 0) * 10) / 10;
  const withRest = restShare > 0
    ? [...slices, {
      name: OTHER_BRANDS_LABEL,
      share: restShare,
      colour: OTHER_BRANDS_GRAY,
    }]
    : slices;
  return withRest.some((slice) => slice.share > 0) ? withRest : [];
}

/** A slice's legend and tooltip label: "Nike 25.0%". */
export function sliceLabel(slice: ShareOfVoiceSlice): string {
  return `${slice.name} ${formatKpi('share_of_voice', slice.share)}`;
}

/** The tooltip shows the slice label alone, since it already carries the share. */
export function sliceTooltipLabel(item: Pick<TooltipItem<'doughnut'>, 'label'>): string {
  return item.label;
}

/** A doughnut of the slices, labelled with each share of voice. */
export function buildShareOfVoiceChartConfiguration(
  slices: readonly ShareOfVoiceSlice[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'doughnut'> {
  return {
    type: 'doughnut',
    data: {
      labels: slices.map(sliceLabel),
      datasets: [{
        label: 'Share of voice',
        data: slices.map((slice) => slice.share),
        backgroundColor: resolveColours(slices.map((slice) => slice.colour), isDark),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: themedLegend(theme),
        tooltip: {
          ...themedTooltip(theme),
          callbacks: { label: sliceTooltipLabel },
        },
      },
    },
  };
}

/** "Share of voice: Nike 25.0%, Adidas 20.8% and Other brands 12.5%." */
export function describeShareOfVoice(slices: readonly ShareOfVoiceSlice[]): string {
  if (slices.length === 0) return '';
  return `Share of voice: ${listInWords(slices.map(sliceLabel))}.`;
}
