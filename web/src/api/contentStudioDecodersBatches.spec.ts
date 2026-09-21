import {
  describe, expect, it
} from 'vitest';
import { decodeBatchStartResponse } from './contentStudioDecoders';
import {
  buildBatchStartChildDecoderRecord,
  buildBatchStartDecoderPayload,
  buildReversedBatchStartDecoderPayload,
  buildSingleBatchStartDecoderPayload,
  invalidBatchPositionDecoderCases,
  invalidIntegerRepresentations,
  omitDecoderField,
  requiredBatchStartChildFields,
  validContentStatuses,
} from './contentStudioDecodersBatch-fixtures';

const invalidBatchChildError = {
  name: 'InvalidContentStudioResponseError',
  message: 'Content Studio API returned an invalid batch child',
};

describe('Content Studio batch start decoder', () => {
  it.each([null, [], 'batch'])(
    'rejects the batch start response when payload is %j',
    (payload) => {
      expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch response',
      }));
    }
  );

  it.each(['success', 'batch_id', 'children'])(
    'rejects the batch start response when required field %s is missing',
    (field) => {
      const payload = omitDecoderField(buildBatchStartDecoderPayload(), field);

      expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch response',
      }));
    }
  );

  it.each([
    ['success', 'true'],
    ['batch_id', 1],
    ['children', {}],
    ['error', null],
    ['error', 1],
  ])('rejects the batch start response when field %s is invalid', (field, invalidValue) => {
    const payload = buildBatchStartDecoderPayload({ [field]: invalidValue });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch response',
    }));
  });

  it('rejects the batch start response when its ID differs from the requested ID', () => {
    expect(() => decodeBatchStartResponse(
      buildBatchStartDecoderPayload(),
      'different-batch'
    )).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch response',
    }));
  });

  it.each(requiredBatchStartChildFields)(
    'rejects a batch start child when required field %s is missing',
    (field) => {
      const child = omitDecoderField(buildBatchStartChildDecoderRecord(), field);

      expect(() => decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child)))
        .toThrow(expect.objectContaining(invalidBatchChildError));
    }
  );

  it.each([
    ['id', 1],
    ['idea_id', null],
    ['keyword_id', false],
    ['keyword', []],
    ['status', 'unknown'],
    ['status', 'missing'],
    ['status', 1],
    ['idempotent_hit', 'false'],
  ])('rejects a batch start child when field %s is invalid', (field, invalidValue) => {
    const child = buildBatchStartChildDecoderRecord({ [field]: invalidValue });

    expect(() => decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child)))
      .toThrow(expect.objectContaining(invalidBatchChildError));
  });

  it.each(validContentStatuses)(
    'returns batch start child status %s when the status is durable',
    (status) => {
      const child = buildBatchStartChildDecoderRecord({ status });
      const decoded = decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child));

      expect(decoded.children[0]?.status).toBe(status);
    }
  );

  it('normalizes batch start Decimal strings and preserves an optional error', () => {
    const child = buildBatchStartChildDecoderRecord({
      batch_position: '01',
      idempotent_hit: true,
    });
    const decoded = decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child, {
      success: true,
      batch_size: '01',
      accepted_count: '00',
      existing_count: '01',
      failed_count: '00',
      error: 'Batch already existed',
    }));

    expect(decoded).toStrictEqual({
      success: true,
      batch_id: 'batch/id',
      batch_size: 1,
      accepted_count: 0,
      existing_count: 1,
      failed_count: 0,
      children: [{
        ...child,
        batch_position: 1,
      }],
      error: 'Batch already existed',
    });
  });

  it.each([
    ['batch_size', 'batch size'],
    ['accepted_count', 'accepted count'],
    ['existing_count', 'existing count'],
    ['failed_count', 'failed count'],
  ])('rejects the batch start response when numeric field %s is negative', (field, errorField) => {
    const payload = buildBatchStartDecoderPayload({ [field]: -1 });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: `Content Studio API returned an invalid ${errorField}`,
    }));
  });

  it.each(invalidIntegerRepresentations)(
    'rejects the batch start response when batch_size is %j',
    (batchSize) => {
      const payload = buildBatchStartDecoderPayload({ batch_size: batchSize });

      expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch size',
      }));
    }
  );

  it.each(invalidBatchPositionDecoderCases)('$testName', ({ child }) => {
    expect(() => decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child)))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch position',
      }));
  });

  it('rejects the batch start response when child count differs from batch size', () => {
    const payload = buildBatchStartDecoderPayload({
      accepted_count: 3,
      batch_size: 3,
    });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch size',
    }));
  });

  it('rejects the batch start response when children are outside manifest order', () => {
    expect(() => decodeBatchStartResponse(buildReversedBatchStartDecoderPayload()))
      .toThrow(expect.objectContaining({
        name: 'InvalidContentStudioResponseError',
        message: 'Content Studio API returned an invalid batch position',
      }));
  });

  it('rejects accepted_count when it contradicts child idempotency', () => {
    const payload = buildBatchStartDecoderPayload({ accepted_count: 0 });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid accepted count',
    }));
  });

  it('rejects existing_count when it contradicts child idempotency', () => {
    const payload = buildBatchStartDecoderPayload({
      existing_count: 1,
      accepted_count: 1,
    });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid existing count',
    }));
  });

  it('rejects an existing child counted as newly accepted', () => {
    const children = [
      buildBatchStartChildDecoderRecord({ idempotent_hit: true }),
      buildBatchStartChildDecoderRecord({
        id: 'content-2',
        idea_id: 'idea-2',
        keyword_id: 'keyword-2',
        keyword: 'Beta keyword',
        batch_position: 2,
        idempotent_hit: false,
      }),
    ];
    const payload = buildBatchStartDecoderPayload({ children });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid existing count',
    }));
  });

  it('rejects immediate dispatch failures in a batch start response', () => {
    const payload = buildBatchStartDecoderPayload({
      accepted_count: 1,
      failed_count: 1,
    });

    expect(() => decodeBatchStartResponse(payload)).toThrow(expect.objectContaining({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid failed count',
    }));
  });
});
