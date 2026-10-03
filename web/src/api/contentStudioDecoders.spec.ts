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
  completeOptionalIdeaFields,
  invalidContentIdeaCases,
  invalidContentStudioResponse,
  invalidGeneratedContentDecoderCases,
  invalidHistoryItemCases,
  invalidIntegerRepresentations,
  omitDecoderField,
  validContentAngles,
  validContentIdeaTypes,
  validContentPriorities,
} from './contentStudioDecoders-fixtures';

const oneIdea = buildContentIdeaDecoderRecord();
const oneHistoryItem = buildHistoryItemDecoderRecord();

describe('Content Studio idea decoder', () => {
  it.each([
    ['the payload is null', null, 'ideas response'],
    ['the payload is []', [], 'ideas response'],
    ['the payload is "ideas"', 'ideas', 'ideas response'],
    ['the payload is 1', 1, 'ideas response'],
    ...[undefined, null, {}, 'ideas'].map((ideas): [string, unknown, string] => [
      `ideas is ${JSON.stringify(ideas)}`,
      {
        ideas,
        total_count: 0,
        generated_at: '2026-01-01T00:00:00Z',
      },
      'ideas response',
    ]),
    ...[0, 2, -1].map((totalCount): [string, unknown, string] => [
      `total_count is ${totalCount} for one idea`,
      buildIdeasDecoderPayload(oneIdea, { total_count: totalCount }),
      'idea count',
    ]),
    ...[undefined, null, 1].map((generatedAt): [string, unknown, string] => [
      `generated_at is ${JSON.stringify(generatedAt)}`,
      buildIdeasDecoderPayload(oneIdea, { generated_at: generatedAt }),
      'generation timestamp',
    ]),
  ])('rejects the ideas response when %s', (_condition, payload, subject) => {
    expect(() => decodeContentIdeasResponse(payload)).toThrow(invalidContentStudioResponse(subject));
  });

  it.each(invalidContentIdeaCases)('rejects a content idea when %s', (_condition, idea) => {
    expect(() => decodeContentIdeasResponse(buildIdeasDecoderPayload(idea)))
      .toThrow(invalidContentStudioResponse('content idea'));
  });

  it.each([
    ...validContentIdeaTypes.map((value): [string, string | null] => ['type', value]),
    ...validContentPriorities.map((value): [string, string | null] => ['priority', value]),
    ...validContentAngles.map((value): [string, string | null] => ['content_angle', value]),
    ['keyword', null],
  ] satisfies Array<[string, string | null]>)('returns idea %s %s when the value is valid', (field, value) => {
    const idea = buildContentIdeaDecoderRecord({ [field]: value });

    expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]).toHaveProperty(field, value);
  });

  it('returns every optional idea field when each value is valid', () => {
    const idea = buildContentIdeaDecoderRecord(completeOptionalIdeaFields);

    expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]).toStrictEqual(idea);
  });

  it.each(Object.keys(completeOptionalIdeaFields))(
    'returns a content idea when optional field %s is omitted',
    (field) => {
      const idea = omitDecoderField(buildContentIdeaDecoderRecord(completeOptionalIdeaFields), field);

      expect(decodeContentIdeasResponse(buildIdeasDecoderPayload(idea))[0]).toStrictEqual(idea);
    }
  );
});

describe('Content Studio history decoder', () => {
  it.each([
    ['the payload is null', null, 'history response'],
    ['the payload is []', [], 'history response'],
    ['the payload is "history"', 'history', 'history response'],
    ...[undefined, null, {}, 'history'].map((history): [string, unknown, string] => [
      `history is ${JSON.stringify(history)}`,
      {
        history,
        total_count: 0,
        unviewed_count: 0,
      },
      'history response',
    ]),
    ...invalidIntegerRepresentations.map((count): [string, unknown, string] => [
      `total_count is ${JSON.stringify(count)}`,
      buildHistoryDecoderPayload(oneHistoryItem, { total_count: count }),
      'history count',
    ]),
    ...invalidIntegerRepresentations.map((count): [string, unknown, string] => [
      `unviewed_count is ${JSON.stringify(count)}`,
      buildHistoryDecoderPayload(oneHistoryItem, { unviewed_count: count }),
      'unviewed count',
    ]),
  ])('rejects the history response when %s', (_condition, payload, subject) => {
    expect(() => decodeContentHistoryResponse(payload)).toThrow(invalidContentStudioResponse(subject));
  });

  it.each(invalidHistoryItemCases)('rejects a history item when %s', (_condition, historyItem) => {
    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(invalidContentStudioResponse('history item'));
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

  it.each(invalidGeneratedContentDecoderCases)(
    '$testName',
    ({ generatedContent }) => {
      const historyItem = buildHistoryItemWithGeneratedContent(generatedContent);

      expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
        .toThrow(invalidContentStudioResponse('generated content'));
    }
  );

  it.each([
    ['competitor_sources_used', 'competitor source count'],
    ['batch_size', 'history batch size'],
    ['batch_position', 'history batch position'],
  ])('rejects a history item when numeric field %s is negative', (field, subject) => {
    const historyItem = buildHistoryItemDecoderRecord({ [field]: -1 });

    expect(() => decodeContentHistoryResponse(buildHistoryDecoderPayload(historyItem)))
      .toThrow(invalidContentStudioResponse(subject));
  });

  it.each([
    0,
    '0',
    '001',
    Number.MAX_SAFE_INTEGER,
    String(Number.MAX_SAFE_INTEGER),
  ])('accepts total_count %j when its integer representation is valid', (totalCount) => {
    const decoded = decodeContentHistoryResponse(buildHistoryDecoderPayload(
      oneHistoryItem,
      { total_count: totalCount }
    ));

    expect(decoded.history).toHaveLength(1);
  });
});
