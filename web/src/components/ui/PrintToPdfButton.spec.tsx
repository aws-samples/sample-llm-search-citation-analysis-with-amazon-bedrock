import {
  render, screen, fireEvent,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { PrintToPdfButton } from './PrintToPdfButton';

/**
 * `PrintToPdfButton` opens the current URL in a new tab with `?print=1`
 * appended, so the auto-print layout in `MainApp` can take over there
 * without disturbing the user's current tab.
 *
 * These tests pin:
 *  - the button uses `window.open`, not `window.location.href` (so the
 *    current tab keeps state),
 *  - `?print=1` is appended to whatever path the user is on,
 *  - existing query params are preserved (e.g., persona filters),
 *  - the new tab is opened with `noopener,noreferrer` (security),
 *  - the button is keyboard-reachable with a descriptive aria-label.
 */

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PrintToPdfButton />
    </MemoryRouter>,
  );

describe('PrintToPdfButton', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('opens a new tab when clicked', () => {
    renderAt('/visibility');
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it('appends print=1 to the current path', () => {
    renderAt('/citations');
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledWith(
      '/citations?print=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('preserves existing query params alongside print=1', () => {
    renderAt('/visibility?persona=parent-with-kids');
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledWith(
      '/visibility?persona=parent-with-kids&print=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('overrides an existing print value rather than duplicating it', () => {
    renderAt('/brands?print=0');
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledWith(
      '/brands?print=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens the new tab with noopener,noreferrer to prevent reverse-tabnabbing', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledWith(
      expect.any(String),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('exposes a descriptive aria-label for assistive tech', () => {
    renderAt('/');
    expect(
      screen.getByLabelText('Save current view as PDF (opens in new tab)'),
    ).toBeInTheDocument();
  });
});
