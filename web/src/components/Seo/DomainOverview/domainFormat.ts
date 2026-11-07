/** How the Domain Overview words its numbers: the shared table formats, a dash for every unknown value. */
import type { KeywordIntent } from '../../../types/api/seo';
import type { ChipTone } from '../../ui/tableCells';

export {
  compactText, compactUsdText, decimalText, integerText, usdText
} from '../../ui/numberFormat';

/**
 * The chip tone of each search intent, one per intent (design-system accents): informational blue (info),
 * commercial purple, transactional green, navigational indigo, unknown neutral.
 */
export const INTENT_TONES: Readonly<Record<KeywordIntent, ChipTone>> = {
  informational: 'blue',
  commercial: 'purple',
  transactional: 'green',
  navigational: 'indigo',
  unknown: 'neutral',
};

/** Under an answer read from the 12-hour cache. */
export const CACHED_NOTE = 'From cache (refreshes every 12 hours)';
