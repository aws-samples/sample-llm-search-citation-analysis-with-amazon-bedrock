import {
  describe, expect, it
} from 'vitest';
import {
  decodeContentHistoryResponse,
  decodeContentIdeasResponse,
} from './contentStudioDecoders';
import {
  buildContentIdeaDecoderRecord,
  buildGeneratedContentDecoderRecord,
  buildHistoryDecoderPayload,
  buildHistoryItemDecoderRecord,
  buildHistoryItemWithGeneratedContent,
  buildIdeasDecoderPayload,
  invalidGeneratedContentDecoderCases,
  invalidIntegerRepresentations,
  omitDecoderField,
  validContentAngles,
  validContentIdeaTypes,
  validContentPriorities,
} from './contentStudioDecoders-fixtures';

const invalidContentIdeaError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid content idea',
};
const invalidHistoryItemError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid history item',
};
const invalidGeneratedContentError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid generated content',
};

describe('Content Studio idea decoder', () => {
  it.each([
    null,
    [],
    'ideas',
    1,
  ])('rejects the ideas response when the payload is %j', (payload) => {
    expect(() => decodeContentIdeasResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid ideas response',
    }));
  });

  it.each([
    undefined,
    null,
    {},
    'ideas',
  ])('rejects the ideas response when ideas is %j', (ideas) => {
    expect(() => decodeContentIdeasResponse({
      ideas,
      total_count: 0,
      generated_at: '2026-01-01T00:00:00Z',
    })).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid ideas response',
    }));
  });

  it.each([
    'id',
    'type',
    'priority',
    'title',
    'description',
    'keyword',
    'source',
    'actionable',
  ])('rejects a content idea when required field %s is missing', (field) => {
    const idea = omitDecoderField(buildContentIdeaDecoderRecord(), field);

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each([
    ['id', 1],
    ['title', null],
    ['description', false],
    ['keyword', 1],
    ['source', []],
    ['actionable', 'true'],
    ['type', 'unknown_type'],
    ['type', 1],
    ['priority', 'urgent'],
    ['priority', null],
    ['content_angle', 'unknown_angle'],
    ['content_angle', 1],
  ])('rejects a content idea when field %s is invalid', (field, invalidValue) => {
    const idea = buildContentIdeaDecoderRecord({ [field]: invalidValue });

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each(validContentIdeaTypes)(
    'returns idea type %s when the enum member is valid',
    (type) => {
      const idea = buildContentIdeaDecoderRecord({ type });

      expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]?.type).toBe(type);
    }
  );

  it.each(validContentPriorities)(
    'returns priority %s when the enum member is valid',
    (priority) => {
      const idea = buildContentIdeaDecoderRecord({ priority });

      expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]?.priority)
        .toBe(priority);
    }
  );

  it.each(validContentAngles)(
    'returns content angle %s when the enum member is valid',
    (contentAngle) => {
      const idea = buildContentIdeaDecoderRecord({ content_angle: contentAngle });

      expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]?.content_angle)
        .toBe(contentAngle);
    }
  );

  it('returns a content idea when its required keyword is null', () => {
    const idea = buildContentIdeaDecoderRecord({ keyword: null });

    expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]?.keyword).toBeNull();
  });

  it('returns every optional idea field when each value is valid', () => {
    const idea = buildContentIdeaDecoderRecord({
      competitor_brands: ['Competitor'],
      competitor_urls: ['https://competitor.example'],
      providers_missing: ['openai'],
      providers_present: ['perplexity'],
      current_rank: 2.5,
      content_angle: 'differentiation',
      persona_name: 'Buyer',
      seasonal_theme: 'Summer',
      trending_topic: 'Launch',
      output_language: 'Spanish',
    });

    expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]).toStrictEqual(idea);
  });

  it.each([
    'competitor_brands',
    'competitor_urls',
    'providers_missing',
    'providers_present',
  ])('rejects a content idea when optional array %s is not an array', (field) => {
    const idea = buildContentIdeaDecoderRecord({ [field]: 'provider' });

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each([
    'competitor_brands',
    'competitor_urls',
    'providers_missing',
    'providers_present',
  ])('rejects a content idea when optional array %s contains a non-string', (field) => {
    const idea = buildContentIdeaDecoderRecord({ [field]: ['valid', 1] });

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each([
    'persona_name',
    'seasonal_theme',
    'trending_topic',
    'output_language',
  ])('rejects a content idea when optional string %s is null', (field) => {
    const idea = buildContentIdeaDecoderRecord({ [field]: null });

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each([
    { currentRank: null },
    { currentRank: 'first' },
    { currentRank: Number.NaN },
  ])('rejects a content idea when optional current_rank is $currentRank', ({ currentRank }) => {
    const idea = buildContentIdeaDecoderRecord({ current_rank: currentRank });

    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(expect.objectContaining(invalidContentIdeaError));
  });

  it.each([0, 2])(
    'rejects the ideas response when total_count is %i for one idea',
    (totalCount) => {
      expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(
        buildContentIdeaDecoderRecord(),
        { total_count: totalCount }
      ))).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid idea count',
      }));
    }
  );

  it.each([undefined, null, 1])(
    'rejects the ideas response when generated_at is %j',
    (generatedAt) => {
      expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(
        buildContentIdeaDecoderRecord(),
        { generated_at: generatedAt }
      ))).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid generation timestamp',
      }));
    }
  );
});

