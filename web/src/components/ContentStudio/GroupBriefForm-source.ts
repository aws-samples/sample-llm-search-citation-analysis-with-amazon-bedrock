import type {
  ContentBriefScope, ContentBriefStrategy, GroupBriefMode
} from '../../types';

export const GROUP_BRIEF_MAX_KEYWORDS = 50;
export const GROUP_BRIEF_BATCH_MAX_KEYWORDS = 10;
export const GROUP_BRIEF_MAX_URL_LENGTH = 2048;
export const GROUP_BRIEF_MAX_COPY_LENGTH = 20_000;
export const GROUP_BRIEF_MAX_TEMPLATE_LENGTH = 6000;
export const GROUP_BRIEF_MAX_TEMPLATE_NAME_LENGTH = 100;
export const GROUP_BRIEF_MAX_TEMPLATE_DESCRIPTION_LENGTH = 500;

export const GROUP_BRIEF_BATCH_LIMIT_GUIDANCE =
  'Select 10 or fewer keywords to create separate briefs, or choose “Create one brief from this selection”.';

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
  'scope',
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

export const GROUP_BRIEF_BUILTIN_TEMPLATE_IDS: Record<GroupBriefMode, string> = {
  improve_current_url: 'builtin-improve-current-url',
  rewrite_pasted_copy: 'builtin-rewrite-pasted-copy',
  create_new_landing_page: 'builtin-create-new-landing-page',
};

export const GROUP_BRIEF_DEFAULT_TEMPLATES: Record<GroupBriefMode, string> = {
  improve_current_url: `Improve the existing landing page for {brand} and the scope {scope}.

Target keywords:
{keywords}

Current page text:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Create a substantially improved, useful page rather than a light edit. Preserve accurate facts from the source, strengthen search intent coverage, and organize the draft for readers. Write in {output_language}.`,
  rewrite_pasted_copy: `Rewrite the supplied landing-page copy for {brand} and the scope {scope}.

Target keywords:
{keywords}

Current copy:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Retain accurate source facts while improving clarity, structure, usefulness, and natural keyword coverage. Write in {output_language}.`,
  create_new_landing_page: `Create a new landing page for {brand} and the scope {scope}.

Target keywords:
{keywords}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Build the page from the selected keyword intent without assuming a specific industry or inventing unverifiable facts. Write in {output_language}.`,
};

export type GroupBriefValidationField =
  | 'scope'
  | 'strategy'
  | 'landing_url'
  | 'current_copy'
  | 'prompt_template'
  | 'template_id';

export interface GroupBriefDraft {
  scope: ContentBriefScope;
  selectedKeywordCount: number;
  strategy: ContentBriefStrategy;
  mode: GroupBriefMode;
  landingUrl: string;
  currentCopy: string;
  promptTemplate: string;
  templateId: string;
}

export interface GroupBriefValidationIssue {
  field: GroupBriefValidationField;
  message: string;
}

function placeholderPattern(): RegExp {
  return /\{([a-z][a-z0-9_]*)\}/gu;
}

function bracePattern(): RegExp {
  return /[{}]/gu;
}

export function promptTemplateError(template: string): string | null {
  const placeholderMatches = [...template.matchAll(placeholderPattern())];
  const braceCount = [...template.matchAll(bracePattern())].length;
  if (braceCount !== placeholderMatches.length * 2) {
    return 'Prompt template contains a malformed placeholder.';
  }

  const allowed = new Set<string>(GROUP_BRIEF_ALLOWED_PLACEHOLDERS);
  const placeholderNames = placeholderMatches.map((match) => match[1]);
  const unknown = placeholderNames
    .filter((name) => !allowed.has(name))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right));
  if (unknown.length > 0) {
    return `Prompt template contains unknown placeholder(s): ${unknown.join(', ')}.`;
  }

  const repeated = placeholderNames
    .filter((name) => placeholderNames.filter((candidate) => candidate === name).length > 2)
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

function promptTemplateIssueMessage(template: string): string | null {
  if (template.trim() === '') return 'Prompt template is required.';
  if (template.length > GROUP_BRIEF_MAX_TEMPLATE_LENGTH) {
    return 'Prompt template must be at most 6,000 characters.';
  }
  return promptTemplateError(template);
}

function scopeIssue(draft: GroupBriefDraft): GroupBriefValidationIssue | null {
  if (draft.scope.mode === 'groups' && draft.scope.group_ids.length !== 1) {
    return {
      field: 'scope',
      message: 'Select one keyword group.',
    };
  }
  if (draft.selectedKeywordCount === 0) {
    return {
      field: 'scope',
      message: draft.scope.mode === 'groups'
        ? 'The selected group has no active keywords.'
        : 'Select between 1 and 50 active keywords.',
    };
  }
  if (draft.selectedKeywordCount > GROUP_BRIEF_MAX_KEYWORDS) {
    return {
      field: 'scope',
      message: 'The selected scope has more than 50 active keywords. Choose a smaller group or select up to 50 keywords.',
    };
  }
  return null;
}

function strategyIssue(draft: GroupBriefDraft): GroupBriefValidationIssue | null {
  if (
    draft.strategy === 'per_keyword'
    && draft.selectedKeywordCount > GROUP_BRIEF_BATCH_MAX_KEYWORDS
  ) {
    return {
      field: 'strategy',
      message: GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
    };
  }
  return null;
}

function sourceIssues(draft: GroupBriefDraft): GroupBriefValidationIssue[] {
  const issues: GroupBriefValidationIssue[] = [];
  if (draft.landingUrl.length > GROUP_BRIEF_MAX_URL_LENGTH) {
    issues.push({
      field: 'landing_url',
      message: 'Landing URL must be at most 2,048 characters.',
    });
  } else if (
    draft.mode === 'improve_current_url'
    && !isHttpLandingUrl(draft.landingUrl)
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
  } else if (draft.mode === 'rewrite_pasted_copy' && draft.currentCopy.trim() === '') {
    issues.push({
      field: 'current_copy',
      message: 'Enter the current copy to rewrite.',
    });
  }
  return issues;
}

export function validateGroupBriefDraft(
  draft: GroupBriefDraft
): GroupBriefValidationIssue[] {
  const issues = sourceIssues(draft);
  const selectedScopeIssue = scopeIssue(draft);
  const selectedStrategyIssue = strategyIssue(draft);
  if (selectedScopeIssue !== null) issues.unshift(selectedScopeIssue);
  if (selectedStrategyIssue !== null) issues.push(selectedStrategyIssue);

  const templateMessage = promptTemplateIssueMessage(draft.promptTemplate);
  if (templateMessage !== null) {
    issues.push({
      field: 'prompt_template',
      message: templateMessage,
    });
  } else if (draft.scope.mode === 'keywords' && draft.promptTemplate.includes('{group}')) {
    issues.push({
      field: 'prompt_template',
      message: 'Prompt template cannot use {group} with selected keywords. Use {scope} instead.',
    });
  }
  if (draft.templateId.trim() === '') {
    issues.push({
      field: 'template_id',
      message: 'Select a prompt template.',
    });
  }
  return issues;
}

export function createGroupBriefIdeaId(): string {
  const runtime: { crypto?: Crypto } = globalThis;
  const cryptoApi = runtime.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (cryptoApi === undefined) return `group-brief-${Date.now().toString(36)}`;
  const randomValues = new Uint32Array(4);
  cryptoApi.getRandomValues(randomValues);
  return `group-brief-${[...randomValues].map((value) => value.toString(36)).join('-')}`;
}
