import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  ReextractEstimate, ReextractJob
} from './reextractDecoders';

/** The URL, method and body of the first mocked `authenticatedFetch` call. */
export function firstRequest(): readonly unknown[] {
  const [url, init] = mockAuthenticatedFetch.mock.calls[0] ?? [];
  return [url, init?.method, init?.body];
}

export function buildReextractEstimate(overrides: Partial<ReextractEstimate> = {}): ReextractEstimate {
  return {
    answers: 1210,
    answers_current: 183,
    keywords: 85,
    estimated_cost_usd: 3.42,
    model: 'global.anthropic.claude-haiku-5-5',
    brands_version: 2,
    truncated: false,
    filters: {
      group_ids: [],
      since: null,
      until: null,
      only_outdated: true,
    },
    ...overrides,
  };
}

export function buildReextractJob(overrides: Partial<ReextractJob> = {}): ReextractJob {
  return {
    job_id: 'rx-1a2b',
    status: 'running',
    created_at: '2026-11-02T09:00:00Z',
    created_by: 'admin@example.com',
    finished_at: null,
    filters: {
      group_ids: ['group-costamar'],
      only_outdated: true,
    },
    brands_version: 2,
    answers_total: 1210,
    answers_done: 400,
    answers_skipped: 0,
    answers_failed: 2,
    keywords_total: 85,
    keywords_done: 30,
    estimated_cost_usd: 3.42,
    error: null,
    rebuild: null,
    ...overrides,
  };
}

export const RUNNING_JOB = buildReextractJob();

/** A copy of `value` without `field`, for guards that must reject a missing field. */
export function withoutField(value: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

export const FAILED_JOB = buildReextractJob({
  status: 'failed',
  finished_at: '2026-11-02T09:40:00Z',
  error: 'Bedrock refused the request',
});

export const DONE_JOB = buildReextractJob({
  status: 'done',
  answers_done: 1210,
  keywords_done: 85,
  finished_at: '2026-11-02T10:15:00Z',
  rebuild: 'started',
});
