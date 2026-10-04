import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, screen, within
} from '@testing-library/react';
import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../../../test/infrastructureMock';
import {
  buildSentimentExample, buildSentimentExamplesResponse
} from '../../../types/domain/sentimentExamples-fixtures';
import { SentimentExamplesModal } from './SentimentExamplesModal';
import {
  HOTEL_SOL_SCOPE, renderExamplesModal, requestedUrl, requestSignal
} from './sentimentExamples-fixtures';
import { answerEveryFetch } from '../../../test/fetchStubs';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

const TWO_OF_THIRTY_SEVEN = buildSentimentExamplesResponse({
  total: 37,
  examples: [buildSentimentExample(), buildSentimentExample({ brand: 'Sol Spa' })],
});

const NO_ANSWERS = buildSentimentExamplesResponse({
  total: 0,
  examples: [],
});

describe('SentimentExamplesModal', () => {
  it('names the sentiment and the engine in its title', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal();

    expect(screen.getByRole('dialog', { name: 'Negative answers · OpenAI' })).toBeInTheDocument();
  });

  it('names every engine in its title when no engine is picked', () => {
    answerEveryFetch(buildSentimentExamplesResponse({ provider: null }));
    renderExamplesModal({
      sentiment: 'mixed',
      provider: null,
    });

    expect(screen.getByRole('dialog', { name: 'Mixed answers · All engines' })).toBeInTheDocument();
  });

  it('asks for the answers of the scope, the sentiment and the engine', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal();

    expect(requestedUrl()).toBe('https://api.test.com/visibility/sentiment-examples?group_id=hotel-sol&sentiment=negative&provider=openai');
  });

  it('asks for every engine when no engine is picked', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal({
      sentiment: 'positive',
      provider: null,
    });

    expect(requestedUrl()).toBe('https://api.test.com/visibility/sentiment-examples?group_id=hotel-sol&sentiment=positive');
  });

  it('says which runs the answers come from under the title', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal();

    expect(screen.getByText('Hotel Sol · each keyword\'s latest run')).toBeInTheDocument();
  });

  it('notes a scope whose keywords were capped once the answer says so', async () => {
    answerEveryFetch(buildSentimentExamplesResponse({ keywords_truncated: true }));
    renderExamplesModal();

    expect(await screen.findByText('Hotel Sol · each keyword\'s latest run · not every keyword of the scope is included')).toBeInTheDocument();
  });

  it('says the answers are loading while the request is in flight', () => {
    deferAuthenticatedFetch();
    renderExamplesModal();

    expect(screen.getByRole('status').textContent).toBe('Loading the answers…');
  });

  it('shows the error when the answers cannot be loaded', async () => {
    answerEveryFetch({}, 500);
    renderExamplesModal();

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to load the answers');
  });

  it('shows no error while the answers load', () => {
    deferAuthenticatedFetch();
    renderExamplesModal();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no error once the answers arrive', async () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal();

    await screen.findByRole('list', { name: 'Answers' });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks again when it is pointed at another count', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    const {
      onClose, rerender
    } = renderExamplesModal();

    rerender(<SentimentExamplesModal scope={HOTEL_SOL_SCOPE} scopeLabel="Hotel Sol" sentiment="positive" provider={null} onClose={onClose} />);

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([
      'https://api.test.com/visibility/sentiment-examples?group_id=hotel-sol&sentiment=negative&provider=openai',
      'https://api.test.com/visibility/sentiment-examples?group_id=hotel-sol&sentiment=positive',
    ]);
  });

  it('says so when the count has no answers any more', async () => {
    answerEveryFetch(NO_ANSWERS);
    renderExamplesModal();

    expect(await screen.findByText('No negative answers from OpenAI in the latest runs of this scope any more.')).toBeInTheDocument();
  });

  it('leaves the engine out of the empty message for every engine', async () => {
    answerEveryFetch(NO_ANSWERS);
    renderExamplesModal({
      sentiment: 'neutral',
      provider: null,
    });

    expect(await screen.findByText('No neutral answers in the latest runs of this scope any more.')).toBeInTheDocument();
  });

  it('lists one card per answer, in the order the API gives', async () => {
    answerEveryFetch(TWO_OF_THIRTY_SEVEN);
    renderExamplesModal();

    const list = await screen.findByRole('list', { name: 'Answers' });

    expect(within(list).getAllByRole('listitem').map((item) => item.firstElementChild?.firstElementChild?.textContent)).toStrictEqual(['Hotel Sol', 'Sol Spa']);
  });

  it('says how many of the matching answers it shows when the list is cut', async () => {
    answerEveryFetch(TWO_OF_THIRTY_SEVEN);
    renderExamplesModal();

    expect(await screen.findByText('Showing 2 of 37')).toBeInTheDocument();
  });

  it.each([
    [1, '1 answer'],
    [2, '2 answers'],
  ])('counts %s complete answer(s) as "%s"', async (count, line) => {
    answerEveryFetch(buildSentimentExamplesResponse({
      total: count,
      examples: Array.from({ length: count }, (_, index) => buildSentimentExample({ keyword: `keyword ${index}` })),
    }));
    renderExamplesModal();

    expect(await screen.findByText(line)).toBeInTheDocument();
  });

  it('never prints', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    renderExamplesModal();

    expect(screen.getByRole('dialog').closest('.print-hidden')).not.toBeNull();
  });

  it('closes on the close button', () => {
    answerEveryFetch(buildSentimentExamplesResponse());
    const { onClose } = renderExamplesModal();

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

    expect(onClose.mock.calls).toHaveLength(1);
  });

  it('aborts the request in flight when it closes', () => {
    deferAuthenticatedFetch();
    const { unmount } = renderExamplesModal();

    unmount();

    expect(requestSignal()?.aborted).toBe(true);
  });
});
