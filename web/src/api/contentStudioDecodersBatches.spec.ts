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
  invalidContentStudioResponse,
  invalidIntegerRepresentations,
  omitDecoderField,
  requiredBatchStartChildFields,
  validContentStatuses,
} from './contentStudioDecodersBatch-fixtures';

type RejectedStart = [condition: string, payload: unknown, subject: string];

const existingAndNewChildren = [
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

const rejectedStartResponses: RejectedStart[] = [
  ...[null, [], 'batch'].map((payload): RejectedStart => [
    `payload is ${JSON.stringify(payload)}`, payload, 'batch response',
  ]),
  ...['success', 'batch_id', 'children'].map((field): RejectedStart => [
    `required field ${field} is missing`, omitDecoderField(buildBatchStartDecoderPayload(), field), 'batch response',
  ]),
  ...([
    ['success', 'true'],
    ['batch_id', 1],
    ['children', {}],
    ['error', null],
    ['error', 1],
  ] satisfies Array<[string, unknown]>).map(([field, value]): RejectedStart => [
    `field ${field} is ${JSON.stringify(value)}`, buildBatchStartDecoderPayload({ [field]: value }), 'batch response',
  ]),
  ...([
    ['batch_size', 'batch size'],
    ['accepted_count', 'accepted count'],
    ['existing_count', 'existing count'],
    ['failed_count', 'failed count'],
  ] satisfies Array<[string, string]>).map(([field, subject]): RejectedStart => [
    `numeric field ${field} is negative`, buildBatchStartDecoderPayload({ [field]: -1 }), subject,
  ]),
  ...invalidIntegerRepresentations.map((batchSize): RejectedStart => [
    `batch_size is ${JSON.stringify(batchSize)}`, buildBatchStartDecoderPayload({ batch_size: batchSize }), 'batch size',
  ]),
  [
    'child count differs from batch size',
    buildBatchStartDecoderPayload({
      accepted_count: 3,
      batch_size: 3,
    }),
    'batch size',
  ],
  ['children are outside manifest order', buildReversedBatchStartDecoderPayload(), 'batch position'],
  ['accepted_count contradicts child idempotency', buildBatchStartDecoderPayload({ accepted_count: 0 }), 'accepted count'],
  [
    'existing_count contradicts child idempotency',
    buildBatchStartDecoderPayload({
      existing_count: 1,
      accepted_count: 1,
    }),
    'existing count',
  ],
  [
    'an existing child is counted as newly accepted',
    buildBatchStartDecoderPayload({ children: existingAndNewChildren }),
    'existing count',
  ],
  [
    'it reports immediate dispatch failures',
    buildBatchStartDecoderPayload({
      accepted_count: 1,
      failed_count: 1,
    }),
    'failed count',
  ],
];

describe('Content Studio batch start decoder', () => {
  it.each(rejectedStartResponses)('rejects the batch start response when %s', (_condition, payload, subject) => {
    expect(() => decodeBatchStartResponse(payload)).toThrow(invalidContentStudioResponse(subject));
  });

  it('rejects the batch start response when its ID differs from the requested ID', () => {
    expect(() => decodeBatchStartResponse(buildBatchStartDecoderPayload(), 'different-batch'))
      .toThrow(invalidContentStudioResponse('batch response'));
  });

  it.each([
    ...requiredBatchStartChildFields.map((field): [string, Record<string, unknown>] => [
      `required field ${field} is missing`, omitDecoderField(buildBatchStartChildDecoderRecord(), field),
    ]),
    ...([
      ['id', 1],
      ['idea_id', null],
      ['keyword_id', false],
      ['keyword', []],
      ['status', 'unknown'],
      ['status', 'missing'],
      ['status', 1],
      ['idempotent_hit', 'false'],
    ] satisfies Array<[string, unknown]>).map(([field, value]): [string, Record<string, unknown>] => [
      `field ${field} is ${JSON.stringify(value)}`, buildBatchStartChildDecoderRecord({ [field]: value }),
    ]),
  ])('rejects a batch start child when %s', (_condition, child) => {
    expect(() => decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child)))
      .toThrow(invalidContentStudioResponse('batch child'));
  });

  it.each(invalidBatchPositionDecoderCases)('$testName', ({ child }) => {
    expect(() => decodeBatchStartResponse(buildSingleBatchStartDecoderPayload(child)))
      .toThrow(invalidContentStudioResponse('batch position'));
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
});
