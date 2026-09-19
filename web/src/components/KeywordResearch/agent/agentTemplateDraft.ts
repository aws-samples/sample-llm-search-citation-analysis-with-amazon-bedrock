/**
 * The template editor's draft: the profile fields the user edits, the
 * dimension ids derived from their labels and the validation the API will
 * apply again (`lambda/shared/research_agent.py`).
 */
import type {
  TemplateChanges, TemplateDraft
} from '../../../api/keywordResearch';
import type {
  AgentDimensionOption, ResearchTemplate
} from '../../../types';
import {
  OTHER_DIMENSION_ID, SYSTEM_PROMPT_MAX_LENGTH, SYSTEM_PROMPT_MIN_LENGTH
} from './agentBrief';

export const TEMPLATE_NAME_MAX_LENGTH = 100;
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;
export const TEMPLATE_MIN_DIMENSIONS = 2;
export const TEMPLATE_MAX_DIMENSIONS = 12;
export const DIMENSION_LABEL_MAX_LENGTH = 60;
export const DIMENSION_DESCRIPTION_MAX_LENGTH = 200;
const DIMENSION_ID_MAX_LENGTH = 40;
const DIMENSION_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
/** 2..40 characters of letters, spaces, hyphens, apostrophes and accents. */
const PLAIN_WORDS_PATTERN = /^\p{L}[\p{L}\s'’-]{1,39}$/u;

/**
 * One editable dimension; `key` is stable across edits so React can track the
 * row. Rows loaded from the template keep their stored `id`; rows the user
 * adds derive theirs from the label.
 */
export interface DimensionRow {
  key: string;
  id?: string;
  label: string;
  description: string;
}

export interface TemplateDraftFields {
  name: string;
  description: string;
  subject: string;
  audience: string;
  rows: DimensionRow[];
}

/** Inline messages per field; a field is absent when it is valid. */
export interface TemplateDraftProblems {
  name?: string;
  subject?: string;
  audience?: string;
  /** About the list itself (too few / too many rows). */
  dimensions?: string;
  /** Per row key. */
  rows: Record<string, string>;
  systemPrompt?: string;
}

/**
 * The id the API stores for a dimension: the label lower-cased, accents
 * stripped, everything but letters, digits and underscores folded to a
 * single underscore ("Menú & bebidas" → "menu_bebidas").
 */
export function dimensionIdFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, '_')
    .slice(0, DIMENSION_ID_MAX_LENGTH);
}

/** The editor's starting point: the template's profile; a built-in gets a copy's name. */
export function draftFromTemplate(template: ResearchTemplate): TemplateDraftFields {
  return {
    name: template.builtin ? `${template.name} (copy)` : template.name,
    description: template.description,
    subject: template.subject,
    audience: template.audience,
    rows: template.dimensions.map((option) => ({
      key: option.id,
      id: option.id,
      label: option.label,
      description: option.description,
    })),
  };
}

/** A stored row keeps its id; a new row's id follows its label. */
export function dimensionRowId(row: DimensionRow): string {
  return row.id ?? dimensionIdFromLabel(row.label);
}

/** The rows as the API's dimension list. */
export function draftDimensions(rows: readonly DimensionRow[]): AgentDimensionOption[] {
  return rows.map((row) => ({
    id: dimensionRowId(row),
    label: row.label.trim(),
    description: row.description.trim(),
  }));
}

function rowProblem(row: DimensionRow, id: string, seen: Set<string>): string | undefined {
  if (row.label.trim() === '') return 'Enter a label.';
  if (row.label.length > DIMENSION_LABEL_MAX_LENGTH) return `Labels are at most ${DIMENSION_LABEL_MAX_LENGTH} characters.`;
  if (row.description.length > DIMENSION_DESCRIPTION_MAX_LENGTH) return `Descriptions are at most ${DIMENSION_DESCRIPTION_MAX_LENGTH} characters.`;
  if (id === OTHER_DIMENSION_ID) return '"Other" is reserved for the agent\u2019s catch-all bucket.';
  if (!DIMENSION_ID_PATTERN.test(id)) return 'The label must start with a letter and contain a letter or digit after it.';
  if (seen.has(id)) return `Duplicate of another dimension (${id}).`;
  return undefined;
}

