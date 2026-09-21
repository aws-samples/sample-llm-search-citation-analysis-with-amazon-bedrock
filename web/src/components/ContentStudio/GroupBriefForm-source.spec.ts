import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import {
  buildContentBriefKeywordScope, buildGroupBriefDraft
} from './GroupBriefForm-fixtures';
import {
  GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
  GROUP_BRIEF_BUILTIN_TEMPLATE_IDS,
  GROUP_BRIEF_DEFAULT_TEMPLATES,
  GROUP_BRIEF_LANGUAGES,
  GROUP_BRIEF_MAX_COPY_LENGTH,
  GROUP_BRIEF_MAX_TEMPLATE_LENGTH,
  GROUP_BRIEF_MAX_URL_LENGTH,
  GROUP_BRIEF_MODE_OPTIONS,
  createGroupBriefIdeaId,
  isHttpLandingUrl,
  promptTemplateError,
  validateGroupBriefDraft,
} from './GroupBriefForm-source';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Content Brief options', () => {
  it('keeps the complete output-language list available', () => {
    expect(GROUP_BRIEF_LANGUAGES).toStrictEqual([
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
    ]);
  });

  it('keeps all three generation mode labels and descriptions available', () => {
    expect(GROUP_BRIEF_MODE_OPTIONS).toStrictEqual([
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
    ]);
  });

  it('maps every generation mode to its immutable built-in template ID', () => {
    expect(GROUP_BRIEF_BUILTIN_TEMPLATE_IDS).toStrictEqual({
      improve_current_url: 'builtin-improve-current-url',
      rewrite_pasted_copy: 'builtin-rewrite-pasted-copy',
      create_new_landing_page: 'builtin-create-new-landing-page',
    });
  });

  it('uses scope-aware non-empty defaults for every generation mode', () => {
    expect(Object.values(GROUP_BRIEF_DEFAULT_TEMPLATES).map((template) => ({
      hasScope: template.includes('{scope}'),
      lengthIsPositive: template.length > 0,
    }))).toStrictEqual([
      {
        hasScope: true,
        lengthIsPositive: true,
      },
      {
        hasScope: true,
        lengthIsPositive: true,
      },
      {
        hasScope: true,
        lengthIsPositive: true,
      },
    ]);
  });
});

describe('promptTemplateError', () => {
  it('returns a malformed-placeholder error when a closing brace is missing', () => {
    expect(promptTemplateError('Create for {scope')).toBe(
      'Prompt template contains a malformed placeholder.'
    );
  });

  it('returns sorted unique names when placeholders are unknown', () => {
    expect(promptTemplateError('{zeta} {alpha} {zeta}')).toBe(
      'Prompt template contains unknown placeholder(s): alpha, zeta.'
    );
  });

  it('returns the repeated name when a placeholder occurs three times', () => {
    expect(promptTemplateError('{scope} {scope} {scope}')).toBe(
      'Prompt template repeats placeholder(s) too many times: scope.'
    );
  });

  it('returns the repeated names in sorted order when two placeholders occur three times', () => {
    expect(promptTemplateError(
      '{scope} {scope} {scope} {brand} {brand} {brand}'
    )).toBe(
      'Prompt template repeats placeholder(s) too many times: brand, scope.'
    );
  });

  it('returns no error when one placeholder occurs exactly twice', () => {
    expect(promptTemplateError('{scope} {scope}')).toBeNull();
  });

  it('returns no error when every allowed placeholder occurs at most twice', () => {
    expect(promptTemplateError(
      '{brand} {scope} {group} {keywords} {current_copy} {landing_summary} '
      + '{mode_instructions} {output_language}'
    )).toBeNull();
  });
});

describe('isHttpLandingUrl', () => {
  it.each(['http://example.com', 'https://example.com/page'])(
    'returns true when the URL uses an HTTP protocol',
    (url) => {
      expect(isHttpLandingUrl(url)).toBe(true);
    }
  );

  it.each(['ftp://example.com', '/relative', 'not a URL'])(
    'returns false when the URL does not use an HTTP protocol',
    (url) => {
      expect(isHttpLandingUrl(url)).toBe(false);
    }
  );
});

