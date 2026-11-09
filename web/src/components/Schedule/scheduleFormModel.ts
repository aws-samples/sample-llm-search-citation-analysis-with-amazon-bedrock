import type { SchedulePayload } from '../../api/executions';
import type {
  AnalysisScope, KeywordGroup, Market, Schedule, ScheduleForm, ScheduleFormData, ScheduleFrequency
} from '../../types';
import {
  describeScopeMarkets, scopeMarketIds
} from '../Markets/marketScope';
import { marketName } from '../Markets/marketSelection';
import {
  kindOf, scheduleKindInfo
} from './scheduleKinds';

/**
 * Pure helpers behind the schedule form: defaults, mapping a schedule into
 * form state and back into an API payload, client-side validation and the
 * human-readable summary shown on each schedule card.
 */

/** Sets one field of the schedule form. */
export type UpdateScheduleField = <K extends keyof ScheduleFormData>(field: K, value: ScheduleFormData[K]) => void;

export const DAYS_OF_WEEK: readonly {
  value: string;
  label: string 
}[] = [
  {
    value: 'MON',
    label: 'Monday' 
  },
  {
    value: 'TUE',
    label: 'Tuesday' 
  },
  {
    value: 'WED',
    label: 'Wednesday' 
  },
  {
    value: 'THU',
    label: 'Thursday' 
  },
  {
    value: 'FRI',
    label: 'Friday' 
  },
  {
    value: 'SAT',
    label: 'Saturday' 
  },
  {
    value: 'SUN',
    label: 'Sunday' 
  },
];

/** Days 29-31 are refused: a schedule on them would skip the shorter months. */
export const MAX_DAY_OF_MONTH = 28;
const MAX_DISPLAY_NAME_LENGTH = 100;

const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/Madrid', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Lisbon',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

/**
 * Every IANA zone the browser knows, falling back to a curated list where
 * `Intl.supportedValuesOf` is unavailable. The current value is always
 * present so an unusual stored zone still renders.
 */
export function timezoneOptions(current: string): string[] {
  const intl: {
    supportedValuesOf?: (key: 'timeZone') => string[];
    DateTimeFormat: typeof Intl.DateTimeFormat 
  } = Intl;
  const known = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : FALLBACK_TIMEZONES;
  const zones = new Set(['UTC', ...known]);
  if (current) zones.add(current);
  return [...zones].sort((left, right) => left.localeCompare(right));
}

/** The browser's own zone, so "at 09:00" means the user's 09:00; UTC when the browser does not say. */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function defaultScheduleFormData(): ScheduleFormData {
  return {
    kind: 'analysis',
    display_name: '',
    frequency: 'daily',
    time: '09:00',
    timezone: browserTimezone(),
    day_of_week: 'MON',
    day_of_month: '1',
    enabled: true,
    scope: { mode: 'all' },
  };
}

/** Timing fields from a stored form; legacy gaps fall back to the defaults. */
function timingFromScheduleForm(
  form: ScheduleForm | null,
  defaults: ScheduleFormData
): Pick<ScheduleFormData, 'frequency' | 'time' | 'day_of_week' | 'day_of_month'> {
  return {
    frequency: form?.frequency ?? defaults.frequency,
    time: form?.time ?? defaults.time,
    day_of_week: form?.day_of_week ?? defaults.day_of_week,
    day_of_month: String(form?.day_of_month ?? defaults.day_of_month),
  };
}

/** Form state for editing an existing schedule; legacy gaps fall back to defaults. */
export function formDataFromSchedule(schedule: Schedule): ScheduleFormData {
  const defaults = defaultScheduleFormData();
  const form = schedule.form;
  return {
    kind: kindOf(schedule),
    display_name: schedule.display_name,
    ...timingFromScheduleForm(form, defaults),
    timezone: form?.timezone ?? schedule.timezone ?? defaults.timezone,
    enabled: schedule.enabled,
    scope: schedule.scope ?? defaults.scope,
  };
}

/** The problem with the scope selection, or null when it names at least one target. */
function scopeProblem(scope: AnalysisScope): string | null {
  if (scope.mode === 'groups' && scope.group_ids.length === 0) return 'Select at least one keyword group';
  if (scope.mode === 'keywords' && scope.keyword_ids.length === 0) return 'Select at least one keyword';
  return null;
}

/** The first problem with the form, or null when it can be saved. */
export function validateScheduleFormData(formData: ScheduleFormData): string | null {
  const name = formData.display_name.trim();
  if (name === '') return 'Give the schedule a name';
  if (name.length > MAX_DISPLAY_NAME_LENGTH) return `The name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`;
  if (!/^\d{2}:\d{2}$/.test(formData.time)) return 'Pick a time (HH:MM)';
  if (formData.timezone.trim() === '') return 'Pick a timezone';
  if (formData.frequency === 'monthly') {
    const day = Number(formData.day_of_month);
    if (!Number.isInteger(day) || day < 1 || day > MAX_DAY_OF_MONTH) {
      return `Day of month must be between 1 and ${MAX_DAY_OF_MONTH}`;
    }
  }
  return formData.kind === 'analysis' ? scopeProblem(formData.scope) : null;
}

