import {
  describe, expect, it, vi
} from 'vitest';
import {
  answerSeoRequestsWith, sentSeoRequest, withoutField
} from './seo-fixtures';
import { InvalidSeoResponseError } from './seoDecoders';
import {
  fetchAuditPageUrls, fetchIndexNowSetup, fetchLighthouseRun, startLighthouse, startLighthouseBatch, submitIndexNow
} from './seoPerformance';
import {
  AUDIT_ID, PAGE, RUN_ID, buildCompletedResult, buildRun, buildSetup, buildStartRunResponse, buildSubmission
} from './seoPerformance-fixtures';

vi.mock('../infrastructure/config', async () => (await import('../test/seoConfigMock'))
  .buildSeoConfigMock('https://seo.example.com/api'));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('startLighthouse', () => {
  it('posts the page and device to the Lighthouse route', async () => {
    answerSeoRequestsWith(buildStartRunResponse());

    await startLighthouse({
      url: PAGE,
      device: 'desktop'
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.example.com/api/seo/lighthouse',
      body: {
        url: PAGE,
        device: 'desktop'
      },
    });
  });

  it('throws InvalidSeoResponseError when the run has an unknown status', async () => {
    answerSeoRequestsWith({
      run: {
        ...buildRun(),
        status: 'paused'
      },
      reused: false
    });

    await expect(startLighthouse({
      url: PAGE,
      device: 'mobile'
    })).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('startLighthouseBatch', () => {
  it('posts the audit id to the batch route', async () => {
    answerSeoRequestsWith(buildStartRunResponse());

    await startLighthouseBatch(AUDIT_ID);

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.example.com/api/seo/lighthouse/batch',
      body: { audit_id: AUDIT_ID },
    });
  });
});

describe('fetchAuditPageUrls', () => {
  it('asks the audit pages route for at most `limit` pages', async () => {
    answerSeoRequestsWith({
      audit_id: AUDIT_ID,
      pages: [],
      next_token: null
    });

    await fetchAuditPageUrls(AUDIT_ID, 50);

    expect(sentSeoRequest().url).toBe(`https://seo.example.com/api/seo/audits/${AUDIT_ID}/pages?limit=50`);
  });

  it('returns the URL of each crawled page', async () => {
    answerSeoRequestsWith({
      audit_id: AUDIT_ID,
      pages: [{
        url: PAGE,
        status: 200
      }, {
        url: 'https://www.example.com/rooms',
        status: 200
      }],
      next_token: 'next'
    });

    await expect(fetchAuditPageUrls(AUDIT_ID, 50)).resolves.toStrictEqual([PAGE, 'https://www.example.com/rooms']);
  });

  it('throws InvalidSeoResponseError when a page has no URL', async () => {
    answerSeoRequestsWith({ pages: [{ status: 200 }] });

    await expect(fetchAuditPageUrls(AUDIT_ID, 50)).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('fetchLighthouseRun', () => {
  it('returns the decoded run, pending targets included', async () => {
    const run = buildRun({
      status: 'running',
      results: [null]
    });
    answerSeoRequestsWith({ run });

    await expect(fetchLighthouseRun(RUN_ID)).resolves.toStrictEqual(run);
  });

  it('throws InvalidSeoResponseError when a completed result lacks its metrics', async () => {
    const withoutMetrics = withoutField(buildCompletedResult(), 'metrics');
    answerSeoRequestsWith({
      run: {
        ...buildRun(),
        results: [withoutMetrics]
      }
    });

    await expect(fetchLighthouseRun(RUN_ID)).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('IndexNow', () => {
  it('decodes the setup with keys and history', async () => {
    answerSeoRequestsWith(buildSetup());

    await expect(fetchIndexNowSetup()).resolves.toStrictEqual(buildSetup());
  });

  it('posts pasted URLs to the submit route', async () => {
    answerSeoRequestsWith({ submission: buildSubmission() });

    await submitIndexNow({
      source: 'paste',
      urls: [PAGE]
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.example.com/api/seo/indexnow/submit',
      body: {
        source: 'paste',
        urls: [PAGE]
      },
    });
  });

  it('throws InvalidSeoResponseError when an engine answer names an unknown engine', async () => {
    const submission = buildSubmission();
    const host = submission.hosts[0];
    answerSeoRequestsWith({
      submission: {
        ...submission,
        hosts: [{
          ...host,
          engines: [{
            engine: 'other',
            http_status: 200,
            message: 'ok'
          }]
        }]
      }
    });

    await expect(submitIndexNow({ source: 'audit' })).rejects.toThrow(InvalidSeoResponseError);
  });
});
