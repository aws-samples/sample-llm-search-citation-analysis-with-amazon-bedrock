import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  fireEvent, screen, within
} from '@testing-library/react';
import { buildSentimentExamplesResponse } from '../../../types/domain/sentimentExamples-fixtures';
import {
  renderCountTable, requestedUrl, stubExamplesAnswer
} from './sentimentExamples-fixtures';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

/** The count table with the count button named `name` selected. */
function renderSelectedCount(name: string) {
  renderCountTable();
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('SentimentCountTable', () => {
  it('heads the table as the answers per AI engine and sentiment', () => {
    renderCountTable();

    expect(screen.getByRole('heading', { name: 'Answers per AI engine and sentiment' })).toBeInTheDocument();
  });

  it('has a column per sentiment after the engine', () => {
    renderCountTable();

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toStrictEqual(['AI engine', 'Positive', 'Neutral', 'Mixed', 'Negative']);
  });

  it('shows every engine together first, then each engine by name', () => {
    renderCountTable();

    const rows = screen.getAllByRole('row').slice(1);

    expect(rows.map((row) => row.firstElementChild?.textContent)).toStrictEqual(['All engines', 'OpenAI', 'Google Gemini']);
  });

  it('shows the counts of each row in sentiment order', () => {
    renderCountTable();

    const openAi = screen.getAllByRole('row')[2];

    expect(within(openAi).getAllByRole('cell').slice(1).map((cell) => cell.textContent)).toStrictEqual(['1', '0', '1', '3']);
  });

  it.each([
    ['Show the 3 negative answers from OpenAI', '3'],
    ['Show the 1 positive answer from OpenAI', '1'],
    ['Show the 4 negative answers from all engines', '4'],
    ['Show the 1 mixed answer from all engines', '1'],
    ['Show the 2 positive answers from Google Gemini', '2'],
  ])('names the count button "%s"', (name, count) => {
    renderCountTable();

    expect(screen.getByRole('button', { name }).textContent).toBe(count);
  });

  it('writes a zero count as plain text, not a button', () => {
    renderCountTable();

    const allEngines = screen.getAllByRole('row')[1];

    expect(within(allEngines).getAllByRole('button').map((button) => button.textContent)).toStrictEqual(['3', '1', '4']);
  });

  it('keeps the counts on paper while hiding the hint to select them', () => {
    renderCountTable();

    expect(screen.getByRole('button', { name: 'Show the 3 negative answers from OpenAI' }).closest('.print-hidden')).toBeNull();
    expect(screen.getByText(/^Select a count/)).toHaveClass('print-hidden');
  });

  it('opens no answers until a count is selected', () => {
    renderCountTable();

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SentimentCountTable with a count selected', () => {
  beforeEach(() => {
    stubExamplesAnswer(buildSentimentExamplesResponse());
  });

  it('opens the answers behind a count, titled with its sentiment and engine', () => {
    renderSelectedCount('Show the 3 negative answers from OpenAI');

    expect(screen.getByRole('dialog', { name: 'Negative answers · OpenAI' })).toBeInTheDocument();
  });

  it('asks for the answers of the report scope behind the selected count', () => {
    renderSelectedCount('Show the 3 positive answers from all engines');

    expect(requestedUrl()).toBe('https://api.test.com/visibility/sentiment-examples?group_id=hotel-sol&sentiment=positive');
  });

  it('names the scope of the report under the title', () => {
    renderSelectedCount('Show the 1 mixed answer from OpenAI');

    expect(within(screen.getByRole('dialog')).getByText('Hotel Sol · each keyword\'s latest run')).toBeInTheDocument();
  });

  it('closes the answers on Escape', () => {
    renderSelectedCount('Show the 3 negative answers from OpenAI');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