export function toSchedulePayload(formData: ScheduleFormData): SchedulePayload {
  return {
    kind: formData.kind,
    display_name: formData.display_name.trim(),
    frequency: formData.frequency,
    time: formData.time,
    timezone: formData.timezone.trim(),
    day_of_week: formData.day_of_week,
    day_of_month: Number(formData.day_of_month) || 1,
    enabled: formData.enabled,
    ...(formData.kind === 'analysis' ? { scope: formData.scope } : {}),
  };
}

export function isScheduleFrequency(value: string): value is ScheduleFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}

function dayLabel(value: string): string {
  return DAYS_OF_WEEK.find((day) => day.value === value)?.label ?? value;
}

/** The timing fields a description needs, from a stored schedule or the form being edited. */
export type ScheduleTiming = Pick<ScheduleForm, 'frequency' | 'time' | 'timezone' | 'day_of_week'> & {readonly day_of_month: number | string;};

/** "Every Monday at 09:00 (Europe/Madrid)", "Every day at …", "Every month on day 15 at …". */
export function describeTiming(timing: ScheduleTiming): string {
  const when = `at ${timing.time} (${timing.timezone})`;
  if (timing.frequency === 'weekly') return `Every ${dayLabel(timing.day_of_week)} ${when}`;
  if (timing.frequency === 'monthly') return `Every month on day ${timing.day_of_month} ${when}`;
  return `Every day ${when}`;
}

/** The timing in words; the raw cron for hand-written schedules without a stored form. */
export function describeScheduleTiming(schedule: Schedule): string {
  return schedule.form === null ? `${schedule.schedule} (${schedule.timezone})` : describeTiming(schedule.form);
}

const FREQUENCY_ADJECTIVE: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** The keywords part of a generated name: "all keywords", the one group's name, "3 groups", "5 keywords". */
function scopeNamePart(scope: AnalysisScope, groups: readonly KeywordGroup[]): string {
  if (scope.mode === 'groups') {
    const only = scope.group_ids.length === 1 ? groups.find((group) => group.id === scope.group_ids[0]) : undefined;
    return only?.name ?? `${scope.group_ids.length} groups`;
  }
  if (scope.mode === 'keywords') return `${scope.keyword_ids.length} keyword${scope.keyword_ids.length === 1 ? '' : 's'}`;
  return 'all keywords';
}

/** The name a schedule gets when the user leaves it blank: "Weekly analysis · all keywords", "Weekly backlink snapshots". */
export function suggestScheduleName(formData: ScheduleFormData, groups: readonly KeywordGroup[]): string {
  const base = `${FREQUENCY_ADJECTIVE[formData.frequency]} ${scheduleKindInfo(formData.kind).nameNoun}`;
  return formData.kind === 'analysis' ? `${base} · ${scopeNamePart(formData.scope, groups)}` : base;
}

/** The form with a blank name replaced by the generated one, which is what gets validated and saved. */
export function withResolvedName(formData: ScheduleFormData, groups: readonly KeywordGroup[]): ScheduleFormData {
  if (formData.display_name.trim() !== '') return formData;
  return {
    ...formData,
    display_name: suggestScheduleName(formData, groups),
  };
}

/** "All active keywords" / "Groups: Hotel A, Hotel B" / "3 selected keyword(s)", then " · Markets: Chile" when narrowed. */
export function describeScheduleScope(
  scope: AnalysisScope | null, groups: KeywordGroup[], legacyKeywords: string[] = [], markets: readonly Market[] = []
): string {
  const keywords = describeScopeKeywords(scope, groups, legacyKeywords);
  const narrowed = describeScopeMarkets(scopeMarketIds(scope), (marketId) => marketName(marketId, markets));
  return narrowed === null ? keywords : `${keywords} · ${narrowed}`;
}

function describeScopeKeywords(scope: AnalysisScope | null, groups: KeywordGroup[], legacyKeywords: string[]): string {
  if (scope === null) {
    return legacyKeywords.length > 0
      ? `${legacyKeywords.length} keyword(s) from the previous version: ${legacyKeywords.join(', ')}`
      : 'Scope unknown - edit to choose keywords';
  }
  if (scope.mode === 'groups') {
    const names = scope.group_ids.map((id) => groups.find((group) => group.id === id)?.name ?? 'deleted group');
    return `Groups: ${names.join(', ')}`;
  }
  if (scope.mode === 'keywords') return `${scope.keyword_ids.length} selected keyword(s)`;
  return 'All active keywords';
}
