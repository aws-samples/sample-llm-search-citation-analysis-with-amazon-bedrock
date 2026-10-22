import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchBrandAppearances } from '../../api/brandMentions';
import { buildAppearanceRow } from '../../api/brandMentions-fixtures';
import { ApiRequestError } from '../../infrastructure';
import {
  GROUP_APPEARANCES_REQUEST, previewedBrand, renderOverview
} from './BrandOverviewTab-fixtures';

vi.mock('../../api/brandMentions', () => ({ fetchBrandAppearances: vi.fn() }));

const ALL_ROWS = ['openai', 'gemini', 'claude'].map((provider) => buildAppearanceRow({
  brand: 'Hotel Coruña',
  provider,
}));

/** The previewed brand on screen with "Show all 7 appearances" clicked. */
async function setupShowAll() {
  renderOverview(previewedBrand());
  await userEvent.click(screen.getByRole('button', { name: 'Show all 7 appearances' }));
}

/** The "show all" button, or `null` when the tab offers none. */
function queryShowAllElement() {
  return screen.queryByRole('button', { name: /Show all/ });
}

describe('BrandOverviewTab', () => {
  beforeEach(() => {
    vi.mocked(fetchBrandAppearances).mockResolvedValue(ALL_ROWS);
  });

  it('says how many appearances the preview leaves out', () => {
    renderOverview(previewedBrand());

    expect(screen.getByText('Best 2 of 7 appearances.')).toBeInTheDocument();
  });

  it('counts sentiments over every appearance, not only the preview', () => {
    renderOverview(previewedBrand());

    expect(screen.getByText('negative').previousElementSibling).toHaveTextContent('3');
    expect(screen.getByText('negative').nextElementSibling).toHaveTextContent('43%');
  });

  it('reads every appearance of the brand when asked to show all', async () => {
    await setupShowAll();

    expect(fetchBrandAppearances).toHaveBeenCalledWith({
      ...GROUP_APPEARANCES_REQUEST,
      brand: 'Hotel Coruña',
    });
  });

  it('lists the loaded appearances in place of the preview', async () => {
    await setupShowAll();

    expect(await screen.findByText('CLAUDE')).toBeInTheDocument();
    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('shows the error when the appearances cannot be read', async () => {
    vi.mocked(fetchBrandAppearances).mockRejectedValue(new ApiRequestError('Server error', 500));
    await setupShowAll();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load brand mentions');
  });

  it('offers no "show all" when the preview already holds every appearance', () => {
    renderOverview(previewedBrand(2));

    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('offers no "show all" without a request to read them with', () => {
    renderOverview(previewedBrand(), null);

    expect(queryShowAllElement()).not.toBeInTheDocument();
  });
});
