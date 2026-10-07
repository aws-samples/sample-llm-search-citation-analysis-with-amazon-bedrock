/**
 * Runtime guard for the stored narrative of `GET /reports/insights`
 * (`./insightsNarrative`). A narrative failing it is not shown, rather than
 * shown half-right.
 */
import type {
  InsightsNarrative, NarrativeInsight, NarrativeRecommendation
} from './insightsNarrative';
import {
  isNullableString, isRecord, isStringArray
} from '../../api/contentStudioDecoderPrimitives';

function isNarrativeInsight(value: unknown): value is NarrativeInsight {
  return isRecord(value)
    && typeof value.text === 'string'
    && isStringArray(value.insight_ids);
}

function isNarrativeRecommendation(value: unknown): value is NarrativeRecommendation {
  return isNarrativeInsight(value) && isRecord(value) && typeof value.title === 'string';
}

export function isInsightsNarrative(value: unknown): value is InsightsNarrative {
  return isRecord(value)
    && typeof value.run_timestamp === 'string'
    && isNullableString(value.model)
    && isNullableString(value.generated_at)
    && typeof value.language === 'string'
    && Array.isArray(value.insights)
    && value.insights.every(isNarrativeInsight)
    && Array.isArray(value.recommendations)
    && value.recommendations.every(isNarrativeRecommendation)
    && typeof value.dropped === 'number';
}

/** The narrative of an insights payload's `narrative` field, or `null` when there is none or it is malformed. */
export function decodeInsightsNarrative(value: unknown): InsightsNarrative | null {
  return isInsightsNarrative(value) ? value : null;
}
