import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderCitationRateTooltip as renderTooltip, TOOLTIP_TEXT as TEXT, tooltipIdOf
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

  it('renders its text outside the page layout so a scroll container cannot clip it', () => {
    renderTooltip();

    expect(document.getElementById(tooltipIdOf(screen.getByRole('button')))?.parentElement).toBe(document.body);
  });

  it('places the open tooltip inside the viewport next to its button', async () => {
    renderTooltip();

    await userEvent.tab();

    expect([screen.getByRole('tooltip').style.top, screen.getByRole('tooltip').style.left]).toStrictEqual(['8px', '8px']);
  });

  it.each([
    {
      cause: 'the page scrolls',
      buttonTop: 200,
      dispatch: () => fireEvent.scroll(window),
      expectedTop: '224px',
    },
    {
      cause: 'a scroll container around it scrolls',
      buttonTop: 300,
      dispatch: (button: HTMLElement) => fireEvent.scroll(button.parentElement ?? button),
      expectedTop: '324px',
    },
    {
      cause: 'the window is resized',
      buttonTop: 400,
      dispatch: () => fireEvent(window, new Event('resize')),
      expectedTop: '424px',
    },
  ])('follows its button when $cause while it is open', async ({
    buttonTop, dispatch, expectedTop
  }) => {
    const button = renderTooltip();
    await userEvent.tab();

    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, buttonTop, 16, 16));
    dispatch(button);

    expect(screen.getByRole('tooltip').style.top).toBe(expectedTop);
  });

  it('does not listen to scroll or resize while it is closed', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderTooltip();

    expect(addSpy.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize')).toStrictEqual([]);
  });

  it('stops listening to scroll, in the capture phase, and to resize when it closes', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    renderTooltip();
    await userEvent.tab();

    await userEvent.tab();

    expect(removeSpy.mock.calls.map(([type, , options]) => [type, options])).toStrictEqual(
      expect.arrayContaining([['scroll', true], ['resize', undefined]]),
    );
  });
});