describe('Content Studio history decoder', () => {
  it.each([
    null,
    [],
    'history',
  ])('rejects the history response when the payload is %j', (payload) => {
    expect(() => decodeContentHistoryResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid history response',
    }));
  });

  it.each([undefined, null, {}, 'history'])(
    'rejects the history response when history is %j',
    (history) => {
      expect(() => decodeContentHistoryResponse({
        history,
        total_count: 0,
        unviewed_count: 0,
      })).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid history response',
      }));
    }
  );

  it.each([
    'id',
    'keyword',
    'status',
    'created_at',
    'updated_at',
  ])('rejects a history item when required field %s is missing', (field) => {
    const historyItem = omitDecoderField(buildHistoryItemDecoderRecord(), field);

    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(expect.objectContaining(invalidHistoryItemError));
  });

  it.each([
    ['id', 1],
    ['keyword', null],
    ['status', 'unknown'],
    ['created_at', 1],
    ['updated_at', false],
  ])('rejects a history item when required field %s is invalid', (field, invalidValue) => {
    const historyItem = buildHistoryItemDecoderRecord({ [field]: invalidValue });

    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(expect.objectContaining(invalidHistoryItemError));
  });

  it('supplies every legacy default when optional history fields are missing', () => {
    const historyItem = {
      id: 'legacy',
      keyword: 'Legacy keyword',
      status: 'generated',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
    };

    expect(decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)).history[0])
      .toStrictEqual({
        id: 'legacy',
        keyword: 'Legacy keyword',
        idea_title: 'Legacy keyword',
        content_angle: '',
        competitor_sources_used: 0,
        status: 'generated',
        viewed: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:01:00Z',
        generated_content: undefined,
        content_warning: undefined,
        error_message: undefined,
        batch_id: undefined,
        batch_size: undefined,
        batch_position: undefined,
        keyword_id: undefined,
      });
  });

  it('returns every optional history field when each value is valid', () => {
    const generatedContent = buildGeneratedContentDecoderRecord();
    const historyItem = buildHistoryItemDecoderRecord({
      idea_title: 'Saved idea',
      content_angle: 'create_new_landing_page',
      competitor_sources_used: '007',
      viewed: true,
      generated_content: generatedContent,
      content_warning: {
        code: 'incomplete_metadata',
        message: 'This draft is usable, but some generated metadata is incomplete.',
        missing_fields: ['title', 'meta_description'],
      },
      error_message: 'Generation failed',
      batch_id: 'batch-1',
      batch_size: '02',
      batch_position: '01',
      keyword_id: 'keyword-1',
    });

    expect(decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)).history[0])
      .toStrictEqual({
        ...historyItem,
        competitor_sources_used: 7,
        batch_size: 2,
        batch_position: 1,
      });
  });

  it('drops a malformed content warning instead of rejecting the history item', () => {
    const historyItem = buildHistoryItemDecoderRecord({ content_warning: { code: 'truncated' } });

    expect(decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)).history[0]?.content_warning)
      .toBeUndefined();
  });

  it.each([
    'idea_title',
    'content_angle',
    'error_message',
    'batch_id',
    'keyword_id',
  ])('rejects a history item when optional string %s is null', (field) => {
    const historyItem = buildHistoryItemDecoderRecord({ [field]: null });

    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(expect.objectContaining(invalidHistoryItemError));
  });

  it.each([null, 'true', 1])(
    'rejects a history item when optional viewed is %j',
    (viewed) => {
      const historyItem = buildHistoryItemDecoderRecord({ viewed });

      expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
        .toThrow(expect.objectContaining(invalidHistoryItemError));
    }
  );

  it.each(invalidGeneratedContentDecoderCases)(
    '$testName',
    ({ generatedContent }) => {
      const historyItem = buildHistoryItemWithGeneratedContent(generatedContent);

      expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
        .toThrow(expect.objectContaining(invalidGeneratedContentError));
    }
  );

  it.each([
    ['competitor_sources_used', 'competitor source count'],
    ['batch_size', 'history batch size'],
    ['batch_position', 'history batch position'],
  ])('rejects a history item when numeric field %s is negative', (field, errorField) => {
    const historyItem = buildHistoryItemDecoderRecord({ [field]: -1 });

    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: `Content Studio API returned an invalid ${errorField}`,
      }));
  });

  it.each(invalidIntegerRepresentations)(
    'rejects the history response when total_count is %j',
    (totalCount) => {
      expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(
        buildHistoryItemDecoderRecord(),
        { total_count: totalCount }
      ))).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid history count',
      }));
    }
  );

  it.each(invalidIntegerRepresentations)(
    'rejects the history response when unviewed_count is %j',
    (unviewedCount) => {
      expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(
        buildHistoryItemDecoderRecord(),
        { unviewed_count: unviewedCount }
      ))).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid unviewed count',
      }));
    }
  );

  it.each([
    0,
    '0',
    '001',
    Number.MAX_SAFE_INTEGER,
    String(Number.MAX_SAFE_INTEGER),
  ])('accepts total_count %j when its integer representation is valid', (totalCount) => {
    const decoded = decodeContentHistoryResponse(buildHistoryDecoderPayload(
      buildHistoryItemDecoderRecord(),
      { total_count: totalCount }
    ));

    expect(decoded.history).toHaveLength(1);
  });
});

describe('Content Studio idea optional-field omissions', () => {
  it.each([
    'competitor_brands',
    'competitor_urls',
    'providers_missing',
    'providers_present',
    'current_rank',
    'content_angle',
    'persona_name',
    'seasonal_theme',
    'trending_topic',
    'output_language',
  ])('returns a content idea when optional field %s is omitted', (field) => {
    const completeIdea = buildContentIdeaDecoderRecord({
      competitor_brands: ['Competitor'],
      competitor_urls: ['https://competitor.example'],
      providers_missing: ['openai'],
      providers_present: ['perplexity'],
      current_rank: 1,
      content_angle: 'differentiation',
      persona_name: 'Buyer',
      seasonal_theme: 'Summer',
      trending_topic: 'Launch',
      output_language: 'Spanish',
    });
    const idea = omitDecoderField(completeIdea, field);

    expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]).toStrictEqual(idea);
  });

  it('rejects the ideas response when total_count is a negative integer', () => {
    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(
      buildContentIdeaDecoderRecord(),
      { total_count: -1 }
    ))).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid idea count',
    }));
  });
});
