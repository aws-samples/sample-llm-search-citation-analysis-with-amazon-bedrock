import type {
  ContentBriefBatchStatus, ContentStatus
} from '../types';
import {
  apiBatchStartResponse, apiBatchStatusResponse
} from './contentStudio-fixtures';
import {
  invalidIntegerRepresentations, omitDecoderField
} from './contentStudioDecoders-fixtures';

export {
  invalidIntegerRepresentations, omitDecoderField
} from './contentStudioDecoders-fixtures';

export const validContentStatuses = [
  'pending', 'generating', 'generated', 'failed',
] satisfies readonly ContentStatus[];

export const validContentBriefBatchStatuses = [
  ...validContentStatuses,
  'missing',
] satisfies readonly ContentBriefBatchStatus[];

export const requiredBatchStartChildFields = [
  'id',
  'idea_id',
  'keyword_id',
  'keyword',
  'status',
  'idempotent_hit',
];

export function buildBatchStartChildDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...apiBatchStartResponse.children[0],
    ...overrides,
  };
}

export function buildBatchStartDecoderPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...apiBatchStartResponse,
    children: apiBatchStartResponse.children.map((child) => ({ ...child })),
    ...overrides,
  };
}

export function buildSingleBatchStartDecoderPayload(
  child: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildBatchStartDecoderPayload({
    batch_size: 1,
    accepted_count: 1,
    existing_count: 0,
    failed_count: 0,
    children: [child],
    ...overrides,
  });
}

export function buildReversedBatchStartDecoderPayload(): Record<string, unknown> {
  return buildBatchStartDecoderPayload({
    children: [
      buildBatchStartChildDecoderRecord({
        id: 'content-2',
        idea_id: 'idea-2',
        keyword_id: 'keyword-2',
        keyword: 'Beta keyword',
        batch_position: 2,
      }),
      buildBatchStartChildDecoderRecord({ batch_position: 1 }),
    ],
  });
}

export const invalidBatchPositionDecoderCases = [
  {
    testName: 'rejects a batch start child when batch_position is missing',
    child: omitDecoderField(buildBatchStartChildDecoderRecord(), 'batch_position'),
  },
  ...invalidIntegerRepresentations.map((batchPosition) => ({
    testName: `rejects a batch start child when batch_position is ${String(batchPosition)}`,
    child: buildBatchStartChildDecoderRecord({ batch_position: batchPosition }),
  })),
];

export const requiredBatchStatusChildFields = [
  'id',
  'idea_id',
  'keyword_id',
  'keyword',
  'status',
  'has_content',
];

export function buildBatchStatusChildDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...apiBatchStatusResponse.children[0],
    ...overrides,
  };
}

export const invalidBatchStatusMetadataDecoderCases = [
  {
    testName: 'rejects a batch status child when required field batch_position is missing',
    errorField: 'batch position',
    child: omitDecoderField(buildBatchStatusChildDecoderRecord(), 'batch_position'),
  },
  {
    testName: 'rejects a batch status child when required field created_at is missing',
    errorField: 'child creation timestamp',
    child: omitDecoderField(buildBatchStatusChildDecoderRecord(), 'created_at'),
  },
  {
    testName: 'rejects a batch status child when required field updated_at is missing',
    errorField: 'child update timestamp',
    child: omitDecoderField(buildBatchStatusChildDecoderRecord(), 'updated_at'),
  },
  {
    testName: 'rejects a batch status child when required field error_message is missing',
    errorField: 'child error',
    child: omitDecoderField(buildBatchStatusChildDecoderRecord(), 'error_message'),
  },
  {
    testName: 'rejects a batch status child when nullable field created_at is numeric',
    errorField: 'child creation timestamp',
    child: buildBatchStatusChildDecoderRecord({ created_at: 1 }),
  },
  {
    testName: 'rejects a batch status child when nullable field updated_at is numeric',
    errorField: 'child update timestamp',
    child: buildBatchStatusChildDecoderRecord({ updated_at: 1 }),
  },
  {
    testName: 'rejects a batch status child when nullable field error_message is numeric',
    errorField: 'child error',
    child: buildBatchStatusChildDecoderRecord({ error_message: 1 }),
  },
];

export function buildBatchStatusCounts(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...apiBatchStatusResponse.counts,
    ...overrides,
  };
}

export function buildBatchStatusDecoderPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...apiBatchStatusResponse,
    children: apiBatchStatusResponse.children.map((child) => ({ ...child })),
    counts: buildBatchStatusCounts(),
    ...overrides,
  };
}

export function buildSingleBatchStatusDecoderPayload(
  child: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildBatchStatusDecoderPayload({
    batch_size: 1,
    children: [child],
    counts: buildBatchStatusCounts({
      failed: 0,
      total: 1,
    }),
    ...overrides,
  });
}

export function buildMissingBatchStatusDecoderPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const child = buildBatchStatusChildDecoderRecord({
    status: 'missing',
    has_content: false,
    error_message: 'Content is no longer available',
    ...overrides,
  });
  return buildSingleBatchStatusDecoderPayload(child, {
    counts: buildBatchStatusCounts({
      generated: 0,
      failed: 0,
      missing: 1,
      total: 1,
    }),
  });
}

function statusErrorMessage(status: ContentBriefBatchStatus): string | null {
  if (status === 'failed') return 'Generation failed';
  if (status === 'missing') return 'Content is no longer available';
  return null;
}

export function buildAllStatusBatchDecoderPayload(): Record<string, unknown> {
  const children = validContentBriefBatchStatuses.map((status, index) => ({
    ...buildBatchStatusChildDecoderRecord(),
    id: `content-${index + 1}`,
    idea_id: `idea-${index + 1}`,
    keyword_id: `keyword-${index + 1}`,
    keyword: `Keyword ${index + 1}`,
    status,
    batch_position: index + 1,
    has_content: status === 'generated',
    error_message: statusErrorMessage(status),
  }));
  return buildBatchStatusDecoderPayload({
    batch_size: children.length,
    children,
    counts: {
      pending: 1,
      generating: 1,
      generated: 1,
      failed: 1,
      missing: 1,
      total: children.length,
    },
  });
}

export function buildReversedBatchStatusDecoderPayload(): Record<string, unknown> {
  return buildBatchStatusDecoderPayload({
    children: [
      buildBatchStatusChildDecoderRecord({
        id: 'content-2',
        idea_id: 'idea-2',
        keyword_id: 'keyword-2',
        keyword: 'Beta keyword',
        status: 'failed',
        batch_position: 2,
        has_content: false,
        error_message: 'Generation failed',
      }),
      buildBatchStatusChildDecoderRecord({ batch_position: 1 }),
    ],
  });
}
