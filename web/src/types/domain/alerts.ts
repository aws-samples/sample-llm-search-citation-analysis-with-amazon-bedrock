export type AlertType =
  | 'citation_rate_drop'
  | 'position_loss'
  | 'new_competitor_top'
  | 'keyword_lost_mention'
  | 'improvement_after_content_change';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged';
export type AlertStatusFilter = AlertStatus | 'all';
export type AlertMetricValue = number | string | boolean | null;
export type AlertSubscriptionStatus =
  | 'confirmed'
  | 'pending_confirmation'
  | 'not_subscribed'
  | 'unknown';

export interface ContentChangeMarker {
  id: string;
  group_id: string;
  changed_at: string;
  description: string;
  url?: string;
  ttl: number | string;
}

export interface AlertItem {
  id: string;
  group_id: string;
  group_name: string;
  execution_id: string;
  created_at: string;
  run_timestamp: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  entity?: string;
  previous: AlertMetricValue;
  current: AlertMetricValue;
  delta: AlertMetricValue;
  threshold: AlertMetricValue;
  message: string;
  content_change?: ContentChangeMarker;
}

export interface AlertsResponse {
  items: AlertItem[];
  count: number;
}

export interface AlertAcknowledgement {
  success: true;
  id: string;
  status: 'acknowledged';
}

export interface AlertThresholds {
  citation_rate_drop: number;
  position_loss: number;
  competitor_top_n: number;
  improvement_after_content_change: number;
}

export interface AlertSubscription {
  email: string;
  status: AlertSubscriptionStatus;
}

export interface AlertSettings {
  config_id: 'default';
  enabled: boolean;
  notification_emails: string[];
  thresholds: AlertThresholds;
  updated_at?: string;
  subscription_statuses: AlertSubscription[];
  warnings?: string[];
}

export interface AlertSettingsUpdate {
  enabled: boolean;
  notification_emails: string[];
  thresholds: AlertThresholds;
}

export interface ContentChangesResponse {
  items: ContentChangeMarker[];
  count: number;
}

export interface CreateContentChangeRequest {
  group_id: string;
  description: string;
  url?: string;
}

const ALERT_TYPES = [
  'citation_rate_drop',
  'position_loss',
  'new_competitor_top',
  'keyword_lost_mention',
  'improvement_after_content_change',
] satisfies readonly AlertType[];

const ALERT_SEVERITIES = [
  'info',
  'warning',
  'critical',
] satisfies readonly AlertSeverity[];

const ALERT_STATUSES = [
  'open',
  'acknowledged',
] satisfies readonly AlertStatus[];

const SUBSCRIPTION_STATUSES = [
  'confirmed',
  'pending_confirmation',
  'not_subscribed',
  'unknown',
] satisfies readonly AlertSubscriptionStatus[];

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
}

function isNonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

function isStringArray(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === 'string');
}

function isFiniteNumber(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isFinite(candidate);
}

function isNumberInRange(candidate: unknown, minimum: number, maximum: number): candidate is number {
  return isFiniteNumber(candidate) && candidate >= minimum && candidate <= maximum;
}

function isNonNegativeInteger(candidate: unknown): candidate is number {
  return isFiniteNumber(candidate) && Number.isInteger(candidate) && candidate >= 0;
}

function isIntegerInRange(candidate: unknown, minimum: number, maximum: number): candidate is number {
  return isFiniteNumber(candidate)
    && Number.isInteger(candidate)
    && candidate >= minimum
    && candidate <= maximum;
}

function isPositiveIntegerWireValue(candidate: unknown): candidate is number | string {
  if (isIntegerInRange(candidate, 1, Number.MAX_SAFE_INTEGER)) return true;
  if (typeof candidate !== 'string' || !/^[1-9]\d*$/u.test(candidate)) return false;
  return isIntegerInRange(Number(candidate), 1, Number.MAX_SAFE_INTEGER);
}

function isTimestamp(candidate: unknown): candidate is string {
  return isNonEmptyString(candidate) && Number.isFinite(Date.parse(candidate));
}

export function isNotificationEmail(candidate: string): boolean {
  const atIndex = candidate.indexOf('@');
  const dotIndex = candidate.lastIndexOf('.');
  const hasWhitespace = [...candidate].some((character) => character.trim() === '');
  return !hasWhitespace
    && atIndex === candidate.lastIndexOf('@')
    && atIndex > 0
    && dotIndex > atIndex + 1
    && dotIndex < candidate.length - 1;
}