function dimensionProblems(rows: readonly DimensionRow[]): Pick<TemplateDraftProblems, 'dimensions' | 'rows'> {
  const seen = new Set<string>();
  const perRow: Record<string, string> = {};
  for (const row of rows) {
    const id = dimensionRowId(row);
    const problem = rowProblem(row, id, seen);
    if (problem === undefined) {
      seen.add(id);
    } else {
      perRow[row.key] = problem;
    }
  }
  const problems: Pick<TemplateDraftProblems, 'dimensions' | 'rows'> = { rows: perRow };
  if (rows.length < TEMPLATE_MIN_DIMENSIONS) problems.dimensions = `Add at least ${TEMPLATE_MIN_DIMENSIONS} dimensions.`;
  if (rows.length > TEMPLATE_MAX_DIMENSIONS) problems.dimensions = `At most ${TEMPLATE_MAX_DIMENSIONS} dimensions.`;
  return problems;
}

function plainWordsProblem(value: string, field: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) return `Enter the ${field} (at least 2 characters).`;
  if (!PLAIN_WORDS_PATTERN.test(trimmed)) return `The ${field} is plain words: letters, spaces, hyphens and apostrophes, at most 40 characters.`;
  return undefined;
}

/** Everything the editor checks before saving; the API re-checks. */
export function templateDraftProblems(draft: TemplateDraftFields, systemPrompt: string): TemplateDraftProblems {
  const problems: TemplateDraftProblems = dimensionProblems(draft.rows);
  if (draft.name.trim() === '') problems.name = 'Enter a template name.';
  if (draft.name.length > TEMPLATE_NAME_MAX_LENGTH) problems.name = `Names are at most ${TEMPLATE_NAME_MAX_LENGTH} characters.`;
  const subject = plainWordsProblem(draft.subject, 'subject');
  if (subject !== undefined) problems.subject = subject;
  const audience = plainWordsProblem(draft.audience, 'audience');
  if (audience !== undefined) problems.audience = audience;
  if (systemPrompt.trim().length < SYSTEM_PROMPT_MIN_LENGTH) problems.systemPrompt = 'The instructions are too short.';
  if (systemPrompt.length > SYSTEM_PROMPT_MAX_LENGTH) problems.systemPrompt = `The instructions exceed ${SYSTEM_PROMPT_MAX_LENGTH} characters.`;
  return problems;
}

export function hasTemplateDraftProblems(problems: TemplateDraftProblems): boolean {
  const {
    rows, ...fields
  } = problems;
  return Object.keys(rows).length > 0 || Object.keys(fields).length > 0;
}

/** The body for POST /templates: the draft plus the template it was derived from. */
export function newTemplateDraft(template: ResearchTemplate, draft: TemplateDraftFields, systemPrompt: string): TemplateDraft {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    systemPrompt,
    baseTemplateId: template.id,
    subject: draft.subject.trim(),
    audience: draft.audience.trim(),
    dimensions: draftDimensions(draft.rows),
  };
}

function sameDimensions(left: readonly AgentDimensionOption[], right: readonly AgentDimensionOption[]): boolean {
  return left.length === right.length
    && left.every((option, index) => option.id === right[index].id
      && option.label === right[index].label
      && option.description === right[index].description);
}

/** The body for PUT /templates/{id}: only what differs from the saved template. */
export function templateChanges(template: ResearchTemplate, draft: TemplateDraftFields, systemPrompt: string): TemplateChanges {
  const next = newTemplateDraft(template, draft, systemPrompt);
  const dimensions = draftDimensions(draft.rows);
  return {
    ...(next.name === template.name ? {} : { name: next.name }),
    ...(next.description === template.description ? {} : { description: next.description }),
    ...(systemPrompt === template.system_prompt ? {} : { systemPrompt }),
    ...(next.subject === template.subject ? {} : { subject: next.subject }),
    ...(next.audience === template.audience ? {} : { audience: next.audience }),
    ...(sameDimensions(dimensions, template.dimensions) ? {} : { dimensions }),
  };
}
