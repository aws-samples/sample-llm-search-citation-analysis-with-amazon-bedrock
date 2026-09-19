/**
 * Keyword research API client.
 *
 * A research job (seed-keyword expansion, competitor URL analysis or a
 * research-agent run) runs in its own Step Functions execution, one parallel
 * step per web-search provider (or per planned query for the agent). Starting
 * a job answers 202 with the job id; the job is then read by id until it
 * reaches a terminal status. While it runs, the job carries the steps
 * completed so far and the results merged from them.
 */
import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import type {
  AgentDimensionOption, KeywordResearchItem, ResearchTemplate
} from '../types';

export class InvalidKeywordResearchResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeywordResearchResponseError';
  }
}

export type ResearchType = KeywordResearchItem['type'];

const RESEARCH_TYPES: readonly string[] = ['expansion', 'competitor', 'agent'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isKeywordResearchItem(value: unknown): value is KeywordResearchItem {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.type === 'string'
    && RESEARCH_TYPES.includes(value.type);
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

/** The brief for a research-agent run (POST /keyword-research/agent). */
export interface StartAgentRequest {
  seed: string;
  country: string;
  language: string;
  /** Ids from the template's dimension catalogue, in catalogue order. */
  dimensions: string[];
  instruction: string;
  targetCount: number;
  maxRounds: number;
  /** Template the prompt came from; the API snapshots the resolved prompt on the job. */
  templateId: string | null;
  /** The prompt as edited in the form; omit to use the template's text. */
  systemPrompt: string | null;
  /** Group the proposal is meant for (validated server-side). */
  groupId: string | null;
}

/** Start a research-agent job; resolves to the pending job. */
export async function startResearchAgent(request: StartAgentRequest): Promise<KeywordResearchItem> {
  return decodeJob(await apiPost<unknown>('/keyword-research/agent', {
    seed: request.seed,
    country: request.country,
    language: request.language,
    dimensions: request.dimensions,
    instruction: request.instruction,
    target_count: request.targetCount,
    max_rounds: request.maxRounds,
    ...(request.templateId === null ? {} : { template_id: request.templateId }),
    ...(request.systemPrompt === null ? {} : { system_prompt: request.systemPrompt }),
    ...(request.groupId === null ? {} : { group_id: request.groupId }),
  }, { allowStructured4xx: true }));
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

// ---------------------------------------------------------------------------
// Agent templates (industry profiles)
// ---------------------------------------------------------------------------

export function isResearchTemplate(value: unknown): value is ResearchTemplate {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.system_prompt === 'string'
    && typeof value.builtin === 'boolean'
    && typeof value.industry === 'string'
    && typeof value.subject === 'string'
    && typeof value.audience === 'string'
    && Array.isArray(value.dimensions);
}

function decodeTemplate(payload: unknown): ResearchTemplate {
  if (!isResearchTemplate(payload)) {
    throw new InvalidKeywordResearchResponseError('Keyword research API returned an invalid template');
  }
  return payload;
}

/** The built-in templates first (in the API's order), then the saved ones by name. */
export async function fetchResearchTemplates(signal?: AbortSignal): Promise<ResearchTemplate[]> {
  const payload = await apiGet<unknown>('/keyword-research/templates', { signal });
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new InvalidKeywordResearchResponseError('Keyword research API returned an invalid template list');
  }
  return payload.items.filter(isResearchTemplate);
}

/**
 * A template to save. The profile fields are optional: the API copies the
 * missing ones from `baseTemplateId` (else from the generic built-in).
 */
export interface TemplateDraft {
  name: string;
  systemPrompt: string;
  description?: string;
  /** Template the draft was derived from; the API copies its industry and any missing profile field. */
  baseTemplateId?: string;
  industry?: string;
  subject?: string;
  audience?: string;
  dimensions?: AgentDimensionOption[];
}

/** The fields PUT /templates/{id} accepts: everything but the industry (fixed) and the base (creation only). */
export type TemplateChanges = Omit<Partial<TemplateDraft>, 'baseTemplateId' | 'industry'>;

/** The optional draft fields in the API's names, sent only when the draft sets them. */
function templateProfileBody(draft: TemplateChanges): Record<string, unknown> {
  return {
    ...(draft.description === undefined ? {} : { description: draft.description }),
    ...(draft.subject === undefined ? {} : { subject: draft.subject }),
    ...(draft.audience === undefined ? {} : { audience: draft.audience }),
    ...(draft.dimensions === undefined ? {} : { dimensions: draft.dimensions }),
  };
}

export async function createResearchTemplate(draft: TemplateDraft): Promise<ResearchTemplate> {
  return decodeTemplate(await apiPost<unknown>('/keyword-research/templates', {
    name: draft.name,
    system_prompt: draft.systemPrompt,
    ...templateProfileBody(draft),
    ...(draft.baseTemplateId === undefined ? {} : { base_template_id: draft.baseTemplateId }),
    ...(draft.industry === undefined ? {} : { industry: draft.industry }),
  }, { allowStructured4xx: true }));
}

export async function updateResearchTemplate(id: string, changes: TemplateChanges): Promise<ResearchTemplate> {
  return decodeTemplate(await apiPut<unknown>(`/keyword-research/templates/${encodeURIComponent(id)}`, {
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(changes.systemPrompt === undefined ? {} : { system_prompt: changes.systemPrompt }),
    ...templateProfileBody(changes),
  }, { allowStructured4xx: true }));
}

export async function deleteResearchTemplate(id: string): Promise<void> {
  await apiDelete<unknown>(`/keyword-research/templates/${encodeURIComponent(id)}`);
}
