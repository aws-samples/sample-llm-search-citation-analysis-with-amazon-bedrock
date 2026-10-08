import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import userEvent from '@testing-library/user-event';
import { mockApiGet } from '../../api/clientMock-fixtures';
import {
  screen, waitFor
} from '@testing-library/react';
import { buildKeyword } from '../../api/keywordGroups-fixtures';
import {
  BRAZIL, CHILE, renderMarketSelectionProvider
} from './markets-fixtures';
import {
  MARKET_STORAGE_KEY, storeMarketChoice
} from './marketSelection';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));

const CHILEAN_KEYWORD = buildKeyword({
  id: 'k-cl',
  market_id: 'cl-es',
});
const GLOBAL_KEYWORD = buildKeyword({ id: 'k-global' });

beforeEach(() => {
  localStorage.clear();
  mockApiGet.mockResolvedValue({
    markets: [CHILE, BRAZIL],
    updated_at: null,
  });
});

describe('MarketSelectionProvider', () => {
  it.each([
    ['every market for a keyword list without unassigned keywords', [CHILEAN_KEYWORD], 'all,cl-es,br-pt'],
    ['"No market" too when some keyword has none', [CHILEAN_KEYWORD, GLOBAL_KEYWORD], 'all,cl-es,br-pt,global'],
  ])('offers %s', async (_description, keywords, options) => {
    renderMarketSelectionProvider('/visibility', keywords);

    await waitFor(() => expect(screen.getByLabelText('Options')).toHaveTextContent(options));
  });

  it.each([
    ['every market combined with nothing remembered', null, 'all'],
    ['the remembered market', 'cl-es', 'cl-es'],
    ['every market when the remembered one was removed', 'mx-es', 'all'],
  ])('starts on %s', async (_description, stored, selected) => {
    storeMarketChoice(stored);

    renderMarketSelectionProvider('/visibility');

    await screen.findByRole('combobox', { name: 'Market' });
    expect(screen.getByLabelText('Selected market')).toHaveTextContent(selected);
  });

  it('remembers a picked market', async () => {
    renderMarketSelectionProvider('/visibility');

    await userEvent.click(screen.getByRole('button', { name: 'Pick Brazil' }));

    expect(localStorage.getItem(MARKET_STORAGE_KEY)).toBe('br-pt');
  });

  it.each([
    ['keeps the market out of the URL outside the reports', '/visibility', 'Pick Brazil', /^$/u],
    ['writes a picked market into a report URL', '/reports/benchmark?group=g1', 'Pick Brazil', '?group=g1&market=br-pt'],
    ['removes the market from a report URL for every market combined', '/reports/benchmark?market=br-pt', 'Pick every market', /^$/u],
  ])('%s', async (_description, path, button, query) => {
    renderMarketSelectionProvider(path);

    await userEvent.click(screen.getByRole('button', { name: button }));

    await waitFor(() => expect(screen.getByLabelText('Query')).toHaveTextContent(query));
  });

  it('adopts the market a report link names over the remembered one', async () => {
    localStorage.setItem(MARKET_STORAGE_KEY, 'cl-es');

    renderMarketSelectionProvider('/reports/benchmark?market=br-pt');

    await waitFor(() => expect(screen.getByLabelText('Selected market')).toHaveTextContent('br-pt'));
    expect(localStorage.getItem(MARKET_STORAGE_KEY)).toBe('br-pt');
  });

  it('carries the remembered market into a report opened without one', async () => {
    localStorage.setItem(MARKET_STORAGE_KEY, 'cl-es');

    renderMarketSelectionProvider('/reports/benchmark?days=90');

    await waitFor(() => expect(screen.getByLabelText('Query')).toHaveTextContent('?days=90&market=cl-es'));
  });
});

describe('MarketSelector', () => {
  it('is hidden while no market is configured', async () => {
    mockApiGet.mockResolvedValue({ markets: [] });

    renderMarketSelectionProvider('/');

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/markets', expect.anything()));
    expect(screen.queryByRole('combobox', { name: 'Market' })).not.toBeInTheDocument();
  });

  it('switches every view to the picked market', async () => {
    renderMarketSelectionProvider('/');

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Market' }), 'Chile (Spanish)');

    expect(screen.getByLabelText('Selected market')).toHaveTextContent('cl-es');
  });

  it('offers "All markets (combined)" first', async () => {
    renderMarketSelectionProvider('/');

    const options = await screen.findAllByRole('option');

    expect(options.map((option) => option.textContent)).toStrictEqual(['All markets (combined)', 'Chile (Spanish)', 'Brazil (Portuguese)']);
  });
});
