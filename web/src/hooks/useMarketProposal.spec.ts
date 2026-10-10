import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { mockApiPost } from '../api/clientMock-fixtures';
import {
  BRAZIL, buildMarketProposal, CHILEAN_REQUEST
} from '../components/Markets/markets-fixtures';
import { proposalPostArguments } from '../components/Settings/marketForm-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';
import { useMarketProposal } from './useMarketProposal';

vi.mock('../api/client', () => import('../api/clientMock-fixtures'));

const BRAZILIAN_REQUEST = {
  country: 'BR',
  language: 'pt',
};

/** The hook once `propose(CHILEAN_REQUEST)` has been called, the API answering as `arrange` set it up. */
function renderProposing(arrange: () => unknown) {
  arrange();
  const { result } = renderHook(() => useMarketProposal());
  act(() => result.current.propose(CHILEAN_REQUEST));
  return result;
}

describe('useMarketProposal', () => {
  it('starts with nothing proposed', () => {
    const { result } = renderHook(() => useMarketProposal());

    expect(result.current.state).toStrictEqual({ status: 'idle' });
  });

  it('posts the choice under "propose" with an abort signal', () => {
    renderProposing(() => mockApiPost.mockResolvedValue(buildMarketProposal()));

    expect(mockApiPost).toHaveBeenCalledWith(...proposalPostArguments(CHILEAN_REQUEST));
  });

  it('is proposing, for the request made, until the model answers', () => {
    const result = renderProposing(() => mockApiPost.mockReturnValue(new Promise<never>(vi.fn())));

    expect(result.current.state).toStrictEqual({
      status: 'proposing',
      request: CHILEAN_REQUEST,
    });
  });

  it.each([
    ['the proposal the model answered with', () => mockApiPost.mockResolvedValue(buildMarketProposal({ market_id_taken: true })), {
      status: 'proposed',
      request: CHILEAN_REQUEST,
      proposal: buildMarketProposal({ market_id_taken: true }),
    }],
    ['the refusal of the server', () => mockApiPost.mockResolvedValue({ error: 'propose.city must be at most 80 characters' }), {
      status: 'failed',
      request: CHILEAN_REQUEST,
      message: 'propose.city must be at most 80 characters',
    }],
    ['a fixed message when the failure has none', () => mockApiPost.mockRejectedValue('offline'), {
      status: 'failed',
      request: CHILEAN_REQUEST,
      message: 'The model could not describe this market; fill the fields in by hand',
    }],
  ])('holds %s', async (_description, arrange, state) => {
    const result = renderProposing(arrange);

    await waitFor(() => expect(result.current.state).toStrictEqual(state));
  });

  it('keeps only the latest proposal when a new request overtakes an unfinished one', async () => {
    const [first, second] = deferNextTwoCalls(mockApiPost);
    const result = renderProposing(vi.fn());
    act(() => result.current.propose(BRAZILIAN_REQUEST));
    await act(async () => {
      second.resolve(buildMarketProposal({ market: BRAZIL }));
      await second.promise;
    });

    await act(async () => {
      first.resolve(buildMarketProposal());
      await first.promise;
    });

    expect(result.current.state).toStrictEqual({
      status: 'proposed',
      request: BRAZILIAN_REQUEST,
      proposal: buildMarketProposal({ market: BRAZIL }),
    });
  });
});
