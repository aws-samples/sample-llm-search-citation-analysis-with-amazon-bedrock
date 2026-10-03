import {
  describe, expect, it
} from 'vitest';
import {
  decodeContentBriefTemplate,
  decodeContentStatus,
  decodeDeletedContent,
  decodeDeletedTemplate,
  decodeGenerateContentResponse,
  decodeTemplateList,
  decodeViewedResponse,
} from './contentStudioDecoders';
import {
  buildGenerationDecoderPayload,
  buildTemplateDecoderRecord,
  buildTemplateListDecoderPayload,
  invalidContentStudioResponse,
  invalidIntegerRepresentations,
  omitDecoderField,
  validContentStatuses,
  validGroupBriefModes,
} from './contentStudioDecoders-fixtures';

type Rejected = [condition: string, payload: unknown];

const rejectedGenerations: Rejected[] = [
  ...[null, [], 'generation'].map((payload): Rejected => [`the payload is ${JSON.stringify(payload)}`, payload]),
  ...['success', 'id', 'status', 'keyword'].map((field): Rejected => [
    `required field ${field} is missing`, omitDecoderField(buildGenerationDecoderPayload(), field),
  ]),
  ...([
    ['success', 'true'],
    ['id', 1],
    ['status', 'unknown'],
    ['status', null],
    ['keyword', false],
    ['message', null],
    ['error', null],
    ['idempotent_hit', null],
    ['idempotent_hit', 'false'],
    ['idempotent_hit', 0],
  ] satisfies Array<[string, unknown]>).map(([field, value]): Rejected => [
    `field ${field} is ${JSON.stringify(value)}`, buildGenerationDecoderPayload({ [field]: value }),
  ]),
];

const rejectedTemplates: Rejected[] = [
  ...[null, [], 'template'].map((payload): Rejected => [`the payload is ${JSON.stringify(payload)}`, payload]),
  ...[
    'id',
    'name',
    'description',
    'content_angle',
    'prompt_template',
    'builtin',
    'created_by',
    'created_at',
    'updated_at',
  ].map((field): Rejected => [
    `required field ${field} is missing`, omitDecoderField(buildTemplateDecoderRecord(), field),
  ]),
  ...([
    ['id', 1],
    ['name', null],
    ['description', false],
    ['content_angle', 'unknown'],
    ['prompt_template', []],
    ['builtin', 'true'],
    ['created_by', 1],
    ['created_at', false],
    ['updated_at', {}],
  ] satisfies Array<[string, unknown]>).map(([field, value]): Rejected => [
    `field ${field} is ${JSON.stringify(value)}`, buildTemplateDecoderRecord({ [field]: value }),
  ]),
];

const rejectedTemplateLists: Array<[condition: string, payload: unknown, subject: string]> = [
  ...[null, [], 'templates'].map((payload): [string, unknown, string] => [
    `the payload is ${JSON.stringify(payload)}`, payload, 'template list',
  ]),
  ...[undefined, null, {}, 'templates'].map((items): [string, unknown, string] => [
    `items is ${JSON.stringify(items)}`,
    {
      items,
      count: 0,
    },
    'template list',
  ]),
  ...invalidIntegerRepresentations.map((count): [string, unknown, string] => [
    `count is ${JSON.stringify(count)}`, buildTemplateListDecoderPayload([], { count }), 'template count',
  ]),
  ...[0, 2].map((count): [string, unknown, string] => [
    `count ${count} differs from one item`,
    buildTemplateListDecoderPayload([buildTemplateDecoderRecord()], { count }),
    'template count',
  ]),
];

describe('Content Studio generation response decoder', () => {
  it.each(rejectedGenerations)('rejects the generation response when %s', (_condition, payload) => {
    expect(() => decodeGenerateContentResponse(payload))
      .toThrow(invalidContentStudioResponse('generation response'));
  });

  it.each(validContentStatuses)(
    'returns generation status %s when the enum member is valid',
    (status) => {
      expect(decodeGenerateContentResponse(buildGenerationDecoderPayload({ status })).status)
        .toBe(status);
    }
  );

  it('returns every optional generation field when each value is valid', () => {
    expect(decodeGenerateContentResponse(buildGenerationDecoderPayload({
      message: 'Generation queued',
      error: '',
      idempotent_hit: false,
    }))).toStrictEqual({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: 'Alpha keyword',
      message: 'Generation queued',
      error: '',
      idempotent_hit: false,
    });
  });

  it('omits optional generation fields when the server omits them', () => {
    expect(decodeGenerateContentResponse(buildGenerationDecoderPayload())).toStrictEqual({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: 'Alpha keyword',
      message: undefined,
      error: undefined,
      idempotent_hit: undefined,
    });
  });
});

