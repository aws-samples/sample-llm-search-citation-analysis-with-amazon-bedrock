import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderCitationRateTooltip as renderTooltip, TOOLTIP_TEXT as TEXT
} from './InfoTooltip-fixtures';

describe('InfoTooltip', () => {
  it('describes its button with the definition for screen readers', () => {
    expect(renderTooltip()).toHaveAccessibleDescription(TEXT);
  });

  it('starts closed', () => {
    renderTooltip();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on keyboard focus', async () => {
    renderTooltip();

    await userEvent.tab();

    expect(screen.getByRole('tooltip')).toHaveTextContent(TEXT);
  });

  it('closes when focus leaves', async () => {
    renderTooltip();

    await userEvent.tab();
    await userEvent.tab();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const button = renderTooltip();

    await userEvent.hover(button);
    const openOnHover = screen.queryByRole('tooltip') !== null;
    await userEvent.unhover(button);

    expect([openOnHover, screen.queryByRole('tooltip')]).toStrictEqual([true, null]);
  });

  it('toggles on click for touch screens', () => {
    const button = renderTooltip();

    fireEvent.click(button);
    const openAfterFirstClick = button.getAttribute('aria-expanded');
    fireEvent.click(button);

    expect([openAfterFirstClick, button.getAttribute('aria-expanded')]).toStrictEqual(['true', 'false']);
  });

  it('closes on Escape', async () => {
    renderTooltip();

    await userEvent.tab();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps other keys from closing it', async () => {
    renderTooltip();

    await userEvent.tab();
    await userEvent.keyboard('a');

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
