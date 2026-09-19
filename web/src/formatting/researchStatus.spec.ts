import {
  describe, it, expect 
} from 'vitest';
import {
  formatResearchFailureMessage,
  getResearchStatusClass,
  getResearchStatusLabel,
  getResearchStepStatusClass,
  getResearchStepStatusLabel,
  isActiveResearchStatus,
  isRetryableResearchStatus,
  resolveResearchStatus
} from './researchStatus';
import type { ResearchStepStatus } from '../types';

describe('resolveResearchStatus', () => {
  it('returns null when a legacy row carries no status', () => {
    expect(resolveResearchStatus(undefined)).toBeNull();
  });

  it('returns null when the status is not one the UI knows', () => {
    expect(resolveResearchStatus('archived')).toBeNull();
  });

  it('returns "failed" for a row the backend marked failed', () => {
    expect(resolveResearchStatus('failed')).toBe('failed');
  });

  it('returns "processing" for a legacy run still in flight', () => {
    expect(resolveResearchStatus('processing')).toBe('processing');
  });

  it('returns "partial" for a job where only some providers answered', () => {
    expect(resolveResearchStatus('partial')).toBe('partial');
  });
});

describe('isActiveResearchStatus', () => {
  it('is true while the job is queued or running', () => {
    expect(['pending', 'running', 'processing'].map(isActiveResearchStatus)).toStrictEqual([true, true, true]);
  });

  it('is false once the job reached a terminal status', () => {
    expect(['completed', 'partial', 'failed'].map(isActiveResearchStatus)).toStrictEqual([false, false, false]);
  });

  it('is false for a legacy row without a status', () => {
    expect(isActiveResearchStatus(undefined)).toBe(false);
  });
});

describe('isRetryableResearchStatus', () => {
  it('is true for partial and failed jobs, which have steps to re-run', () => {
    expect(['partial', 'failed'].map(isRetryableResearchStatus)).toStrictEqual([true, true]);
  });

  it('is false for completed and still-running jobs', () => {
    expect(['completed', 'running', 'pending'].map(isRetryableResearchStatus)).toStrictEqual([false, false, false]);
  });
});

describe('getResearchStatusLabel', () => {
  it('labels a failed run "Failed"', () => {
    expect(getResearchStatusLabel('failed')).toBe('Failed');
  });

  it('labels a pending run "Queued"', () => {
    expect(getResearchStatusLabel('pending')).toBe('Queued');
  });

  it('labels running and legacy processing runs "Running"', () => {
    expect(getResearchStatusLabel('running')).toBe('Running');
    expect(getResearchStatusLabel('processing')).toBe('Running');
  });

  it('labels a completed run "Completed"', () => {
    expect(getResearchStatusLabel('completed')).toBe('Completed');
  });

  it('labels a partially successful run "Partial"', () => {
    expect(getResearchStatusLabel('partial')).toBe('Partial');
  });
});

describe('getResearchStatusClass', () => {
  it('styles a failed run in red', () => {
    expect(getResearchStatusClass('failed')).toBe('bg-red-100 text-red-700');
  });

  it('styles a completed run in emerald', () => {
    expect(getResearchStatusClass('completed')).toBe('bg-emerald-100 text-emerald-700');
  });

  it('styles a partial run in amber', () => {
    expect(getResearchStatusClass('partial')).toBe('bg-amber-100 text-amber-700');
  });
});

describe('research step status copy', () => {
  it('labels each step status for the progress panel', () => {
    const stepStatuses: ResearchStepStatus[] = ['pending', 'running', 'completed', 'failed'];

    expect(stepStatuses.map(getResearchStepStatusLabel)).toStrictEqual(['Waiting', 'Querying', 'Done', 'Failed']);
  });

  it('styles a failed step in red and a completed step in emerald', () => {
    expect(getResearchStepStatusClass('failed')).toBe('text-red-700');
    expect(getResearchStepStatusClass('completed')).toBe('text-emerald-700');
  });
});

describe('formatResearchFailureMessage', () => {
  it('rewrites the stranded production message to days', () => {
    expect(formatResearchFailureMessage('Research timed out after 4434821 seconds. Please try again.'))
      .toBe('Research timed out after 51 days. Please try again.');
  });

  it('rewrites a short timeout to minutes', () => {
    expect(formatResearchFailureMessage('Research timed out after 300 seconds. Please try again.'))
      .toBe('Research timed out after 5 minutes. Please try again.');
  });

  it('leaves a message without an embedded second count untouched', () => {
    expect(formatResearchFailureMessage('Provider rejected the request')).toBe('Provider rejected the request');
  });

  it('rewrites every embedded second count in the message', () => {
    expect(formatResearchFailureMessage('Waited 60 seconds, retried, waited 7200 seconds'))
      .toBe('Waited 1 minute, retried, waited 2 hours');
  });

  it('leaves a bare number that is not a second count untouched', () => {
    expect(formatResearchFailureMessage('Attempt 3 failed')).toBe('Attempt 3 failed');
  });

  it('explains a rate-limited search in plain words when the worker prefixes the provider', () => {
    const raw = 'perplexity: 429 Client Error: Too Many Requests for url: https://api.perplexity.ai/chat/completions'
      + ' | {"error":{"message":"Request rate limit exceeded, please try again later.","type":"request_rate_limit_exceeded","code":429}}';

    expect(formatResearchFailureMessage(raw))
      .toBe('Perplexity rate-limited one of the searches. The other searches completed; use Retry to re-run the throttled one.');
  });

  it('explains a rate-limited search generically when the step message carries no provider prefix', () => {
    expect(formatResearchFailureMessage('429 Client Error: Too Many Requests for url: https://api.openai.com/v1/responses | {}'))
      .toBe('A search provider rate-limited one of the searches. The other searches completed; use Retry to re-run the throttled one.');
  });

  it('leaves other HTTP client errors untouched', () => {
    expect(formatResearchFailureMessage('perplexity: 401 Client Error: Unauthorized for url: https://api.perplexity.ai/chat/completions'))
      .toBe('perplexity: 401 Client Error: Unauthorized for url: https://api.perplexity.ai/chat/completions');
  });
});