describe('Content Studio template decoder', () => {
  it.each(rejectedTemplates)('rejects a Content Brief template when %s', (_condition, payload) => {
    expect(() => decodeContentBriefTemplate(payload))
      .toThrow(invalidContentStudioResponse('Content Brief template'));
  });

  it.each(validGroupBriefModes)(
    'returns template content angle %s when the enum member is valid',
    (contentAngle) => {
      expect(decodeContentBriefTemplate(buildTemplateDecoderRecord({ content_angle: contentAngle })).content_angle)
        .toBe(contentAngle);
    }
  );

  it.each(['created_by', 'created_at', 'updated_at'])(
    'returns a Content Brief template when nullable field %s is a string',
    (field) => {
      expect(decodeContentBriefTemplate(buildTemplateDecoderRecord({ [field]: '2026-01-01T00:00:00Z' })))
        .toMatchObject({ [field]: '2026-01-01T00:00:00Z' });
    }
  );

  it.each(rejectedTemplateLists)('rejects the template list when %s', (_condition, payload, subject) => {
    expect(() => decodeTemplateList(payload)).toThrow(invalidContentStudioResponse(subject));
  });

  it('accepts a Decimal string when the template count is exact', () => {
    const template = buildTemplateDecoderRecord();

    expect(decodeTemplateList(buildTemplateListDecoderPayload(
      [template],
      { count: '01' }
    ))).toStrictEqual([template]);
  });
});

describe('Content Studio acknowledgement decoders', () => {
  it.each(validContentStatuses)(
    'returns content status %s when the status and requested ID match',
    (status) => {
      expect(decodeContentStatus({
        id: 'content-1',
        status
      }, 'content-1')).toBe(status);
    }
  );

  it.each([
    null,
    [],
    {
      id: 'different',
      status: 'generated'
    },
    {
      id: 'content-1',
      status: 'unknown'
    },
    {
      id: 'content-1',
      status: 1
    },
  ])('rejects content status when payload %j does not match ID content-1', (payload) => {
    expect(() => decodeContentStatus(payload, 'content-1'))
      .toThrow(invalidContentStudioResponse('content status'));
  });

  it('returns no value when the viewed acknowledgement matches the requested ID', () => {
    expect(decodeViewedResponse({
      success: true,
      id: 'content-1'
    }, 'content-1'))
      .toBeUndefined();
  });

  it.each([
    null,
    [],
    {
      success: false,
      id: 'content-1'
    },
    {
      success: true,
      id: 'different'
    },
  ])('rejects the viewed acknowledgement when payload is %j', (payload) => {
    expect(() => decodeViewedResponse(payload, 'content-1'))
      .toThrow(invalidContentStudioResponse('viewed response'));
  });

  it('returns no value when generated content deletion succeeds with a message', () => {
    expect(decodeDeletedContent({
      success: true,
      message: 'Content deleted'
    }))
      .toBeUndefined();
  });

  it.each([
    null,
    [],
    {
      success: false,
      message: 'Content deleted'
    },
    { success: true },
    {
      success: true,
      message: 1
    },
  ])('rejects generated content deletion when payload is %j', (payload) => {
    expect(() => decodeDeletedContent(payload)).toThrow(invalidContentStudioResponse('delete response'));
  });

  it('returns no value when the exact template deletion message is received', () => {
    expect(decodeDeletedTemplate({ message: 'Template deleted successfully' }))
      .toBeUndefined();
  });

  it.each([
    null,
    [],
    {},
    { message: 'Template deleted' },
    { message: 1 },
  ])('rejects template deletion when payload is %j', (payload) => {
    expect(() => decodeDeletedTemplate(payload))
      .toThrow(invalidContentStudioResponse('template delete response'));
  });
});
