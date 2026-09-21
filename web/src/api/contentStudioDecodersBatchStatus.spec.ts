import {
  describe, expect, it
} from 'vitest';
import { decodeBatchStatusResponse } from './contentStudioDecoders';
import {
  buildAllStatusBatchDecoderPayload,
  buildBatchStatusChildDecoderRecord,
  buildBatchStatusCounts,
  buildBatchStatusDecoderPayload,
  buildMissingBatchStatusDecoderPayload,
  buildReversedBatchStatusDecoderPayload,
  buildSingleBatchStatusDecoderPayload,
  invalidBatchStatusMetadataDecoderCases,
  omitDecoderField,
  requiredBatchStatusChildFields,
  validContentBriefBatchStatuses,
} from './contentStudioDecodersBatch-fixtures';

const invalidBatchStatusChildError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid batch status child',
};

const invalidBatchStatusChildCases = [
  {
    testName: 'rejects a batch status child when id is numeric',
    field: 'id',
    invalidValue: 1,
  },
  {
    testName: 'rejects a batch status child when idea_id is null',
    field: 'idea_id',
    invalidValue: null,
  },
  {
    testName: 'rejects a batch status child when keyword_id is boolean',
    field: 'keyword_id',
    invalidValue: false,
  },
  {
    testName: 'rejects a batch status child when keyword is an array',
    field: 'keyword',
    invalidValue: [],
  },
  {
    testName: 'rejects a batch status child when status is unknown',
    field: 'status',
    invalidValue: 'unknown',
  },
  {
    testName: 'rejects a batch status child when has_content is a string',
    field: 'has_content',
    invalidValue: 'true',
  },
];

