import {
  describe, it, expect
} from 'vitest';
import { screen } from '@testing-library/react';
import {
  buildAppearance, mentionsOf, reasonLines, renderExamples
} from './SentimentExamplesSection-fixtures';

const HOTEL_SOL = mentionsOf({ 'Hotel Sol': [buildAppearance()] });

describe('SentimentExamplesSection', () => {
  it('renders nothing before the mentions arrive', () => {
    const { container } = renderExamples(null);

    expect(container).toBeEmptyDOMElement();
  });

  it('explains the missing examples when no appearance has a quote or a reason', () => {
    renderExamples(mentionsOf({
      'Hotel Sol': [buildAppearance({
        sentiment_quote: undefined,
        sentiment_reason: '',
      })],
    }));

    expect(screen.getByText(/^Sentiment extraction may be disabled/)).toBeInTheDocument();
  });

  it('quotes the engine\'s own words in a blockquote', () => {
    renderExamples(HOTEL_SOL);

    expect(screen.getByRole('blockquote').textContent?.trim()).toBe('“Guests often mention that the rooms feel dated.”');
  });

  it('gives the reason as "Why:" without quotation marks', () => {
    renderExamples(HOTEL_SOL);

    expect(reasonLines()).toStrictEqual(['Why: The answer warns about dated rooms.']);
  });

  it('keeps an older example that has a reason but no quote, without a blockquote', () => {
    renderExamples(mentionsOf({ 'Hotel Sol': [buildAppearance({ sentiment_quote: undefined })] }));

    expect([screen.queryByRole('blockquote'), reasonLines()]).toStrictEqual([null, ['Why: The answer warns about dated rooms.']]);
  });

  it('keeps an example that has a quote but no reason, without a "Why:" line', () => {
    renderExamples(mentionsOf({ 'Hotel Sol': [buildAppearance({ sentiment_reason: undefined })] }));

    expect([screen.getByRole('blockquote').textContent?.trim(), screen.queryByText(/^Why: /)])
      .toStrictEqual(['“Guests often mention that the rooms feel dated.”', null]);
  });

  it('names the brand, the engine and the ranking context of each example', () => {
    renderExamples(HOTEL_SOL);

    expect(screen.getByText('Hotel Sol')).toBeInTheDocument();
    expect(screen.getByText('on openai')).toBeInTheDocument();
    expect(screen.getByText('Ranking context: a cheaper but dated option')).toBeInTheDocument();
  });

  it('lists negatives first, then positives, mixed and neutral, an unlabelled appearance counting as neutral', () => {
    renderExamples(mentionsOf({
      'Hotel Sol': [
        buildAppearance({
          sentiment: undefined,
          sentiment_reason: 'unlabelled',
        }),
        buildAppearance({
          sentiment: 'Mixed',
          sentiment_reason: 'mixed',
        }),
        buildAppearance({
          sentiment: 'positive',
          sentiment_reason: 'positive',
        }),
        buildAppearance({ sentiment_reason: 'negative' }),
      ],
    }));

    expect(reasonLines()).toStrictEqual(['Why: negative', 'Why: positive', 'Why: mixed', 'Why: unlabelled']);
  });

  it('shows at most two examples per sentiment across brands', () => {
    renderExamples(mentionsOf({
      'Hotel Sol': [buildAppearance({ sentiment_reason: 'first' }), buildAppearance({ sentiment_reason: 'second' })],
      'Sol Spa': [buildAppearance({ sentiment_reason: 'third' })],
    }));

    expect(reasonLines()).toStrictEqual(['Why: first', 'Why: second']);
  });

  it('skips an appearance whose sentiment is not one of the four labels', () => {
    renderExamples(mentionsOf({ 'Hotel Sol': [buildAppearance({ sentiment: 'furious' })] }));

    expect(screen.getByText(/^Sentiment extraction may be disabled/)).toBeInTheDocument();
  });

  it.each([
    ['negative', 'border-red-200'],
    ['positive', 'border-emerald-200'],
    ['neutral', 'border-gray-200'],
  ])('tints a %s example with %s', (sentiment, border) => {
    renderExamples(mentionsOf({ 'Hotel Sol': [buildAppearance({ sentiment })] }));

    expect(screen.getByText(/^Why: /).parentElement).toHaveClass(border);
  });
});
