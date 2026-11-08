/** Builders of page performance API answers (the example brand's own site only). */
import type {
  CompletedResult,
  IndexNowSetup,
  IndexNowSite,
  IndexNowSubmission,
  KeyFileCheck,
  LighthouseRun,
  LighthouseSample,
  StartRunResponse,
} from '../types/api/seoPerformance';

export const PAGE = 'https://www.example.com/';
export const RUN_ID = '0123456789abcdef0123456789abcdef';
export const AUDIT_ID = 'fedcba9876543210fedcba9876543210';
export const KEY = 'abcdefabcdefabcdefabcdefabcdef12';

export function buildCompletedResult(overrides: Partial<CompletedResult> = {}): CompletedResult {
  return {
    url: PAGE,
    device: 'mobile',
    status: 'completed',
    final_url: PAGE,
    lighthouse_version: '12.6.0',
    scores: {
      performance: 42,
      accessibility: 95,
      best_practices: 75,
      seo: null,
    },
    metrics: {
      lcp_ms: 4600,
      cls: 0.05,
      inp_ms: null,
      ttfb_ms: 420,
      fcp_ms: 1900,
      tbt_ms: 150,
      speed_index_ms: 3000,
    },
    failed_audits: [{
      id: 'render-blocking-resources',
      category: 'performance',
      title: 'Eliminate render-blocking resources',
      description: 'Resources are blocking the first paint of the page.',
      display_value: 'Potential savings of 350 ms',
      score: 40,
      savings_ms: 350,
      savings_bytes: 153_600,
      severity: 'critical',
    }],
    fetched_at: '2026-10-02T08:01:00Z',
    ...overrides,
  };
}

export function buildRun(overrides: Partial<LighthouseRun> = {}): LighthouseRun {
  return {
    run_id: RUN_ID,
    kind: 'single',
    status: 'completed',
    created_at: '2026-10-02T08:00:00Z',
    updated_at: '2026-10-02T08:01:00Z',
    started_by: 'user@example.com',
    audit_id: null,
    target_count: 1,
    first_url: PAGE,
    targets: [{
      url: PAGE,
      device: 'mobile'
    }],
    results: [buildCompletedResult()],
    progress: {
      done: 1,
      total: 1
    },
    error: null,
    ...overrides,
  };
}

export function buildStartRunResponse(run: LighthouseRun = buildRun(), reused = false): StartRunResponse {
  return {
    run,
    reused
  };
}

export function buildSample(overrides: Partial<LighthouseSample> = {}): LighthouseSample {
  return {
    audit: {
      audit_id: AUDIT_ID,
      start_url: PAGE,
      completed_at: '2026-10-01T09:00:00Z',
      pages_crawled: 120
    },
    pages: [PAGE, 'https://www.example.com/blog/first-great-post'],
    devices: ['mobile', 'desktop'],
    target_count: 4,
    ...overrides,
  };
}

export function buildSite(overrides: Partial<IndexNowSite> = {}): IndexNowSite {
  return {
    domain: 'example.com',
    key: KEY,
    key_files: [
      {
        host: 'example.com',
        url: `https://example.com/${KEY}.txt`
      },
      {
        host: 'www.example.com',
        url: `https://www.example.com/${KEY}.txt`
      },
    ],
    ...overrides,
  };
}

export function buildSubmission(overrides: Partial<IndexNowSubmission> = {}): IndexNowSubmission {
  return {
    submitted_at: '2026-10-02T08:00:00Z',
    submitted_by: 'admin@example.com',
    source: 'paste',
    url_count: 2,
    skipped_count: 1,
    skipped_examples: ['https://acme.example.org/'],
    hosts: [{
      host: 'www.example.com',
      url_count: 2,
      status: 'submitted',
      message: 'Submitted 2 URLs.',
      key_file: 'found',
      engines: [
        {
          engine: 'bing',
          http_status: 429,
          message: 'Search engines are refusing submissions right now.'
        },
        {
          engine: 'yandex',
          http_status: 200,
          message: 'Submitted 2 URLs.'
        },
      ],
    }],
    ...overrides,
  };
}

export function buildSetup(overrides: Partial<IndexNowSetup> = {}): IndexNowSetup {
  return {
    sites: [buildSite()],
    history: [buildSubmission()],
    max_urls: 10_000,
    ...overrides,
  };
}

export function buildKeyFileCheck(): KeyFileCheck {
  return {
    domain: 'example.com',
    hosts: [
      {
        host: 'example.com',
        url: `https://example.com/${KEY}.txt`,
        status: 'moved',
        problem: 'The key file on https://example.com redirects. Upload it to https://example.com itself.'
      },
      {
        host: 'www.example.com',
        url: `https://www.example.com/${KEY}.txt`,
        status: 'found',
        problem: null
      },
    ],
  };
}
