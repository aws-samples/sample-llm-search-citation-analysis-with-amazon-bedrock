import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import {
  buildSentimentExample, SPARSE_SENTIMENT_EXAMPLES
} from '../../../types/domain/sentimentExamples-fixtures';
import { formatDateOnly } from '../../../formatting/dateFormatter';
import { renderExampleCard } from './sentimentExamples-fixtures';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

const [BARE] = SPARSE_SENTIMENT_EXAMPLES.examples;

/** The heading of the example's full answer, present only while it is unfolded. */
function queryAnswerHeadingElement() {
  return screen.queryByRole('heading', { name: 'Spa hotels' });
}

describe('SentimentExampleCard', () => {
  it('names the brand, its sentiment and its rank', () => {
    renderExampleCard();

    expect(screen.getByRole('listitem').firstElementChild?.textContent).toBe('Hotel SolNegativeRank 3');
  });

  it('says where the answer comes from: keyword, engine, persona and run date', () => {
    renderExampleCard();

    expect(screen.getByText(/^Keyword: /).textContent).toBe(
      `Keyword: hotel coruna spa · Engine: OpenAI · Persona: Default · Run: ${formatDateOnly('2026-09-28T10:00:00.000000Z')}`,
    );
  });

  it('falls back to the persona id when the run has no persona name', () => {
    renderExampleCard(BARE);

    expect(screen.getByText(/^Keyword: /).textContent).toContain('Persona: default');
  });

  it('quotes the passage carrying the sentiment verbatim', () => {
    renderExampleCard();

    expect(screen.getByRole('blockquote').textContent).toBe('Guests often mention that the rooms at Hotel Sol feel dated.');
  });

  it.each([
    ['positive', 'Positive', 'bg-emerald-50', 'border-emerald-300'],
    ['neutral', 'Neutral', 'bg-gray-100', 'border-gray-300'],
    ['mixed', 'Mixed', 'bg-amber-50', 'border-amber-300'],
    ['negative', 'Negative', 'bg-red-50', 'border-red-300'],
  ] as const)('labels a %s example "%s" on a %s pill and borders its quote with %s', (sentiment, label, pill, quote) => {
    renderExampleCard(buildSentimentExample({ sentiment }));

    expect(screen.getByText(label)).toHaveClass(pill);
    expect(screen.getByRole('blockquote')).toHaveClass(quote);
  });

  it('explains the label as "Why:" without quotation marks', () => {
    renderExampleCard();

    expect(screen.getByText(/^Why: /).textContent).toBe('Why: The answer warns about dated rooms.');
  });

  it('gives the ranking context', () => {
    renderExampleCard();

    expect(screen.getByText('Ranking context: mentioned as a cheaper but dated option')).toBeInTheDocument();
  });

  it('leaves out the rank, quote, reason and ranking context an older row lacks', () => {
    renderExampleCard(BARE);

    expect(screen.getByRole('listitem').firstElementChild?.textContent).toBe('Hotel SolNegative');
    expect(screen.queryByRole('blockquote')).toBeNull();
    expect(screen.queryByText(/^Why: |^Ranking context: /)).toBeNull();
  });

  it('treats an empty quote as no quote', () => {
    renderExampleCard(buildSentimentExample({ quote: '' }));

    expect(screen.queryByRole('blockquote')).toBeNull();
  });

  it('keeps the full answer folded until asked for', () => {
    renderExampleCard();

    expect(screen.getByRole('button', { name: 'Show full answer' })).toHaveAttribute('aria-expanded', 'false');
    expect(queryAnswerHeadingElement()).toBeNull();
  });

  describe('unfolded', () => {
    beforeEach(() => {
      renderExampleCard(undefined, true);
    });

    it('renders the full answer as markdown', () => {
      expect(queryAnswerHeadingElement()).toBeInTheDocument();
      expect(screen.getByText('cheaper').tagName).toBe('STRONG');
    });

    it('marks the toggle as expanded', () => {
      expect(screen.getByRole('button', { name: 'Hide full answer' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('folds the full answer again', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide full answer' }));

      expect(queryAnswerHeadingElement()).toBeNull();
    });
  });

  it('strips markup the answer should not run', () => {
    const { container } = renderExampleCard(buildSentimentExample({ answer: 'Nice <img src=x onerror="alert(1)"> hotel' }), true);

    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('notes a cut answer only when it was cut (%s)', (truncated, notes) => {
    renderExampleCard(buildSentimentExample({ answer_truncated: truncated }), true);

    expect(screen.queryAllByText('The answer is cut at 20,000 characters.')).toHaveLength(notes);
  });
});
