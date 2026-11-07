/**
 * Runtime guards for the site audit API (`./seoAudits`). Each `is*Response` guard
 * mirrors `web/src/types/api/seoAudits.ts`; fields the dashboard does not read
 * are not checked, so a newer server field never breaks an older dashboard.
 */
import {
  isFiniteNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import type {
  AiReadiness,
  AuditDetailResponse,
  AuditIssue,
  AuditIssueTypesResponse,
  AuditIssuesResponse,
  AuditListResponse,
  AuditResponse,
  AuditStatus,
  AuditSummary,
  BotAccess,
  IssueDescriptor,
  IssueGroup,
  IssueSeverity,
  IssueTypeCount,
  IssueTypeEntry,
  SiteAudit,
  SiteAuditDetail,
} from '../types/api/seoAudits';

const STATUSES: readonly AuditStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const SEVERITIES: readonly IssueSeverity[] = ['critical', 'warning', 'info'];
const GROUPS: readonly IssueGroup[] = ['crawl', 'indexing', 'content', 'links', 'performance', 'ai_readiness'];

function oneOf<T extends string>(choices: readonly T[]) {
  const allowed = new Set<string>(choices);
  return (value: unknown): value is T => typeof value === 'string' && allowed.has(value);
}

const isStatus = oneOf(STATUSES);
const isSeverity = oneOf(SEVERITIES);
const isGroup = oneOf(GROUPS);
const isBotClass = oneOf(['search', 'user_fetch', 'training'] as const);
const isAccess = oneOf(['allowed', 'partial', 'blocked'] as const);
const isRobotsKind = oneOf(['parsed', 'allow_all', 'disallow_all'] as const);
const isLlmsState = oneOf(['present', 'invalid', 'missing', 'not_checked'] as const);

const isString = (value: unknown): value is string => typeof value === 'string';

/** A guard for arrays whose every item passes `isItem`. */
function listOf<T>(isItem: (item: unknown) => item is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every((item) => isItem(item));
}

function isCountMap(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isFiniteNumber(value[key]));
}

function hasAuditCounts(value: Record<string, unknown>): boolean {
  return isFiniteNumber(value.max_pages) && isFiniteNumber(value.pages_crawled) && isNullableNumber(value.pages_total);
}

function hasAuditTexts(value: Record<string, unknown>): boolean {
  return isString(value.audit_id) && isString(value.start_url) && isString(value.started_at)
    && [value.completed_at, value.origin, value.phase, value.started_by, value.error_code, value.stop_reason]
      .every(isNullableString);
}

function isSiteAudit(value: unknown): value is SiteAudit {
  return isRecord(value) && isStatus(value.status) && hasAuditCounts(value) && hasAuditTexts(value);
}

function isIssueTypeCount(value: unknown): value is IssueTypeCount {
  return isRecord(value) && isString(value.issue_type) && isFiniteNumber(value.issues) && isFiniteNumber(value.pages);
}

function isSummary(value: unknown): value is AuditSummary {
  return isRecord(value)
    && isFiniteNumber(value.score) && isFiniteNumber(value.issues_total)
    && isCountMap(value.counts_by_severity, SEVERITIES) && isCountMap(value.counts_by_group, GROUPS)
    && listOf(isIssueTypeCount)(value.issue_types);
}

function isBotAccess(value: unknown): value is BotAccess {
  return isRecord(value)
    && isString(value.token) && isString(value.vendor) && isBotClass(value.bot_class) && isAccess(value.access)
    && isStringArray(value.blocked_paths) && isString(value.rule) && isNullableNumber(value.line);
}

function isAiReadiness(value: unknown): value is AiReadiness {
  return isRecord(value)
    && isFiniteNumber(value.robots_status) && isRobotsKind(value.robots_kind)
    && listOf(isBotAccess)(value.bots) && isLlmsState(value.llms_txt);
}

function isSiteAuditDetail(value: unknown): value is SiteAuditDetail {
  return isSiteAudit(value) && isRecord(value)
    && (value.summary === null || isSummary(value.summary))
    && (value.ai_readiness === null || isAiReadiness(value.ai_readiness));
}

function isIssueDescriptor(value: unknown): value is IssueDescriptor {
  return isRecord(value)
    && isString(value.issue_type) && isSeverity(value.severity) && isGroup(value.group)
    && isString(value.title) && isString(value.explanation) && isString(value.how_to_fix);
}

function isIssueTypeEntry(value: unknown): value is IssueTypeEntry {
  return isIssueDescriptor(value) && isRecord(value) && isFiniteNumber(value.issues) && isFiniteNumber(value.pages);
}

function isAuditIssue(value: unknown): value is AuditIssue {
  return isRecord(value) && isString(value.issue_type) && isString(value.page_url) && isRecord(value.details);
}

export function isAuditListResponse(value: unknown): value is AuditListResponse {
  return isRecord(value)
    && listOf(isSiteAudit)(value.audits) && isStringArray(value.sites)
    && listOf(isFiniteNumber)(value.max_pages_choices);
}

export function isAuditDetailResponse(value: unknown): value is AuditDetailResponse {
  return isRecord(value) && isSiteAuditDetail(value.audit);
}

export function isAuditResponse(value: unknown): value is AuditResponse {
  return isRecord(value) && isSiteAudit(value.audit);
}

export function isAuditIssueTypesResponse(value: unknown): value is AuditIssueTypesResponse {
  return isRecord(value) && isString(value.audit_id) && listOf(isIssueTypeEntry)(value.issue_types);
}

export function isAuditIssuesResponse(value: unknown): value is AuditIssuesResponse {
  return isRecord(value)
    && isString(value.audit_id) && isIssueDescriptor(value.issue)
    && listOf(isAuditIssue)(value.items) && isNullableString(value.next_token);
}
