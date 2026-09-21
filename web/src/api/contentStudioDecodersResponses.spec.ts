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
  invalidIntegerRepresentations,
  omitDecoderField,
  validContentStatuses,
  validGroupBriefModes,
} from './contentStudioDecoders-fixtures';

const invalidGenerationError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid generation response',
};
const invalidTemplateError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid Content Brief template',
};

describe('Content Studio generation response decoder', () => {
  it.each([null, [], 'generation'])(
    'rejects the generation response when the payload is %j',
    (payload) => {
      expect(() => decodeGenerateContentResponse(payload))
        .toThrow(expect.objectContaining(invalidGenerationError));
    }
  );

  it.each(['success', 'id', 'status', 'keyword'])(
    'rejects the generation response when required field %s is missing',
    (field) => {
      const payload = omitDecoderField(buildGenerationDecoderPayload(), field);

      expect(() => decodeGenerateContentResponse(payload))
        .toThrow(expect.objectContaining(invalidGenerationError));
    }
  );

  it.each([
    ['success', 'true'],
    ['id', 1],
    ['status', 'unknown'],
    ['status', null],
    ['keyword', false],
  ])('rejects the generation response when required field %s is invalid', (field, invalidValue) => {
    expect(() => decodeGenerateContentResponse(buildGenerationDecoderPayload({[field]: invalidValue,}))).toThrow(expect.objectContaining(invalidGenerationError));
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

  it.each(['message', 'error'])(
    'rejects the generation response when optional string %s is null',
    (field) => {
      expect(() => decodeGenerateContentResponse(buildGenerationDecoderPayload({[field]: null,}))).toThrow(expect.objectContaining(invalidGenerationError));
    }
  );

  it.each([null, 'false', 0])(
    'rejects the generation response when idempotent_hit is %j',
    (idempotentHit) => {
      expect(() => decodeGenerateContentResponse(buildGenerationDecoderPayload({idempotent_hit: idempotentHit,}))).toThrow(expect.objectContaining(invalidGenerationError));
    }
  );

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
  it.each([null, [], 'template'])(
    'rejects a Content Brief template when the payload is %j',
    (payload) => {
      expect(() => decodeContentBriefTemplate(payload))
        .toThrow(expect.objectContaining(invalidTemplateError));
    }
  );

  it.each([
    'id',
    'name',
    'description',
    'content_angle',
    'prompt_template',
    'builtin',
    'created_by',
    'created_at',
    'updated_at',
  ])('rejects a Content Brief template when required field %s is missing', (field) => {
    expect(() => decodeContentBriefTemplate(omitDecoderField(
      buildTemplateDecoderRecord(),
      field
    ))).toThrow(expect.objectContaining(invalidTemplateError));
  });

  it.each([
    ['id', 1],
    ['name', null],
    ['description', false],
    ['content_angle', 'unknown'],
    ['prompt_template', []],
    ['builtin', 'true'],
    ['created_by', 1],
    ['created_at', false],
    ['updated_at', {}],
  ])('rejects a Content Brief template when field %s is invalid', (field, invalidValue) => {
    expect(() => decodeContentBriefTemplate(buildTemplateDecoderRecord({[field]: invalidValue,}))).toThrow(expect.objectContaining(invalidTemplateError));
  });

  it.each(validGroupBriefModes)(
    'returns template content angle %s when the enum member is valid',
    (contentAngle) => {
      expect(decodeContentBriefTemplate(buildTemplateDecoderRecord({content_angle: contentAngle,})).content_angle).toBe(contentAngle);
    }
  );

  it.each(['created_by', 'created_at', 'updated_at'])(
    'returns a Content Brief template when nullable field %s is a string',
    (field) => {
      expect(decodeContentBriefTemplate(buildTemplateDecoderRecord({[field]: '2026-01-01T00:00:00Z',}))).toMatchObject({ [field]: '2026-01-01T00:00:00Z' });
    }
  );

  it.each([null, [], 'templates'])(
    'rejects the template list when the payload is %j',
    (payload) => {
      expect(() => decodeTemplateList(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid template list',
      }));
    }
  );

  it.each([undefined, null, {}, 'templates'])(
    'rejects the template list when items is %j',
    (items) => {
      expect(() => decodeTemplateList({
        items,
        count: 0 
      }))
        .toThrow(expect.objectContaining({
          name: 'InvalidContentStudioResponseError',
          message: 'Content Studio API returned an invalid template list',
        }));
    }
  );

  it.each(invalidIntegerRepresentations)(
    'rejects the template list when count is %j',
    (count) => {
      expect(() => decodeTemplateList(buildTemplateListDecoderPayload([], { count })))
        .toThrow(expect.objectContaining({
          name: 'InvalidContentStudioResponseError',
          message: 'Content Studio API returned an invalid template count',
        }));
    }
  );

  it.each([0, 2])(
    'rejects the template list when count %i differs from one item',
    (count) => {
      expect(() => decodeTemplateList(buildTemplateListDecoderPayload(
        [buildTemplateDecoderRecord()],
        { count }
      ))).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid template count',
      }));
    }
  );

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
    [null, 'content-1'],
    [[], 'content-1'],
    [{
      id: 'different',
      status: 'generated' 
    }, 'content-1'],
    [{
      id: 'content-1',
      status: 'unknown' 
    }, 'content-1'],
    [{
      id: 'content-1',
      status: 1 
    }, 'content-1'],
  ])('rejects content status when payload %j does not match ID %s', (payload, requestedId) => {
    expect(() => decodeContentStatus(payload, requestedId))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid content status',
      }));
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
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid viewed response',
      }));
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
    expect(() => decodeDeletedContent(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid delete response',
    }));
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
    expect(() => decodeDeletedTemplate(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid template delete response',
    }));
  });
});
