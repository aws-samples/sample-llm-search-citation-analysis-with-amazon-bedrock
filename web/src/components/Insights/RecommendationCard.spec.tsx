import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationCard } from './RecommendationCard';
import { VISIBILITY_GAP_RECOMMENDATION } from './Recommendations-fixtures';

/** Renders the "Improve visibility" card; returns its toggle spy. */
function renderCard(isExpanded = false) {
  const onClick = vi.fn();
  render(
    <RecommendationCard
      rec={VISIBILITY_GAP_RECOMMENDATION}
      isExpanded={isExpanded}
      onClick={onClick}
      statusControl={<select aria-label="Status" onClick={(event) => event.stopPropagation()}><option>New</option></select>}
    />
  );
  return onClick;
}

describe('RecommendationCard', () => {
  it('exposes the title as a collapsed toggle button', () => {
    renderCard();

    expect(screen.getByRole('button', { name: 'Improve visibility' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the toggle expanded and points it at the shown details', () => {
    renderCard(true);

    const toggle = screen.getByRole('button', { name: 'Improve visibility' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toHaveTextContent('Create content');
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('toggles once when %s is pressed on the title', async (_key, keys) => {
    const onClick = renderCard();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Improve visibility' })).toHaveFocus();
    await userEvent.keyboard(keys);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('toggles once when the title is clicked', async () => {
    const onClick = renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Improve visibility' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still toggles when the mouse clicks elsewhere on the card', async () => {
    const onClick = renderCard();

    await userEvent.click(screen.getByText('Your brand needs more mentions'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not toggle when the status control is used', async () => {
    const onClick = renderCard();

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
