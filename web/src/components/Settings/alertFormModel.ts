import type {
  AlertSettings,
  AlertSettingsUpdate,
  CreateContentChangeRequest,
} from '../../types';
import {
  isHttpUrl, isNotificationEmail
} from '../../types/domain/alerts';

export const MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH = 200;
export const MAX_CONTENT_CHANGE_URL_LENGTH = 2048;

export interface AlertSettingsFormValues {
  enabled: boolean;
  notificationEmailsText: string;
  citationRateDrop: string;
  positionLoss: string;
  competitorTopN: string;
  improvementAfterContentChange: string;
}

export interface ContentChangeFormValues {
  groupId: string;
  description: string;
  url: string;
}

interface NumericThreshold {
  value: string;
  label: string;
  maximum?: number;
  integer?: boolean;
  minimum: number;
}

function uniqueEmails(emailText: string): string[] {
  const emails = emailText
    .split(/[\n,]/)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
  const uniqueByLowercase = emails.reduce<Map<string, string>>((unique, email) => {
    const comparisonKey = email.toLocaleLowerCase();
    if (!unique.has(comparisonKey)) unique.set(comparisonKey, email);
    return unique;
  }, new Map<string, string>());
  return [...uniqueByLowercase.values()];
}

function validateThreshold({
  value, label, maximum, integer, minimum
}: NumericThreshold): string | null {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) return `${label} must be a number`;
  if (parsed < minimum) return `${label} must be at least ${minimum}`;
  if (maximum !== undefined && parsed > maximum) return `${label} must be at most ${maximum}`;
  if (integer === true && !Number.isInteger(parsed)) return `${label} must be a whole number`;
  return null;
}

export function alertSettingsFormValues(settings: AlertSettings): AlertSettingsFormValues {
  return {
    enabled: settings.enabled,
    notificationEmailsText: uniqueEmails(settings.notification_emails.join('\n')).join('\n'),
    citationRateDrop: String(settings.thresholds.citation_rate_drop),
    positionLoss: String(settings.thresholds.position_loss),
    competitorTopN: String(settings.thresholds.competitor_top_n),
    improvementAfterContentChange: String(settings.thresholds.improvement_after_content_change),
  };
}

export function validateAlertSettingsForm(values: AlertSettingsFormValues): string | null {
  const citationProblem = validateThreshold({
    value: values.citationRateDrop,
    label: 'Citation-rate drop',
    minimum: 0.1,
    maximum: 100,
  });
  if (citationProblem !== null) return citationProblem;

  const positionProblem = validateThreshold({
    value: values.positionLoss,
    label: 'Position loss',
    minimum: 0.1,
    maximum: 100,
  });
  if (positionProblem !== null) return positionProblem;

  const competitorProblem = validateThreshold({
    value: values.competitorTopN,
    label: 'Competitor top N',
    minimum: 1,
    maximum: 10,
    integer: true,
  });
  if (competitorProblem !== null) return competitorProblem;

  const improvementProblem = validateThreshold({
    value: values.improvementAfterContentChange,
    label: 'Improvement after content change',
    minimum: 0.1,
    maximum: 100,
  });
  if (improvementProblem !== null) return improvementProblem;

  const invalidEmail = uniqueEmails(values.notificationEmailsText)
    .find((email) => !isNotificationEmail(email));
  return invalidEmail === undefined ? null : `Enter a valid notification email: ${invalidEmail}`;
}

export function toAlertSettingsUpdate(values: AlertSettingsFormValues): AlertSettingsUpdate {
  return {
    enabled: values.enabled,
    notification_emails: uniqueEmails(values.notificationEmailsText),
    thresholds: {
      citation_rate_drop: Number(values.citationRateDrop),
      position_loss: Number(values.positionLoss),
      competitor_top_n: Number(values.competitorTopN),
      improvement_after_content_change: Number(values.improvementAfterContentChange),
    },
  };
}

export function validateContentChangeForm(values: ContentChangeFormValues): string | null {
  const description = values.description.trim();
  const url = values.url.trim();
  if (values.groupId === '') return 'Select a keyword group';
  if (description === '') return 'Describe the content change';
  if (description.length > MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH) {
    return `Description must be at most ${MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH} characters`;
  }
  if (url.length > MAX_CONTENT_CHANGE_URL_LENGTH) {
    return `URL must be at most ${MAX_CONTENT_CHANGE_URL_LENGTH} characters`;
  }
  if (url !== '' && !isHttpUrl(url)) return 'URL must start with http:// or https://';
  return null;
}

export function toContentChangeRequest(values: ContentChangeFormValues): CreateContentChangeRequest {
  const url = values.url.trim();
  return {
    group_id: values.groupId,
    description: values.description.trim(),
    ...(url === '' ? {} : { url }),
  };
}
