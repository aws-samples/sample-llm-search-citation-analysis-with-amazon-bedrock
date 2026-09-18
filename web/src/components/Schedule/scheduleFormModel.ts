import type { SchedulePayload } from '../../api/executions';
import type {
  AnalysisScope, KeywordGroup, Schedule, ScheduleFormData, ScheduleFrequency
} from '../../types';

/**
 * Pure helpers behind the schedule form: defaults, mapping a schedule into
 * form state and back into an API payload, client-side validation and the
 * human-readable summary shown on each schedule card.
 */

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
export const MAX_DISPLAY_NAME_LENGTH = 100;

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

export function defaultScheduleFormData(): ScheduleFormData {
  return {
    display_name: '',
    frequency: 'daily',
    time: '09:00',
    timezone: 'UTC',
    day_of_week: 'MON',
    day_of_month: '1',
    enabled: true,
    scope: { mode: 'all' },
  };
}

/** Form state for editing an existing schedule; legacy gaps fall back to defaults. */
export function formDataFromSchedule(schedule: Schedule): ScheduleFormData {
  const defaults = defaultScheduleFormData();
  const form = schedule.form;
  return {
    display_name: schedule.display_name,
    frequency: form?.frequency ?? defaults.frequency,
    time: form?.time ?? defaults.time,
    timezone: form?.timezone ?? schedule.timezone ?? defaults.timezone,
    day_of_week: form?.day_of_week ?? defaults.day_of_week,
    day_of_month: String(form?.day_of_month ?? defaults.day_of_month),
    enabled: schedule.enabled,
    scope: schedule.scope ?? defaults.scope,
  };
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
  if (formData.scope.mode === 'groups' && formData.scope.group_ids.length === 0) return 'Select at least one keyword group';
  if (formData.scope.mode === 'keywords' && formData.scope.keyword_ids.length === 0) return 'Select at least one keyword';
  return null;
}

export function toSchedulePayload(formData: ScheduleFormData): SchedulePayload {
  return {
    display_name: formData.display_name.trim(),
    frequency: formData.frequency,
    time: formData.time,
    timezone: formData.timezone.trim(),
    day_of_week: formData.day_of_week,
    day_of_month: Number(formData.day_of_month) || 1,
    enabled: formData.enabled,
    scope: formData.scope,
  };
}

export function isScheduleFrequency(value: string): value is ScheduleFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}

function dayLabel(value: string): string {
  return DAYS_OF_WEEK.find((day) => day.value === value)?.label ?? value;
}

/** "Weekly on Monday at 09:00 (Europe/Madrid)" — falls back to the raw cron for hand-written schedules. */
export function describeScheduleTiming(schedule: Schedule): string {
  const form = schedule.form;
  if (form === null) return `${schedule.schedule} (${schedule.timezone})`;
  const when = `at ${form.time} (${form.timezone})`;
  if (form.frequency === 'weekly') return `Weekly on ${dayLabel(form.day_of_week)} ${when}`;
  if (form.frequency === 'monthly') return `Monthly on day ${form.day_of_month} ${when}`;
  return `Daily ${when}`;
}

/** "All active keywords" / "Groups: Hotel A, Hotel B" / "3 selected keywords". */
export function describeScheduleScope(scope: AnalysisScope | null, groups: KeywordGroup[], legacyKeywords: string[] = []): string {
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
