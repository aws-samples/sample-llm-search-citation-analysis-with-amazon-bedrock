import { screen } from '@testing-library/react';

/** A report's own title: the page's level-1 heading. */
export function getReportHeading(name: RegExp): HTMLElement {
  return screen.getByRole('heading', {
    level: 1,
    name,
  });
}