describe('Content Studio batch status decoder', () => {
  it.each([null, [], 'batch status'])(
    'rejects the batch status response when payload is %j',
    (payload) => {
      expect(() => decodeBatchStatusResponse(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch status response',
      }));
    }
  );

  it.each(['batch_id', 'children'])(
    'rejects the batch status response when required field %s is missing',
    (field) => {
      const payload = omitDecoderField(buildBatchStatusDecoderPayload(), field);

      expect(() => decodeBatchStatusResponse(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch status response',
      }));
    }
  );

  it.each([
    ['batch_id', 1],
    ['children', {}],
  ])('rejects the batch status response when field %s is invalid', (field, invalidValue) => {
    const payload = buildBatchStatusDecoderPayload({ [field]: invalidValue });

    expect(() => decodeBatchStatusResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch status response',
    }));
  });

  it('rejects the batch status response when its ID differs from the requested ID', () => {
    expect(() => decodeBatchStatusResponse(
      buildBatchStatusDecoderPayload(),
      'different-batch'
    )).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch status response',
    }));
  });

  it.each(requiredBatchStatusChildFields)(
    'rejects a batch status child when required field %s is missing',
    (field) => {
      const child = omitDecoderField(buildBatchStatusChildDecoderRecord(), field);
      const decodeMissingChild = () => decodeBatchStatusResponse(
        buildSingleBatchStatusDecoderPayload(child)
      );

      expect(decodeMissingChild).toThrow(
        'Content Studio API returned an invalid batch status child'
      );
    }
  );

  it.each(invalidBatchStatusMetadataDecoderCases)('$testName', ({
    child, errorField
  }) => {
    expect(() => decodeBatchStatusResponse(buildSingleBatchStatusDecoderPayload(child)))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: `Content Studio API returned an invalid ${errorField}`,
      }));
  });

  it.each(invalidBatchStatusChildCases)('$testName', ({
    field,
    invalidValue,
  }) => {
    const child = buildBatchStatusChildDecoderRecord({ [field]: invalidValue });

    expect(() => decodeBatchStatusResponse(buildSingleBatchStatusDecoderPayload(child)))
      .toThrow(expect.objectContaining(invalidBatchStatusChildError));
  });

  it.each(['created_at', 'updated_at', 'error_message'])(
    'returns a batch status child when nullable field %s is null',
    (field) => {
      const child = buildBatchStatusChildDecoderRecord({ [field]: null });
      const decoded = decodeBatchStatusResponse(buildSingleBatchStatusDecoderPayload(child));

      expect(decoded.children[0]).toMatchObject({ [field]: null });
    }
  );

  it('returns a missing tombstone with no content and a safe error', () => {
    const decoded = decodeBatchStatusResponse(buildMissingBatchStatusDecoderPayload());

    expect(decoded.children[0]).toStrictEqual(expect.objectContaining({
      status: 'missing',
      has_content: false,
      error_message: 'Content is no longer available',
    }));
    expect(decoded.counts.missing).toBe(1);
  });

  it.each([
    ['rejects a missing tombstone when it claims generated content', { has_content: true }],
    ['rejects a missing tombstone when its safe error is absent', { error_message: null }],
    ['rejects a missing tombstone when its safe error is empty', { error_message: '   ' }],
  ])('%s', (_testName, overrides) => {
    expect(() => decodeBatchStatusResponse(buildMissingBatchStatusDecoderPayload(overrides)))
      .toThrow(expect.objectContaining(invalidBatchStatusChildError));
  });

  it.each([undefined, null, [], 'counts'])(
    'rejects batch status when counts is %j',
    (counts) => {
      expect(() => decodeBatchStatusResponse(buildBatchStatusDecoderPayload({ counts })))
        .toThrow(expect.objectContaining({
          name: 'InvalidContentStudioResponseError',
          message: 'Content Studio API returned an invalid batch counts',
        }));
    }
  );

  it.each([
    ['pending', 'pending count'],
    ['generating', 'generating count'],
    ['generated', 'generated count'],
    ['failed', 'failed count'],
    ['missing', 'missing count'],
    ['total', 'batch total'],
  ])('rejects batch status when count field %s is negative', (field, errorField) => {
    const counts = buildBatchStatusCounts({ [field]: -1 });

    expect(() => decodeBatchStatusResponse(buildBatchStatusDecoderPayload({ counts })))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: `Content Studio API returned an invalid ${errorField}`,
      }));
  });

  it('normalizes every batch status Decimal string', () => {
    const firstChild = buildBatchStatusChildDecoderRecord({ batch_position: '01' });
    const secondChild = buildBatchStatusChildDecoderRecord({
      id: 'content-2',
      idea_id: 'idea-2',
      keyword_id: 'keyword-2',
      keyword: 'Beta keyword',
      status: 'failed',
      batch_position: '02',
      has_content: false,
      error_message: 'Generation failed',
    });
    const decoded = decodeBatchStatusResponse(buildBatchStatusDecoderPayload({
      batch_size: '02',
      children: [firstChild, secondChild],
      counts: {
        pending: '00',
        generating: '00',
        generated: '01',
        failed: '01',
        missing: '00',
        total: '02',
      },
    }));

    expect(decoded.batch_size).toBe(2);
    expect(decoded.children.map((child) => child.batch_position)).toStrictEqual([1, 2]);
    expect(decoded.counts).toStrictEqual({
      pending: 0,
      generating: 0,
      generated: 1,
      failed: 1,
      missing: 0,
      total: 2,
    });
  });

  it('returns exact counts when every batch child status is present', () => {
    const decoded = decodeBatchStatusResponse(buildAllStatusBatchDecoderPayload());

    expect(decoded.counts).toStrictEqual({
      pending: 1,
      generating: 1,
      generated: 1,
      failed: 1,
      missing: 1,
      total: 5,
    });
    expect(decoded.children.map((child) => child.status)).toStrictEqual(
      validContentBriefBatchStatuses
    );
  });

  it.each([
    [
      'rejects batch status when child count differs from batch size',
      {
        batch_size: 3,
        counts: buildBatchStatusCounts({ total: 3 }),
      },
      'batch size',
    ],
    [
      'rejects batch status when total differs from batch size',
      { counts: buildBatchStatusCounts({ total: 3 }) },
      'batch total',
    ],
  ])('%s', (_testName, overrides, errorField) => {
    expect(() => decodeBatchStatusResponse(buildBatchStatusDecoderPayload(overrides)))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: `Content Studio API returned an invalid ${errorField}`,
      }));
  });

  it('rejects batch status when children are outside manifest order', () => {
    expect(() => decodeBatchStatusResponse(buildReversedBatchStatusDecoderPayload()))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch position',
      }));
  });

  it.each([
    ['pending', buildBatchStatusCounts({ pending: 1 })],
    ['generating', buildBatchStatusCounts({ generating: 1 })],
    ['generated', buildBatchStatusCounts({ generated: 0 })],
    ['failed', buildBatchStatusCounts({ failed: 0 })],
    ['missing', buildBatchStatusCounts({ missing: 1 })],
  ])('rejects batch status when %s count differs from child statuses', (field, counts) => {
    expect(() => decodeBatchStatusResponse(buildBatchStatusDecoderPayload({ counts })))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: `Content Studio API returned an invalid ${field} count`,
      }));
  });

  it('rejects the batch status response when batch_size is negative', () => {
    const payload = buildBatchStatusDecoderPayload({ batch_size: -1 });

    expect(() => decodeBatchStatusResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch size',
    }));
  });
});
