import type { ReportScope } from '../types';
import {
  isSentimentExamplesResponse, type SentimentLabel
} from '../types/domain/sentimentExamples';
import { reportScopeParams } from '../components/ui/reportScope';
import {
  fetchErrors, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

class SentimentExamplesFetchError extends Error {
  constructor(message = 'Failed to fetch sentiment examples') {
    super(message);
    this.name = 'SentimentExamplesFetchError';
  }
}

const sentimentExamplesEndpoint = {
  errorContext: 'sentimentExamples',
  logMessage: '[sentiment] Error fetching sentiment examples:',
  isValidResponse: isSentimentExamplesResponse,
  ...fetchErrors(SentimentExamplesFetchError),
  buildRequest: (scope: ReportScope, sentiment: SentimentLabel, provider?: string, limit?: number) => {
    const params = new URLSearchParams(reportScopeParams(scope));
    params.append('sentiment', sentiment);
    if (provider) params.append('provider', provider);
    if (limit !== undefined) params.append('limit', String(limit));
    return {
      path: '/visibility/sentiment-examples',
      params,
    };
  },
};

/**
 * The answers behind one sentiment count of a report scope: the first-party
 * sightings with `sentiment` in each keyword's latest run, of one AI engine
 * (`provider`) or of every engine. A new fetch aborts the one in flight, and
 * unmounting aborts it too, so closing the view cancels the request.
 */
export function useSentimentExamples() {
  const {
    data, loading, error, fetchData: fetchSentimentExamples
  } = useAnalysisEndpoint(sentimentExamplesEndpoint);

  return {
    data,
    loading,
    error,
    fetchSentimentExamples,
  };
}
