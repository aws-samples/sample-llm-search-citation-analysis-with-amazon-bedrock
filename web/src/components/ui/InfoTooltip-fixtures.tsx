import {
  render, screen
} from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';

export const TOOLTIP_TEXT = 'Share of keywords whose AI answers mention the hotel.';

/** Mount a "Citation rate" tooltip and return its button. */
export function renderCitationRateTooltip(): HTMLElement {
  render(<InfoTooltip label="Citation rate" text={TOOLTIP_TEXT} />);
  return screen.getByRole('button', { name: 'About Citation rate' });
}
