import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAdminRole } from '../../test/useIsAdminMock';
import { buildNumberedKeywords } from '../ContentStudio/GroupBriefForm-fixtures';
import {
  CHILEAN_KEYWORD, renderMarketKeywordsManager
} from './KeywordsManager-markets-fixtures';
import {
  chooseStatusFilter, existingKeywordFixture
} from './KeywordsManager-fixtures';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));
vi.mock('../../hooks/useIsAdmin', () => import('../../test/useIsAdminMock'));

beforeEach(() => {
  mockAdminRole(false);
});

describe('KeywordsManager list', () => {
  it('shows the first 25 keywords and pages to the rest', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(30), false);

    expect(screen.getByText('Keyword 25')).toBeInTheDocument();
    expect(screen.queryByText('Keyword 26')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Keyword 30')).toBeInTheDocument();
    expect(screen.queryByText('Keyword 1')).not.toBeInTheDocument();
  });

  it('offers no pager while every keyword fits on one page', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(25), false);

    expect(screen.queryByRole('navigation', { name: 'Keyword pages' })).not.toBeInTheDocument();
  });

  it('filters by text, ignoring case, and counts the matches', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(30), false);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'KEYWORD 2');

    expect(screen.getByText('Keyword 29')).toBeInTheDocument();
    expect(screen.queryByText('Keyword 3')).not.toBeInTheDocument();
    expect(screen.getByText('11 of 30 keywords')).toBeInTheDocument();
  });

  it('starts a new search on the first page', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(60), false);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'Keyword 1');

    expect(screen.getByText('Keyword 1')).toBeInTheDocument();
  });

  it('says when no keyword matches the search', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(3), false);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'resorts');

    expect(screen.getByText('No keywords match "resorts".')).toBeInTheDocument();
  });

  it('keeps every row action in the row menu', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(1), false);

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Keyword 1' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toStrictEqual(['Edit', 'Edit groups', 'Pause', 'Delete']);
  });

  it('filters by status', async () => {
    const [first, second] = buildNumberedKeywords(2);
    await renderMarketKeywordsManager([first, {
      ...second,
      status: 'paused'
    }], false);

    await chooseStatusFilter('Paused keywords');

    expect(screen.getByText('Keyword 2')).toBeInTheDocument();
    expect(screen.queryByText('Keyword 1')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 keywords')).toBeInTheDocument();
  });

  it('says when no keyword matches the filters', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(2), false);

    await chooseStatusFilter('Paused keywords');

    expect(screen.getByText('No keywords match these filters.')).toBeInTheDocument();
  });

  it('filters by market, including keywords without one', async () => {
    await renderMarketKeywordsManager([existingKeywordFixture, CHILEAN_KEYWORD]);
    const marketFilter = screen.getByRole('combobox', { name: 'Filter by market' });

    await userEvent.selectOptions(marketFilter, 'Chile (Spanish)');
    expect(screen.queryByRole('checkbox', { name: `Select ${existingKeywordFixture.keyword}` })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Select ${CHILEAN_KEYWORD.keyword}` })).toBeInTheDocument();

    await userEvent.selectOptions(marketFilter, 'No market');
    expect(screen.getByRole('checkbox', { name: `Select ${existingKeywordFixture.keyword}` })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: `Select ${CHILEAN_KEYWORD.keyword}` })).not.toBeInTheDocument();
  });

  it('offers no market filter while no market is configured', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(2), false);

    expect(screen.queryByRole('combobox', { name: 'Filter by market' })).not.toBeInTheDocument();
  });

  it('ticks and unticks every keyword on the page from the header checkbox', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(30), false);
    const pageCheckbox = screen.getByRole('checkbox', { name: 'Select all keywords on this page' });

    await userEvent.click(pageCheckbox);
    expect(screen.getByText('25 selected')).toBeInTheDocument();

    await userEvent.click(pageCheckbox);
    expect(screen.queryByRole('region', { name: 'Selected keywords' })).not.toBeInTheDocument();
  });

  it('shows the page checkbox as mixed while only some rows are ticked', async () => {
    await renderMarketKeywordsManager(buildNumberedKeywords(3), false);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Keyword 2' }));

    expect(screen.getByRole('checkbox', { name: 'Select all keywords on this page' })).toHaveProperty('indeterminate', true);
  });
});

