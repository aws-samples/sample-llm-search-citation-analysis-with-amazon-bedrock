/**
 * Replacement for the `api/client` module in the narrative specs, and the
 * payloads the regenerate poll reads:
 *
 * ```ts
 * vi.mock('../api/client', () => import('./useNarrativeRegeneration-fixtures'));
 * import { mockApiGet, mockApiPost } from './useNarrativeRegeneration-fixtures';
 * ```
 */
import { vi } from 'vitest';
import type {
  apiGet as realApiGet, apiPost as realApiPost
} from '../api/client';
import type { ReportInsightsResponse } from '../types/domain/insights';
import { buildReportInsights } from '../types/domain/insights-fixtures';
import type { InsightsNarrative } from '../types/domain/insightsNarrative';
import { buildNarrative } from '../types/domain/insightsNarrative-fixtures';

export const mockApiGet = vi.fn<typeof realApiGet>();
export const mockApiPost = vi.fn<typeof realApiPost>();

export {
  mockApiGet as apiGet, mockApiPost as apiPost
};

/** `buildReportInsights()` carrying `narrative` (none when `null`). */
export function buildInsightsWithNarrative(narrative: InsightsNarrative | null = buildNarrative()): ReportInsightsResponse {
  return buildReportInsights({ narrative: narrative === null ? null : { ...narrative } });
}

/** The narrative a regenerate writes: the same run, written again later. */
export function buildRegeneratedNarrative(): InsightsNarrative {
  return buildNarrative({
    generated_at: '2026-10-08T09:00:00.000000Z',
    insights: [{
      text: 'Gemini cita a Aurora Airways en solo el 20% de las respuestas.',
      insight_ids: ['engine_play:gemini'],
    }],
    recommendations: [],
    dropped: 0,
  });
}

/** Every poll of `GET /reports/insights` answers `narrative`; the regenerate request is accepted. */
export function stubRegenerateAndPoll(narrative: InsightsNarrative | null): void {
  mockApiPost.mockResolvedValue({
    status: 'accepted',
    group_id: 'group-coruna',
  });
  mockApiGet.mockResolvedValue(buildInsightsWithNarrative(narrative));
}
