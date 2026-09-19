import {
  screen, within 
} from '@testing-library/react';

/**
 * The visible labels of every option the rendered scope selector offers, in
 * document order — so a spec can pin the whole list with one assertion.
 * Scoped to the selector's own `<select>` (found by its label) because pages
 * often render other dropdowns, such as the persona filter, alongside it.
 */
export function renderedScopeOptionLabels(selectorLabel = 'Scope'): Array<string | null> {
  const selector = screen.getByRole('combobox', { name: selectorLabel });
  return within(selector).getAllByRole('option').map((option) => option.textContent);
}
