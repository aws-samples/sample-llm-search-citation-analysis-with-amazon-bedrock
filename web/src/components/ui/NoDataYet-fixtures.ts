import { expect } from 'vitest';
import { screen } from '@testing-library/react';

/** Asserts the "no AI answers yet" state's link to Run Analysis is on screen. */
export function expectRunAnalysisLink(): void {
  expect(screen.getByRole('link', { name: 'Go to Run Analysis' }).getAttribute('href')).toBe('/execution');
}