export function isHttpUrl(candidate: string): boolean {
  try {
    const parsedUrl = new URL(candidate);
    return (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')
      && parsedUrl.hostname.length > 0;
  } catch {
    return false;
  }
}

function isOptionalHttpUrl(candidate: unknown): candidate is string | undefined {
  return candidate === undefined
    || (typeof candidate === 'string' && isHttpUrl(candidate));
}

function isAlertType(candidate: unknown): candidate is AlertType {
  return typeof candidate === 'string'
    && ALERT_TYPES.some((alertType) => alertType === candidate);
}

function isAlertSeverity(candidate: unknown): candidate is AlertSeverity {
  return typeof candidate === 'string'
    && ALERT_SEVERITIES.some((severity) => severity === candidate);
}

function isAlertStatus(candidate: unknown): candidate is AlertStatus {
  return typeof candidate === 'string'
    && ALERT_STATUSES.some((status) => status === candidate);
}

function isSubscriptionStatus(candidate: unknown): candidate is AlertSubscriptionStatus {
  return typeof candidate === 'string'
    && SUBSCRIPTION_STATUSES.some((status) => status === candidate);
}

function isAlertMetricValue(candidate: unknown): candidate is AlertMetricValue {
  return candidate === null
    || typeof candidate === 'string'
    || typeof candidate === 'boolean'
    || isFiniteNumber(candidate);
}

export function isContentChangeMarker(candidate: unknown): candidate is ContentChangeMarker {
  return isRecord(candidate)
    && isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.group_id)
    && isTimestamp(candidate.changed_at)
    && isNonEmptyString(candidate.description)
    && isOptionalHttpUrl(candidate.url)
    && isPositiveIntegerWireValue(candidate.ttl);
}

function hasAlertIdentity(candidate: Record<string, unknown>): boolean {
  return isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.group_id)
    && isNonEmptyString(candidate.group_name)
    && isNonEmptyString(candidate.execution_id)
    && isTimestamp(candidate.created_at)
    && isTimestamp(candidate.run_timestamp);
}

function hasAlertClassification(candidate: Record<string, unknown>): boolean {
  return isAlertType(candidate.type)
    && isAlertSeverity(candidate.severity)
    && isAlertStatus(candidate.status)
    && (candidate.entity === undefined || isNonEmptyString(candidate.entity))
    && isNonEmptyString(candidate.message);
}

function hasAlertMetrics(candidate: Record<string, unknown>): boolean {
  return isAlertMetricValue(candidate.previous)
    && isAlertMetricValue(candidate.current)
    && isAlertMetricValue(candidate.delta)
    && isAlertMetricValue(candidate.threshold);
}

export function isAlertItem(candidate: unknown): candidate is AlertItem {
  return isRecord(candidate)
    && hasAlertIdentity(candidate)
    && hasAlertClassification(candidate)
    && hasAlertMetrics(candidate)
    && (candidate.content_change === undefined || isContentChangeMarker(candidate.content_change));
}

export function isAlertsResponse(candidate: unknown): candidate is AlertsResponse {
  return isRecord(candidate)
    && Array.isArray(candidate.items)
    && candidate.items.every(isAlertItem)
    && isNonNegativeInteger(candidate.count)
    && candidate.count >= candidate.items.length;
}

export function isAlertAcknowledgement(candidate: unknown): candidate is AlertAcknowledgement {
  return isRecord(candidate)
    && candidate.success === true
    && isNonEmptyString(candidate.id)
    && candidate.status === 'acknowledged';
}

function isAlertThresholds(candidate: unknown): candidate is AlertThresholds {
  return isRecord(candidate)
    && isNumberInRange(candidate.citation_rate_drop, 0.1, 100)
    && isNumberInRange(candidate.position_loss, 0.1, 100)
    && isIntegerInRange(candidate.competitor_top_n, 1, 10)
    && isNumberInRange(candidate.improvement_after_content_change, 0.1, 100);
}

function isAlertSubscription(candidate: unknown): candidate is AlertSubscription {
  return isRecord(candidate)
    && typeof candidate.email === 'string'
    && isNotificationEmail(candidate.email)
    && isSubscriptionStatus(candidate.status);
}

function isNotificationEmailArray(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate)
    && candidate.every((email) => typeof email === 'string' && isNotificationEmail(email));
}

export function isAlertSettings(candidate: unknown): candidate is AlertSettings {
  return isRecord(candidate)
    && candidate.config_id === 'default'
    && typeof candidate.enabled === 'boolean'
    && isNotificationEmailArray(candidate.notification_emails)
    && isAlertThresholds(candidate.thresholds)
    && (candidate.updated_at === undefined || isTimestamp(candidate.updated_at))
    && Array.isArray(candidate.subscription_statuses)
    && candidate.subscription_statuses.every(isAlertSubscription)
    && (candidate.warnings === undefined || isStringArray(candidate.warnings));
}

export function isContentChangesResponse(candidate: unknown): candidate is ContentChangesResponse {
  return isRecord(candidate)
    && Array.isArray(candidate.items)
    && candidate.items.every(isContentChangeMarker)
    && isNonNegativeInteger(candidate.count)
    && candidate.count >= candidate.items.length;
}
