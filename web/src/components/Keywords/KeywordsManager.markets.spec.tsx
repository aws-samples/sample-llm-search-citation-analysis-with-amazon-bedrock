import userEvent from '@testing-library/user-event';
import {
  screen, waitFor, within
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  mockApiPost, mockApiPut
} from '../../api/clientMock-fixtures';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { existingKeywordFixture } from './KeywordsManager-fixtures';
import {
  answerBrazilianSuggestion, BRAZILIAN_KEYWORD, CHILEAN_KEYWORD, renderMarketKeywordsManager, requestBrazilianSuggestion,
  startEditingChileanKeyword
} from './KeywordsManager-markets-fixtures';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));

beforeEach(() => {
  vi.mocked(useIsAdmin).mockReturnValue({
    isAdmin: true,
    loading: false,
  });
});

describe('KeywordsManager markets', () => {
  it('shows no market controls while no market is configured', async () => {
    await renderMarketKeywordsManager([existingKeywordFixture], false);

    expect(screen.queryByLabelText('Market for new keywords')).not.toBeInTheDocument();
    expect(screen.queryByText('Add to markets…')).toBeNull();
  });

  it.each([
    ['in the picked market', 'Brazil (Portuguese)', {
      keyword: 'resorts',
      market_id: 'br-pt',
    }],
    ['without a market by default', 'No market', { keyword: 'resorts' }],
  ])('creates a keyword %s', async (_description, market, body) => {
    mockApiPost.mockResolvedValue({
      ...BRAZILIAN_KEYWORD,
      keyword: 'resorts',
    });
    await renderMarketKeywordsManager();

    await userEvent.selectOptions(screen.getByLabelText('Market for new keywords'), market);
    await userEvent.type(screen.getByPlaceholderText('Enter new keyword...'), 'resorts');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(mockApiPost).toHaveBeenCalledWith('/keywords', body, { allowStructured4xx: true });
  });

  it('badges a keyword with its market', async () => {
    await renderMarketKeywordsManager([existingKeywordFixture, CHILEAN_KEYWORD]);

    expect(screen.getByTitle('Market Chile (Spanish): Chile, Spanish')).toHaveTextContent('Chile (Spanish)');
  });

  it('lists the translations of a keyword with their markets', async () => {
    await renderMarketKeywordsManager([existingKeywordFixture, CHILEAN_KEYWORD]);

    const [sourceTranslations] = screen.getAllByText(/Also asked as/u);

    expect(sourceTranslations).toHaveTextContent('Also asked as hoteles en santiago (Chile (Spanish))');
  });

  it('starts the edit on the keyword market', async () => {
    await startEditingChileanKeyword();

    expect(screen.getByRole('combobox', { name: 'Market' })).toHaveValue('cl-es');
  });

  it.each([
    ['another market', 'Brazil (Portuguese)', 'br-pt'],
    ['no market', 'No market', ''],
  ])('saves %s picked while editing a keyword', async (_description, market, marketId) => {
    mockApiPut.mockResolvedValue(CHILEAN_KEYWORD);
    await startEditingChileanKeyword();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Market' }), market);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockApiPut).toHaveBeenCalledWith('/keywords/keyword-cl', {
      keyword: 'hoteles en santiago',
      market_id: marketId,
    }, { allowStructured4xx: true });
  });

  it('offers "Add to markets…" only to administrators', async () => {
    vi.mocked(useIsAdmin).mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    await renderMarketKeywordsManager();

    expect(screen.queryByRole('button', { name: 'Add hotels to markets' })).not.toBeInTheDocument();
  });

  it('does not offer the markets the keyword is already asked in', async () => {
    await renderMarketKeywordsManager([existingKeywordFixture, CHILEAN_KEYWORD]);

    await userEvent.click(screen.getByRole('button', { name: 'Add hotels to markets' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByRole('checkbox', { name: /Chile/u })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Brazil/u })).toBeInTheDocument();
  });

  it('creates the edited suggestion as a translation of the source keyword', async () => {
    answerBrazilianSuggestion();
    await renderMarketKeywordsManager();

    await requestBrazilianSuggestion();
    await userEvent.type(await screen.findByLabelText('Brazil (Portuguese)'), ' em são paulo');
    await userEvent.click(screen.getByRole('button', { name: 'Create 1 keyword(s)' }));

    expect(mockApiPost).toHaveBeenLastCalledWith('/keywords', {
      keyword: 'hotéis em são paulo',
      market_id: 'br-pt',
      concept_id: existingKeywordFixture.id,
    }, { allowStructured4xx: true });
  });

  it('adds the created translations to the list and closes the dialog', async () => {
    answerBrazilianSuggestion();
    const props = await renderMarketKeywordsManager();

    await requestBrazilianSuggestion();
    await userEvent.click(await screen.findByRole('button', { name: 'Create 1 keyword(s)' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(props.setKeywords).toHaveBeenCalledWith([BRAZILIAN_KEYWORD, existingKeywordFixture]);
  });

  it('shows why the suggestions could not be made', async () => {
    mockApiPost.mockResolvedValue({ error: 'Bedrock is unavailable' });
    await renderMarketKeywordsManager();

    await requestBrazilianSuggestion();

    expect(await screen.findByRole('alert')).toHaveTextContent('Bedrock is unavailable');
  });

  it('skips a suggestion cleared before creating', async () => {
    answerBrazilianSuggestion();
    await renderMarketKeywordsManager();

    await requestBrazilianSuggestion();
    await userEvent.clear(await screen.findByLabelText('Brazil (Portuguese)'));

    expect(screen.getByRole('button', { name: 'Create 0 keyword(s)' })).toBeDisabled();
  });
});
