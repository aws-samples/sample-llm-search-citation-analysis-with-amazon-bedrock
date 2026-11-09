import type {ReactNode} from 'react';
import type { ScheduleFormData } from '../../types';
import {
  DAYS_OF_WEEK, MAX_DAY_OF_MONTH, describeTiming, isScheduleFrequency, timezoneOptions, type UpdateScheduleField
} from './scheduleFormModel';
import { describeNextRun } from './scheduleNextRun';

export const SCHEDULE_INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-gray-900';
const TIMEZONE_LIST_ID = 'schedule-timezone-options';
const DAYS_OF_MONTH = Array.from({ length: MAX_DAY_OF_MONTH }, (_, index) => String(index + 1));

interface ScheduleTimingFieldsProps {
  readonly formData: ScheduleFormData;
  readonly updateFormField: UpdateScheduleField;
}

const TimingField = ({
  label, htmlFor, className, children
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly className: string;
  readonly children: ReactNode;
}) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
    {children}
  </div>
);

/** Day of week for a weekly schedule, day of month (1-28) for a monthly one, nothing for a daily one. */
const DayField = ({
  formData, updateFormField
}: ScheduleTimingFieldsProps) => {
  if (formData.frequency === 'weekly') {
    return (
      <TimingField label="Day of week" htmlFor="schedule-day-of-week" className="w-36">
        <select id="schedule-day-of-week" name="schedule-day-of-week" value={formData.day_of_week}
          onChange={(e) => updateFormField('day_of_week', e.target.value)} className={SCHEDULE_INPUT_CLASS}>
          {DAYS_OF_WEEK.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
        </select>
      </TimingField>
    );
  }
  if (formData.frequency === 'monthly') {
    return (
      <TimingField label="Day of month" htmlFor="schedule-day-of-month" className="w-28">
        <select id="schedule-day-of-month" name="schedule-day-of-month" value={formData.day_of_month}
          onChange={(e) => updateFormField('day_of_month', e.target.value)} className={SCHEDULE_INPUT_CLASS}
          aria-describedby="schedule-day-of-month-hint">
          {DAYS_OF_MONTH.map((day) => <option key={day} value={day}>{day}</option>)}
        </select>
      </TimingField>
    );
  }
  return null;
};

/** The schedule's timing in words with its next run, as the fields are changed. */
const TimingSummary = ({ formData }: Pick<ScheduleTimingFieldsProps, 'formData'>) => {
  const valid = /^\d{2}:\d{2}$/.test(formData.time) && formData.timezone.trim() !== '';
  const next = valid ? describeNextRun(formData) : null;
  return (
    <p className="mt-2 text-sm text-gray-700" aria-live="polite">
      {valid ? `${describeTiming(formData)}.` : 'Pick a time and a timezone.'}
      {next !== null && <span className="text-gray-500">{` ${next}.`}</span>}
    </p>
  );
};

/**
 * When the schedule runs, as one row in reading order: repeat, day, time,
 * timezone. The timezone defaults to the browser's own; the summary under the
 * row says the result in words, with the next run.
 */
export const ScheduleTimingFields = ({
  formData, updateFormField
}: ScheduleTimingFieldsProps) => (
  <fieldset className="border-0 p-0 m-0">
    <legend className="block text-sm font-medium text-gray-900 mb-2">When</legend>
    <div className="flex flex-wrap items-start gap-3">
      <TimingField label="Repeat" htmlFor="schedule-frequency" className="w-36">
        <select id="schedule-frequency" name="schedule-frequency" value={formData.frequency}
          onChange={(e) => {
            if (isScheduleFrequency(e.target.value)) updateFormField('frequency', e.target.value);
          }}
          className={SCHEDULE_INPUT_CLASS}>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
      </TimingField>
      <DayField formData={formData} updateFormField={updateFormField} />
      <TimingField label="Time" htmlFor="schedule-time" className="w-32">
        <input id="schedule-time" name="schedule-time" type="time" value={formData.time}
          onChange={(e) => updateFormField('time', e.target.value)} className={SCHEDULE_INPUT_CLASS} />
      </TimingField>
      <TimingField label="Timezone" htmlFor="schedule-timezone" className="flex-1 min-w-[12rem]">
        <input id="schedule-timezone" name="schedule-timezone" type="text" list={TIMEZONE_LIST_ID}
          value={formData.timezone} placeholder="Europe/Madrid"
          onChange={(e) => updateFormField('timezone', e.target.value)} className={SCHEDULE_INPUT_CLASS} />
        <datalist id={TIMEZONE_LIST_ID}>
          {timezoneOptions(formData.timezone).map((zone) => <option key={zone} value={zone} />)}
        </datalist>
      </TimingField>
    </div>
    {formData.frequency === 'monthly' && (
      <p id="schedule-day-of-month-hint" className="mt-1 text-xs text-gray-500">
        {`Days after the ${MAX_DAY_OF_MONTH}th are left out so the schedule runs every month.`}
      </p>
    )}
    <TimingSummary formData={formData} />
  </fieldset>
);
