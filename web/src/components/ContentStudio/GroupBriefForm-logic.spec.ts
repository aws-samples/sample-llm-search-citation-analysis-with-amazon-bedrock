import {
  describe, expect, it
} from 'vitest';
import type {
  ContentBriefFields, ContentBriefScope
} from '../../types';
import {
  buildKeyword, buildKeywordGroup
} from './GroupBriefForm-fixtures';
import {
  canonicalContentBriefScope,
  contentBriefFields,
  pendingContentBriefGeneration,
  selectedActiveKeywords,
} from './GroupBriefForm-logic';

const BRIEF_FIELDS: ContentBriefFields = {
  content_angle: 'create_new_landing_page',
  landing_url: '',
  current_copy: '',
  template_id: 'template-1',
  prompt_template: 'Create for {scope}.',
  output_language: 'English',
};

describe('selectedActiveKeywords', () => {
  it('includes a keyword when any membership matches the selected group', () => {
    const matching = buildKeyword({ group_ids: ['group-2', 'group-1'] });
    const missingMembership = buildKeyword({
      id: 'keyword-2',
      keyword: 'No membership',
      group_ids: undefined,
    });
    const other = buildKeyword({
      id: 'keyword-3',
      keyword: 'Other group',
      group_ids: ['group-2'],
    });
    const scope: ContentBriefScope = {
      mode: 'groups',
      group_ids: ['group-1'],
    };

    expect(selectedActiveKeywords(scope, [matching, missingMembership, other])).toStrictEqual([
      matching,
    ]);
  });

  it('preserves input order when explicit keyword IDs are selected out of order', () => {
    const first = buildKeyword();
    const second = buildKeyword({
      id: 'keyword-2',
      keyword: 'Second keyword',
    });

    const selected = selectedActiveKeywords({
      mode: 'keywords',
      keyword_ids: ['keyword-2', 'keyword-1'],
    }, [first, second]);

    expect(selected).toStrictEqual([first, second]);
  });
});

describe('canonicalContentBriefScope', () => {
  it('removes unknown group IDs without truncating known IDs', () => {
    const scope: ContentBriefScope = {
      mode: 'groups',
      group_ids: ['unknown', 'group-1'],
    };

    const canonical = canonicalContentBriefScope(
      scope,
      [buildKeywordGroup()],
      [buildKeyword()]
    );

    expect(canonical).toStrictEqual({
      mode: 'groups',
      group_ids: ['group-1'],
    });
  });

  it('derives explicit keyword IDs from the authoritative selected rows', () => {
    const selected = [
      buildKeyword(),
      buildKeyword({
        id: 'keyword-2',
        keyword: 'Second keyword',
      }),
    ];

    const canonical = canonicalContentBriefScope({
      mode: 'keywords',
      keyword_ids: ['stale-keyword'],
    }, [], selected);

    expect(canonical).toStrictEqual({
      mode: 'keywords',
      keyword_ids: ['keyword-1', 'keyword-2'],
    });
  });
});

describe('contentBriefFields', () => {
  it('trims the URL and omits pasted copy in improve-current mode', () => {
    expect(contentBriefFields(
      'improve_current_url',
      '  https://example.com/page  ',
      'hidden copy',
      'template-1',
      'Prompt {scope}',
      'Spanish'
    )).toStrictEqual({
      content_angle: 'improve_current_url',
      landing_url: 'https://example.com/page',
      current_copy: '',
      template_id: 'template-1',
      prompt_template: 'Prompt {scope}',
      output_language: 'Spanish',
    });
  });

  it('omits the URL and preserves copy in rewrite mode', () => {
    expect(contentBriefFields(
      'rewrite_pasted_copy',
      'https://example.com/hidden',
      'Copy with exact whitespace. ',
      'template-1',
      'Prompt {scope}',
      'English'
    )).toStrictEqual({
      content_angle: 'rewrite_pasted_copy',
      landing_url: '',
      current_copy: 'Copy with exact whitespace. ',
      template_id: 'template-1',
      prompt_template: 'Prompt {scope}',
      output_language: 'English',
    });
  });

  it('omits both source fields in create-new mode', () => {
    expect(contentBriefFields(
      'create_new_landing_page',
      'https://example.com/hidden',
      'hidden copy',
      'template-1',
      BRIEF_FIELDS.prompt_template,
      'English'
    )).toStrictEqual(BRIEF_FIELDS);
  });
});

describe('pendingContentBriefGeneration', () => {
  it('builds the exact single-generation envelope for combined strategy', () => {
    const scope = {
      mode: 'keywords',
      keyword_ids: ['keyword-1', 'keyword-2'],
    } satisfies ContentBriefScope;

    expect(pendingContentBriefGeneration(
      'combined',
      'brief-1',
      scope,
      BRIEF_FIELDS,
      2
    )).toStrictEqual({
      strategy: 'combined',
      idea: {
        id: 'brief-1',
        type: 'group_brief',
        scope,
        ...BRIEF_FIELDS,
      },
      selectedKeywordCount: 2,
    });
  });

  it('builds the exact batch envelope for per-keyword strategy', () => {
    const scope = {
      mode: 'groups',
      group_ids: ['group-1'],
    } satisfies ContentBriefScope;

    expect(pendingContentBriefGeneration(
      'per_keyword',
      'batch-1',
      scope,
      BRIEF_FIELDS,
      3
    )).toStrictEqual({
      strategy: 'per_keyword',
      request: {
        batch_id: 'batch-1',
        scope,
        brief: BRIEF_FIELDS,
      },
      selectedKeywordCount: 3,
    });
  });
});


describe('selectedActiveKeywords explicit filtering', () => {
  it('excludes unselected keywords when one explicit keyword ID is selected', () => {
    const selected = buildKeyword();
    const unselected = buildKeyword({
      id: 'keyword-2',
      keyword: 'Unselected keyword',
    });

    expect(selectedActiveKeywords({
      mode: 'keywords',
      keyword_ids: ['keyword-1'],
    }, [selected, unselected])).toStrictEqual([selected]);
  });
});
