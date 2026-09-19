import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { render } from '@testing-library/react';

/**
 * Asserts that `element` renders no DOM at all — the component returned
 * `null`. Report sections do this to drop out of the printed report when
 * they have nothing to say.
 */
export function expectRendersNothing(element: ReactElement): void {
  const { container } = render(element);
  expect(container.firstChild).toBeNull();
}