describe('validateGroupBriefDraft scope', () => {
  it('requires exactly one group ID when group mode is empty', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      scope: {
        mode: 'groups',
        group_ids: [],
      },
    }))).toStrictEqual([{
      field: 'scope',
      message: 'Select one keyword group.',
    }]);
  });

  it('requires exactly one group ID when multiple groups reach validation', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      scope: {
        mode: 'groups',
        group_ids: ['group-1', 'group-2'],
      },
    }))).toStrictEqual([{
      field: 'scope',
      message: 'Select one keyword group.',
    }]);
  });

  it('reports an empty active group when its authoritative count is zero', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      scope: {
        mode: 'groups',
        group_ids: ['group-1'],
      },
      selectedKeywordCount: 0,
    }))).toStrictEqual([{
      field: 'scope',
      message: 'The selected group has no active keywords.',
    }]);
  });

  it('requires one active keyword when keyword mode is empty', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      scope: buildContentBriefKeywordScope([]),
      selectedKeywordCount: 0,
    }))).toStrictEqual([{
      field: 'scope',
      message: 'Select between 1 and 50 active keywords.',
    }]);
  });

  it('accepts exactly 50 active keywords in a combined brief', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ selectedKeywordCount: 50 }))).toStrictEqual([]);
  });

  it('rejects 51 active keywords without truncating them', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ selectedKeywordCount: 51 }))).toStrictEqual([{
      field: 'scope',
      message: 'The selected scope has more than 50 active keywords. Choose a smaller group or select up to 50 keywords.',
    }]);
  });
});

describe('validateGroupBriefDraft strategy', () => {
  it('accepts exactly ten keywords for separate briefs', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      strategy: 'per_keyword',
      selectedKeywordCount: 10,
    }))).toStrictEqual([]);
  });

  it('rejects eleven keywords for separate briefs with exact guidance', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      strategy: 'per_keyword',
      selectedKeywordCount: 11,
    }))).toStrictEqual([{
      field: 'strategy',
      message: GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
    }]);
  });
});

describe('validateGroupBriefDraft source fields', () => {
  it('accepts an HTTP URL at the maximum length', () => {
    const url = `https://example.com/${'a'.repeat(GROUP_BRIEF_MAX_URL_LENGTH - 20)}`;

    expect(url).toHaveLength(GROUP_BRIEF_MAX_URL_LENGTH);
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'improve_current_url',
      landingUrl: url,
    }))).toStrictEqual([]);
  });

  it('accepts surrounding whitespace around a valid HTTP URL', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'improve_current_url',
      landingUrl: '  https://example.com/page  ',
    }))).toStrictEqual([]);
  });

  it('rejects a landing URL above the maximum length', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'improve_current_url',
      landingUrl: 'x'.repeat(GROUP_BRIEF_MAX_URL_LENGTH + 1),
    }))).toStrictEqual([{
      field: 'landing_url',
      message: 'Landing URL must be at most 2,048 characters.',
    }]);
  });

  it('rejects a non-HTTP landing URL in improve-current mode', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'improve_current_url',
      landingUrl: 'ftp://example.com/page',
    }))).toStrictEqual([{
      field: 'landing_url',
      message: 'Enter a valid http or https landing URL.',
    }]);
  });

  it('accepts exactly the maximum copy length in rewrite mode', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'rewrite_pasted_copy',
      currentCopy: 'x'.repeat(GROUP_BRIEF_MAX_COPY_LENGTH),
    }))).toStrictEqual([]);
  });

  it('rejects copy above the maximum length in rewrite mode', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'rewrite_pasted_copy',
      currentCopy: 'x'.repeat(GROUP_BRIEF_MAX_COPY_LENGTH + 1),
    }))).toStrictEqual([{
      field: 'current_copy',
      message: 'Current copy must be at most 20,000 characters.',
    }]);
  });

  it('rejects whitespace-only copy in rewrite mode', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      mode: 'rewrite_pasted_copy',
      currentCopy: '   ',
    }))).toStrictEqual([{
      field: 'current_copy',
      message: 'Enter the current copy to rewrite.',
    }]);
  });

  it('ignores unused source values in create-new mode', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      landingUrl: 'not a URL',
      currentCopy: '',
    }))).toStrictEqual([]);
  });
});

