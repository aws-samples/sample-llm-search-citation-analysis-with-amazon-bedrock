import {
  marketFormValues, type MarketFormValues
} from './marketFormModel';
import { CHILE } from '../Markets/markets-fixtures';

/** The form of Chile in Spanish with the name left blank (so it defaults); `overrides` replaces single fields. */
export function buildMarketFormValues(overrides: Partial<MarketFormValues> = {}): MarketFormValues {
  return {
    ...marketFormValues(CHILE),
    name: '',
    ...overrides,
  };
}
