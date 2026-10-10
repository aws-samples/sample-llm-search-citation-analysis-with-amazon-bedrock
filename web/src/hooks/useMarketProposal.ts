import {
  useCallback, useMemo, useState
} from 'react';
import { proposeMarket } from '../api/markets';
import type {
  MarketProposal, MarketProposalRequest
} from '../types';
import { failureMessage } from './useMarkets';
import { useLatestRequest } from './useLatestRequest';

/** The proposal in flight or settled; every state after `idle` names the request it is for. */
export type MarketProposalState =
  | { readonly status: 'idle' }
  | {
    readonly status: 'proposing';
    readonly request: MarketProposalRequest;
  }
  | {
    readonly status: 'proposed';
    readonly request: MarketProposalRequest;
    readonly proposal: MarketProposal;
  }
  | {
    readonly status: 'failed';
    readonly request: MarketProposalRequest;
    readonly message: string;
  };

const IDLE: MarketProposalState = { status: 'idle' };

/**
 * One market proposal at a time (`POST /markets {propose}`): a new request
 * supersedes an unfinished one, so the form never shows a proposal for a
 * country the administrator has since changed.
 */
export function useMarketProposal() {
  const { beginRequest } = useLatestRequest();
  const [state, setState] = useState<MarketProposalState>(IDLE);

  const propose = useCallback((request: MarketProposalRequest): void => {
    const current = beginRequest();
    setState({
      status: 'proposing',
      request,
    });
    proposeMarket(request, current.signal)
      .then((proposal) => {
        if (current.isCurrent()) setState({
          status: 'proposed',
          request,
          proposal,
        });
      })
      .catch((failure: unknown) => {
        if (current.isCurrent()) setState({
          status: 'failed',
          request,
          message: failureMessage(failure, 'The model could not describe this market; fill the fields in by hand'),
        });
      })
      .finally(() => {
        current.finish();
      });
  }, [beginRequest]);

  return useMemo(() => ({
    state,
    propose,
  }), [state, propose]);
}
