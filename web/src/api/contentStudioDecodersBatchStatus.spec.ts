import {
  describe, expect, it
} from 'vitest';
import { decodeBatchStatusResponse } from './contentStudioDecoders';
import { apiBatchStatusResponse } from './contentStudio-fixtures';
import {
  buildAllStatusBatchDecoderPayload,
  buildBatchStatusChildDecoderRecord,
  buildBatchStatusCounts,
  buildBatchStatusDecoderPayload,
  buildMissingBatchStatusDecoderPayload,
  buildReversedBatchStatusDecoderPayload,
  buildSingleBatchStatusDecoderPayload,
  invalidBatchStatusMetadataDecoderCases,
  invalidContentStudioResponse,
  omitDecoderField,
  requiredBatchStatusChildFields,
  validContentBriefBatchStatuses,
} from './contentStudioDecodersBatch-fixtures';

type RejectedStatus = [condition: string, payload: unknown, subject: string];

const rejectedStatusResponses: RejectedStatus[] = [
  ...[null, [], 'batch status'].map((payload): RejectedStatus => [
    `payload is ${JSON.stringify(payload)}`, payload, 'batch status response',
  ]),
  ...['batch_id', 'children'].map((field): RejectedStatus => [
    `required field ${field} is missing`,
    omitDecoderField(buildBatchStatusDecoderPayload(), field),
    'batch status response',
  ]),
  ...([
    ['batch_id', 1],
    ['children', {}],
  ] satisfies Array<[string, unknown]>).map(([field, value]): RejectedStatus => [
    `field ${field} is ${JSON.stringify(value)}`,
    buildBatchStatusDecoderPayload({ [field]: value }),
    'batch status response',
  ]),
  ...[undefined, null, [], 'counts'].map((counts): RejectedStatus => [
    `counts is ${JSON.stringify(counts)}`, buildBatchStatusDecoderPayload({ counts }), 'batch counts',
  ]),
  ...([
    ['pending', 'pending count'],
    ['generating', 'generating count'],
    ['generated', 'generated count'],
    ['failed', 'failed count'],
    ['missing', 'missing count'],
    ['total', 'batch total'],
  ] satisfies Array<[string, string]>).map(([field, subject]): RejectedStatus => [
    `count field ${field} is negative`,
    buildBatchStatusDecoderPayload({ counts: buildBatchStatusCounts({ [field]: -1 }) }),
    subject,
  ]),
  [
    'child count differs from batch size',
    buildBatchStatusDecoderPayload({
      batch_size: 3,
      counts: buildBatchStatusCounts({ total: 3 }),
    }),
    'batch size',
  ],
  [
    'total differs from batch size',
    buildBatchStatusDecoderPayload({ counts: buildBatchStatusCounts({ total: 3 }) }),
    'batch total',
  ],
  ['children are outside manifest order', buildReversedBatchStatusDecoderPayload(), 'batch position'],
  ...([
    ['pending', { pending: 1 }],
    ['generating', { generating: 1 }],
    ['generated', { generated: 0 }],
    ['failed', { failed: 0 }],
    ['missing', { missing: 1 }],
  ] satisfies Array<[string, Record<string, number>]>).map(([field, counts]): RejectedStatus => [
    `${field} count differs from child statuses`,
    buildBatchStatusDecoderPayload({ counts: buildBatchStatusCounts(counts) }),
    `${field} count`,
  ]),
  ['batch_size is negative', buildBatchStatusDecoderPayload({ batch_size: -1 }), 'batch size'],
];

const invalidStatusChildren: Array<[condition: string, child: Record<string, unknown>]> = [
  ...requiredBatchStatusChildFields.map((field): [string, Record<string, unknown>] => [
    `required field ${field} is missing`, omitDecoderField(buildBatchStatusChildDecoderRecord(), field),
  ]),
  ...([
    ['id is numeric', 'id', 1],
    ['idea_id is null', 'idea_id', null],
    ['keyword_id is boolean', 'keyword_id', false],
    ['keyword is an array', 'keyword', []],
    ['status is unknown', 'status', 'unknown'],
    ['has_content is a string', 'has_content', 'true'],
  ] satisfies Array<[string, string, unknown]>).map(([condition, field, value]): [string, Record<string, unknown>] => [
    condition, buildBatchStatusChildDecoderRecord({ [field]: value }),
  ]),
];

describe('Content Studio batch status decoder', () => {
  it.each(rejectedStatusResponses)('rejects the batch status response when %s', (_condition, payload, subject) => {
    expect(() => decodeBatchStatusResponse(payload)).toThrow(invalidContentStudioResponse(subject));
  });

  it('rejects the batch status response when its ID differs from the requested ID', () => {
    expect(() => decodeBatchStatusResponse(buildBatchStatusDecoderPayload(), 'different-batch'))
      .toThrow(invalidContentStudioResponse('batch status response'));
  });

  it.each(invalidStatusChildren)('rejects a batch status child when %s', (_condition, child) => {
    expect(() => decodeBatchStatusResponse(buildSingleBatchStatusDecoderPayload(child)))
      .toThrow(invalidContentStudioResponse('batch status child'));
  });

  it.each(invalidBatchStatusMetadataDecoderCases)('$testName', ({
    child, errorField
  }) => {
    expect(() => decodeBatchStatusResponse(buildSingleBatchStatusDecoderPayload(child)))
      .toThrow(invalidContentStudioResponse(errorField));
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
      .toThrow(invalidContentStudioResponse('batch status child'));
  });

  it('normalizes every batch status Decimal string', () => {
    const firstChild = buildBatchStatusChildDecoderRecord({ batch_position: '01' });
    const secondChild = buildBatchStatusChildDecoderRecord({ batch_position: '02' }, 1);
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
    expect(decoded.counts).toStrictEqual(apiBatchStatusResponse.counts);
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
});
