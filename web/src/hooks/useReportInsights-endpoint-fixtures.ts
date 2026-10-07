/**
 * The mocked `/reports/insights` endpoint for the hook spec, which replaces
 * the `infrastructure` barrel with `test/infrastructureMock` first.
 */
import { expect } from 'vitest';
import type { ReportScope } from '../types';
import type { ReportInsightsResponse } from '../types/domain/insights';
import { buildReportInsights } from '../types/domain/insights-fixtures';
import {
  createEndpointMockFetch, type EndpointMockFetchOptions
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { renderLoadedHook } from '../test/loadedHook';
import { useReportInsights } from './useReportInsights';

/** Points the mocked `authenticatedFetch` at `/reports/insights` answering the airline group, unless `options` say otherwise. */
export function mockInsightsEndpoint(options: EndpointMockFetchOptions<ReportInsightsResponse> = {}): void {
  mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(buildReportInsights(), options));
}

/** Renders the hook over the mocked endpoint and waits for its first load. */
export function renderLoadedInsights(scope: ReportScope, days: number, options?: EndpointMockFetchOptions<ReportInsightsResponse>) {
  mockInsightsEndpoint(options);
  return renderLoadedHook(() => useReportInsights(scope, days));
}

/** The `authenticatedFetch` call the hook makes for `url`: abortable, nothing else. */
export function insightsRequest(url: string): readonly unknown[] {
  const signal: unknown = expect.any(AbortSignal);
  return [url, { signal }];
}
