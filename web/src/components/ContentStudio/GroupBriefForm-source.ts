import type { GroupBriefMode } from '../../types';

export const GROUP_BRIEF_MAX_KEYWORDS = 50;
export const GROUP_BRIEF_MAX_URL_LENGTH = 2048;
export const GROUP_BRIEF_MAX_COPY_LENGTH = 20_000;
export const GROUP_BRIEF_MAX_TEMPLATE_LENGTH = 6000;

export const GROUP_BRIEF_LANGUAGES: readonly string[] = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Catalan',
  'Japanese',
  'Chinese',
  'Korean',
  'Arabic',
];

export const GROUP_BRIEF_ALLOWED_PLACEHOLDERS: readonly string[] = [
  'brand',
  'group',
  'keywords',
  'current_copy',
  'landing_summary',
  'mode_instructions',
  'output_language',
];

export const GROUP_BRIEF_MODE_OPTIONS: readonly {
  value: GroupBriefMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'improve_current_url',
    label: 'Improve current URL',
    description: 'Fetch the current page securely, then rewrite and improve it.',
  },
  {
    value: 'rewrite_pasted_copy',
    label: 'Rewrite pasted copy',
    description: 'Turn supplied copy into a stronger complete landing page.',
  },
  {
    value: 'create_new_landing_page',
    label: 'Create new landing page',
    description: 'Create a complete page from the selected keyword intent.',
  },
];

export const GROUP_BRIEF_DEFAULT_TEMPLATES: Record<GroupBriefMode, string> = {
  improve_current_url: `Improve the existing landing page for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Current page text:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Create a substantially improved, useful page rather than a light edit. Preserve accurate facts from the source, strengthen search intent coverage, and organize the draft for readers. Write in {output_language}.`,
  rewrite_pasted_copy: `Rewrite the supplied landing-page copy for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Current copy:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Retain accurate source facts while improving clarity, structure, usefulness, and natural keyword coverage. Write in {output_language}.`,
  create_new_landing_page: `Create a new landing page for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Build the page from the selected keyword intent without assuming a specific industry or inventing unverifiable facts. Write in {output_language}.`,
};

export type GroupBriefValidationField =
  | 'group_id'
  | 'keyword_ids'
  | 'landing_url'
  | 'current_copy'
  | 'prompt_template';

export interface GroupBriefDraft {
  groupId: string;
  selectedKeywordIds: readonly string[];
  mode: GroupBriefMode;
  landingUrl: string;
  currentCopy: string;
  promptTemplate: string;
}

export interface GroupBriefValidationIssue {
  field: GroupBriefValidationField;
  message: string;
}

const placeholderPattern = /\{([a-z][a-z0-9_]*)\}/gu;
const malformedBracePattern = /[{}]/u;

export function promptTemplateError(template: string): string | null {
  const withoutValidPlaceholders = template.replaceAll(placeholderPattern, '');
  if (malformedBracePattern.test(withoutValidPlaceholders)) {
    return 'Prompt template contains a malformed placeholder.';
  }

  const allowed = new Set<string>(GROUP_BRIEF_ALLOWED_PLACEHOLDERS);
  const placeholderNames = [...template.matchAll(placeholderPattern)].map((match) => match[1]);
  const unknown = placeholderNames
    .filter((name) => !allowed.has(name))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right));
  if (unknown.length > 0) {
    return `Prompt template contains unknown placeholder(s): ${unknown.join(', ')}.`;
  }

  const repeated = placeholderNames
    .filter((name) => (
      placeholderNames.filter((candidate) => candidate === name).length > 2
    ))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right));
  return repeated.length > 0
    ? `Prompt template repeats placeholder(s) too many times: ${repeated.join(', ')}.`
    : null;
}

export function isHttpLandingUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateGroupBriefDraft(
  draft: GroupBriefDraft
): GroupBriefValidationIssue[] {
  const issues: GroupBriefValidationIssue[] = [];
  if (draft.groupId === '') {
    issues.push({
      field: 'group_id',
      message: 'Select a keyword group.',
    });
  }
  if (
    draft.selectedKeywordIds.length === 0
    || draft.selectedKeywordIds.length > GROUP_BRIEF_MAX_KEYWORDS
  ) {
    issues.push({
      field: 'keyword_ids',
      message: 'Select between 1 and 50 active keywords.',
    });
  }
  if (draft.landingUrl.length > GROUP_BRIEF_MAX_URL_LENGTH) {
    issues.push({
      field: 'landing_url',
      message: 'Landing URL must be at most 2,048 characters.',
    });
  } else if (
    draft.mode === 'improve_current_url'
    && !isHttpLandingUrl(draft.landingUrl.trim())
  ) {
    issues.push({
      field: 'landing_url',
      message: 'Enter a valid http or https landing URL.',
    });
  }
  if (draft.currentCopy.length > GROUP_BRIEF_MAX_COPY_LENGTH) {
    issues.push({
      field: 'current_copy',
      message: 'Current copy must be at most 20,000 characters.',
    });
  } else if (
    draft.mode === 'rewrite_pasted_copy'
    && draft.currentCopy.trim() === ''
  ) {
    issues.push({
      field: 'current_copy',
      message: 'Enter the current copy to rewrite.',
    });
  }
  if (draft.promptTemplate.trim() === '') {
    issues.push({
      field: 'prompt_template',
      message: 'Prompt template is required.',
    });
  } else if (draft.promptTemplate.length > GROUP_BRIEF_MAX_TEMPLATE_LENGTH) {
    issues.push({
      field: 'prompt_template',
      message: 'Prompt template must be at most 6,000 characters.',
    });
  } else {
    const templateError = promptTemplateError(draft.promptTemplate);
    if (templateError !== null) {
      issues.push({
        field: 'prompt_template',
        message: templateError,
      });
    }
  }
  return issues;
}

export function createGroupBriefIdeaId(): string {
  const runtime: { crypto?: Crypto } = globalThis;
  const cryptoApi = runtime.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi === undefined) {
    return `group-brief-${Date.now().toString(36)}`;
  }
  const randomValues = new Uint32Array(4);
  cryptoApi.getRandomValues(randomValues);
  return `group-brief-${[...randomValues].map((value) => value.toString(36)).join('-')}`;
}