describe('validateGroupBriefDraft template fields', () => {
  it('rejects a whitespace-only prompt template', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ promptTemplate: '   ' }))).toStrictEqual([{
      field: 'prompt_template',
      message: 'Prompt template is required.',
    }]);
  });

  it('accepts a prompt template at the maximum length', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ promptTemplate: 'x'.repeat(GROUP_BRIEF_MAX_TEMPLATE_LENGTH) }))).toStrictEqual([]);
  });

  it('rejects a prompt template above the maximum length', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ promptTemplate: 'x'.repeat(GROUP_BRIEF_MAX_TEMPLATE_LENGTH + 1) }))).toStrictEqual([{
      field: 'prompt_template',
      message: 'Prompt template must be at most 6,000 characters.',
    }]);
  });

  it('rejects the legacy group placeholder for keyword scope', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ promptTemplate: 'Create for {group}.' }))).toStrictEqual([{
      field: 'prompt_template',
      message: 'Prompt template cannot use {group} with selected keywords. Use {scope} instead.',
    }]);
  });

  it('accepts the legacy group placeholder for group scope', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({
      scope: {
        mode: 'groups',
        group_ids: ['group-1'],
      },
      promptTemplate: 'Create for {group}.',
    }))).toStrictEqual([]);
  });

  it('requires a non-whitespace template ID', () => {
    expect(validateGroupBriefDraft(buildGroupBriefDraft({ templateId: '   ' }))).toStrictEqual([{
      field: 'template_id',
      message: 'Select a prompt template.',
    }]);
  });
});

describe('createGroupBriefIdeaId', () => {
  it('returns the runtime UUID when randomUUID is available', () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid);

    expect(createGroupBriefIdeaId()).toBe(uuid);
  });

  it('returns the timestamp fallback when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    expect(createGroupBriefIdeaId()).toBe(`group-brief-${(1234).toString(36)}`);
  });

  it('returns deterministic random segments when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createGroupBriefIdeaId()).toBe('group-brief-1-2-3-4');
    expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint32Array));
  });
});


describe('promptTemplateError placeholder grammar', () => {
  it('returns no error when prompt text contains no placeholders', () => {
    expect(promptTemplateError('Create a useful landing page.')).toBeNull();
  });

  it('returns no error when a valid placeholder is present', () => {
    expect(promptTemplateError('Create for {brand}.')).toBeNull();
  });

  it('returns an unknown-placeholder error when a one-letter name is well formed', () => {
    expect(promptTemplateError('Create for {a}.')).toBe(
      'Prompt template contains unknown placeholder(s): a.'
    );
  });

  it('returns a malformed-placeholder error when a name begins with uppercase', () => {
    expect(promptTemplateError('Create for {Brand}.')).toBe(
      'Prompt template contains a malformed placeholder.'
    );
  });

  it('returns a malformed-placeholder error when a name begins with a number', () => {
    expect(promptTemplateError('Create for {1brand}.')).toBe(
      'Prompt template contains a malformed placeholder.'
    );
  });

  it('returns an unknown-placeholder error when a name ends with a number', () => {
    expect(promptTemplateError('Create for {brand2}.')).toBe(
      'Prompt template contains unknown placeholder(s): brand2.'
    );
  });

  it('returns a malformed-placeholder error when a name contains punctuation', () => {
    expect(promptTemplateError('Create for {brand-name}.')).toBe(
      'Prompt template contains a malformed placeholder.'
    );
  });

  it('returns a malformed-placeholder error when a valid name has extra braces', () => {
    expect(promptTemplateError('Create for {{brand}}.')).toBe(
      'Prompt template contains a malformed placeholder.'
    );
  });
});
