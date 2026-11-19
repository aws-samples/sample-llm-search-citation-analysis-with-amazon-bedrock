import {
  describe, expect, it, vi
} from 'vitest';
import { ApiRequestError } from '../infrastructure';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  RUNNING_JOB, buildReextractEstimate, firstRequest
} from './reextract-fixtures';
import {
  estimateReextract, getReextractStatus, startReextract, stopReextract
} from './reextract';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const FILTERS = {
  group_ids: ['group-costamar'],
  since: null,
  until: null,
  only_outdated: true,
};

describe('estimateReextract', () => {
  it('posts the filters to the estimate route', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(buildReextractEstimate()));
    await estimateReextract(FILTERS);

    expect(firstRequest()).toStrictEqual(['https://api.test.com/reextract/estimate', 'POST', JSON.stringify(FILTERS)]);
  });

  it('returns the estimate the API answers', async () => {
    const estimate = buildReextractEstimate({ answers: 12 });
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(estimate));

    await expect(estimateReextract(FILTERS)).resolves.toStrictEqual(estimate);
  });

  it('throws ApiRequestError when the estimate is malformed', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ answers: 'many' }));

    await expect(estimateReextract(FILTERS)).rejects.toThrow(new ApiRequestError('The re-extract estimate is malformed'));
  });
});

describe('startReextract', () => {
  it('reports the started job on 202', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ job: RUNNING_JOB }, 202));

    await expect(startReextract(FILTERS)).resolves.toStrictEqual({
      kind: 'started',
      job: RUNNING_JOB,
    });
  });

  it('reports the running job and the server message on 409', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      error: 'A re-extract is already running',
      job: RUNNING_JOB,
    }, 409));

    await expect(startReextract(FILTERS)).resolves.toStrictEqual({
      kind: 'already-running',
      job: RUNNING_JOB,
      message: 'A re-extract is already running',
    });
  });

  it('throws the server message when the filters select nothing', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ error: 'Nothing to re-extract' }, 400));

    await expect(startReextract(FILTERS)).rejects.toThrow('Nothing to re-extract');
  });
});

describe('getReextractStatus', () => {
  it('returns the newest job and whether it is active', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      job: null,
      active: false,
    }));

    await expect(getReextractStatus()).resolves.toStrictEqual({
      job: null,
      active: false,
    });
  });

  it('throws ApiRequestError when the status is malformed', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ job: null }));

    await expect(getReextractStatus()).rejects.toThrow(new ApiRequestError('The re-extract status is malformed'));
  });
});

describe('stopReextract', () => {
  it('posts to the stop route of the job and returns the job', async () => {
    const stopping = {
      ...RUNNING_JOB,
      status: 'stopping',
    };
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ job: stopping }));

    await expect(stopReextract('rx-1a2b')).resolves.toStrictEqual(stopping);
    expect(firstRequest()).toStrictEqual(['https://api.test.com/reextract/rx-1a2b/stop', 'POST', '{}']);
  });
});
