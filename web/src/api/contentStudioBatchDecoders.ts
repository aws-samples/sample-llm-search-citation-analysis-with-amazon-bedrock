import type {
  ContentBriefBatchCounts,
  ContentBriefBatchStartChild,
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusChild,
  ContentBriefBatchStatusResponse,
} from '../types';
import {
  decodeInteger,
  invalid,
  isAllowedString,
  isNullableString,
  isOptionalString,
  isRecord,
} from './contentStudioDecoderPrimitives';
import {
  contentBriefBatchStatuses, contentStatuses
} from './contentStudioDecoderEnums';

interface BatchChildIdentity {
  id: string;
  idea_id: string;
  keyword_id: string;
  keyword: string;
  batch_position: number;
}

function decodeBatchChildIdentity(value: unknown, field: string): BatchChildIdentity {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.idea_id !== 'string'
    || typeof value.keyword_id !== 'string'
    || typeof value.keyword !== 'string') {
    throw invalid(field);
  }
  return {
    id: value.id,
    idea_id: value.idea_id,
    keyword_id: value.keyword_id,
    keyword: value.keyword,
    batch_position: decodeInteger(value.batch_position, 'batch position'),
  };
}

function decodeBatchStartChild(value: unknown): ContentBriefBatchStartChild {
  const identity = decodeBatchChildIdentity(value, 'batch child');
  if (!isRecord(value)
    || !isAllowedString(value.status, contentStatuses())
    || typeof value.idempotent_hit !== 'boolean') {
    throw invalid('batch child');
  }
  return {
    ...identity,
    status: value.status,
    idempotent_hit: value.idempotent_hit,
  };
}

function requireExactCount(
  actualCount: number,
  expectedCount: number,
  field: string
): void {
  if (actualCount !== expectedCount) throw invalid(field);
}

function requireExpectedBatchId(
  actualBatchId: string,
  expectedBatchId: string | undefined,
  field: string
): void {
  if (expectedBatchId !== undefined && actualBatchId !== expectedBatchId) {
    throw invalid(field);
  }
}

function requireManifestOrder(
  children: readonly { batch_position: number }[]
): void {
  children.forEach((child, index) => {
    requireExactCount(child.batch_position, index + 1, 'batch position');
  });
}

function requireBatchOutcomeCounts(
  children: readonly ContentBriefBatchStartChild[],
  acceptedCount: number,
  existingCount: number,
  failedCount: number
): void {
  requireExactCount(failedCount, 0, 'failed count');
  const observedExisting = children.filter((child) => child.idempotent_hit).length;
  requireExactCount(existingCount, observedExisting, 'existing count');
  requireExactCount(acceptedCount, children.length - observedExisting, 'accepted count');
}

export function decodeBatchStartResponse(
  payload: unknown,
  expectedBatchId?: string
): ContentBriefBatchStartResponse {
  if (!isRecord(payload)
    || typeof payload.success !== 'boolean'
    || typeof payload.batch_id !== 'string'
    || !Array.isArray(payload.children)
    || !isOptionalString(payload.error)) {
    throw invalid('batch response');
  }
  requireExpectedBatchId(payload.batch_id, expectedBatchId, 'batch response');
  const batchSize = decodeInteger(payload.batch_size, 'batch size');
  const acceptedCount = decodeInteger(payload.accepted_count, 'accepted count');
  const existingCount = decodeInteger(payload.existing_count, 'existing count');
  const failedCount = decodeInteger(payload.failed_count, 'failed count');
  const children = payload.children.map(decodeBatchStartChild);
  requireExactCount(children.length, batchSize, 'batch size');
  requireManifestOrder(children);
  requireBatchOutcomeCounts(children, acceptedCount, existingCount, failedCount);
  return {
    success: payload.success,
    batch_id: payload.batch_id,
    batch_size: batchSize,
    accepted_count: acceptedCount,
    existing_count: existingCount,
    failed_count: failedCount,
    children,
    ...(payload.error === undefined ? {} : { error: payload.error }),
  };
}

function decodeBatchCounts(value: unknown): ContentBriefBatchCounts {
  if (!isRecord(value)) throw invalid('batch counts');
  return {
    pending: decodeInteger(value.pending, 'pending count'),
    generating: decodeInteger(value.generating, 'generating count'),
    generated: decodeInteger(value.generated, 'generated count'),
    failed: decodeInteger(value.failed, 'failed count'),
    missing: decodeInteger(value.missing, 'missing count'),
    total: decodeInteger(value.total, 'batch total'),
  };
}

function observedBatchCounts(
  children: ContentBriefBatchStatusChild[]
): ContentBriefBatchCounts {
  const counts: ContentBriefBatchCounts = {
    pending: 0,
    generating: 0,
    generated: 0,
    failed: 0,
    missing: 0,
    total: children.length,
  };
  for (const child of children) counts[child.status] += 1;
  return counts;
}

function requireBatchStatusCounts(
  children: ContentBriefBatchStatusChild[],
  counts: ContentBriefBatchCounts,
  batchSize: number
): void {
  const observed = observedBatchCounts(children);
  requireExactCount(children.length, batchSize, 'batch size');
  requireExactCount(counts.total, batchSize, 'batch total');
  requireExactCount(counts.pending, observed.pending, 'pending count');
  requireExactCount(counts.generating, observed.generating, 'generating count');
  requireExactCount(counts.generated, observed.generated, 'generated count');
  requireExactCount(counts.failed, observed.failed, 'failed count');
  requireExactCount(counts.missing, observed.missing, 'missing count');
}

function decodeNullableString(value: unknown, field: string): string | null {
  if (!isNullableString(value)) throw invalid(field);
  return value;
}

function requireMissingTombstone(child: ContentBriefBatchStatusChild): void {
  if (child.status !== 'missing') return;
  if (child.has_content
    || child.error_message === null
    || child.error_message.trim().length === 0) {
    throw invalid('batch status child');
  }
}

function decodeBatchStatusChild(value: unknown): ContentBriefBatchStatusChild {
  const identity = decodeBatchChildIdentity(value, 'batch status child');
  if (!isRecord(value)
    || !isAllowedString(value.status, contentBriefBatchStatuses())
    || typeof value.has_content !== 'boolean') {
    throw invalid('batch status child');
  }
  const child: ContentBriefBatchStatusChild = {
    ...identity,
    status: value.status,
    created_at: decodeNullableString(value.created_at, 'child creation timestamp'),
    updated_at: decodeNullableString(value.updated_at, 'child update timestamp'),
    has_content: value.has_content,
    error_message: decodeNullableString(value.error_message, 'child error'),
  };
  requireMissingTombstone(child);
  return child;
}

export function decodeBatchStatusResponse(
  payload: unknown,
  expectedBatchId?: string
): ContentBriefBatchStatusResponse {
  if (!isRecord(payload)
    || typeof payload.batch_id !== 'string'
    || !Array.isArray(payload.children)) {
    throw invalid('batch status response');
  }
  requireExpectedBatchId(payload.batch_id, expectedBatchId, 'batch status response');
  const batchSize = decodeInteger(payload.batch_size, 'batch size');
  const children = payload.children.map(decodeBatchStatusChild);
  const counts = decodeBatchCounts(payload.counts);
  requireManifestOrder(children);
  requireBatchStatusCounts(children, counts, batchSize);
  return {
    batch_id: payload.batch_id,
    batch_size: batchSize,
    children,
    counts,
  };
}
