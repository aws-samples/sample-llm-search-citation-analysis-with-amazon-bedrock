/**
 * Keyword research API client.
 *
 * A research job (seed-keyword expansion or competitor URL analysis) runs in
 * its own Step Functions execution, one parallel step per web-search
 * provider. Starting a job answers 202 with the job id; the job is then read
 * by id until it reaches a terminal status. While it runs, the job carries the
 * steps completed so far and the results merged from them.
 */
import {
  apiDelete, apiGet, apiPost
} from './client';
import type { KeywordResearchItem } from '../types';

export class InvalidKeywordResearchResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeywordResearchResponseError';
  }
}

export type ResearchType = KeywordResearchItem['type'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isKeywordResearchItem(value: unknown): value is KeywordResearchItem {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.type === 'expansion' || value.type === 'competitor');
}

function decodeJob(payload: unknown): KeywordResearchItem {
  if (!isKeywordResearchItem(payload)) {
    throw new InvalidKeywordResearchResponseError('Keyword research API returned an invalid job');
  }
  return payload;
}

/** Start an expansion job; resolves to the pending job (its id is what gets polled). */
export async function startKeywordExpansion(
  seedKeyword: string,
  industry: string,
  count: number
): Promise<KeywordResearchItem> {
  return decodeJob(await apiPost<unknown>('/keyword-research/expand', {
    seed_keyword: seedKeyword,
    industry,
    count,
  }, { allowStructured4xx: true }));
}

/** Start a competitor URL analysis job; resolves to the pending job. */
export async function startCompetitorAnalysis(url: string): Promise<KeywordResearchItem> {
  return decodeJob(await apiPost<unknown>('/keyword-research/competitor', { url }, { allowStructured4xx: true }));
}

/** Re-run only the steps of a failed or partial job that did not complete. */
export async function retryKeywordResearch(id: string): Promise<void> {
  await apiPost<unknown>(`/keyword-research/${encodeURIComponent(id)}/retry`, {}, { allowStructured4xx: true });
}

/** The job with its steps and (partial) merged results. */
export async function fetchKeywordResearch(id: string, signal?: AbortSignal): Promise<KeywordResearchItem> {
  return decodeJob(await apiGet<unknown>(`/keyword-research/${encodeURIComponent(id)}`, { signal }));
}

export async function fetchKeywordResearchHistory(type?: ResearchType, signal?: AbortSignal): Promise<KeywordResearchItem[]> {
  const params: Record<string, string> = { limit: '50' };
  if (type) params.type = type;
  const payload = await apiGet<unknown>('/keyword-research/history', {
    params,
    signal
  });
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new InvalidKeywordResearchResponseError('Keyword research API returned an invalid history');
  }
  return payload.items.filter(isKeywordResearchItem);
}

export async function deleteKeywordResearch(id: string): Promise<void> {
  await apiDelete<unknown>(`/keyword-research/${encodeURIComponent(id)}`);
}
