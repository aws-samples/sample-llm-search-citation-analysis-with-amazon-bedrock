import type {
  AnalysisScope, Keyword, KeywordGroup, ScheduleFormData
} from '../../types';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import {
  DAYS_OF_WEEK, MAX_DAY_OF_MONTH, isScheduleFrequency, timezoneOptions
} from './scheduleFormModel';

export type ScheduleFormMode = 'create' | 'edit';

interface ScheduleFormProps {
  mode: ScheduleFormMode;
  formData: ScheduleFormData;
  updateFormField: <K extends keyof ScheduleFormData>(field: K, value: ScheduleFormData[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Active keywords for the "specific keywords" scope. */
  keywords: Keyword[];
  groups: KeywordGroup[];
  /** Shown when editing a schedule from before 2.3.0 whose keyword texts cannot be mapped to a scope. */
  legacyNotice?: string | null;
}

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900';
const TIMEZONE_LIST_ID = 'schedule-timezone-options';

/**
 * Create / edit form for a schedule. The same form serves both modes: the
 * caller pre-fills `formData` from the schedule being edited and saves with
 * PUT instead of POST.
 */
export const ScheduleForm = ({
  mode, formData, updateFormField, onSubmit, onCancel, saving, keywords, groups, legacyNotice = null
}: ScheduleFormProps) => (
  <form
    className="p-4 sm:p-6 border-b border-gray-200 bg-gray-50"
    aria-label={mode === 'create' ? 'Create schedule' : 'Edit schedule'}
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <h3 className="font-medium text-gray-900 mb-4">{mode === 'create' ? 'Create New Schedule' : `Edit "${formData.display_name}"`}</h3>
    {legacyNotice && (
      <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{legacyNotice}</p>
    )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormField label="Schedule name" htmlFor="schedule-display-name">
        <input
          id="schedule-display-name"
          name="schedule-display-name"
          type="text"
          value={formData.display_name}
          maxLength={100}
          placeholder={'e.g. Weekly brand analysis'}
          onChange={(e) => updateFormField('display_name', e.target.value)}
          className={INPUT_CLASS}
        />
      </FormField>
      <FormField label="Frequency" htmlFor="schedule-frequency">
        <select
          id="schedule-frequency"
          name="schedule-frequency"
          value={formData.frequency}
          onChange={(e) => {
            if (isScheduleFrequency(e.target.value)) updateFormField('frequency', e.target.value);
          }}
          className={INPUT_CLASS}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </FormField>
      <FormField label="Time" htmlFor="schedule-time">
        <input
          id="schedule-time"
          name="schedule-time"
          type="time"
          value={formData.time}
          onChange={(e) => updateFormField('time', e.target.value)}
          className={INPUT_CLASS}
        />
      </FormField>
      <FormField label="Timezone" htmlFor="schedule-timezone">
        <input
          id="schedule-timezone"
          name="schedule-timezone"
          type="text"
          list={TIMEZONE_LIST_ID}
          value={formData.timezone}
          placeholder="Europe/Madrid"
          onChange={(e) => updateFormField('timezone', e.target.value)}
          className={INPUT_CLASS}
        />
        <datalist id={TIMEZONE_LIST_ID}>
          {timezoneOptions(formData.timezone).map((zone) => <option key={zone} value={zone} />)}
        </datalist>
      </FormField>
      {formData.frequency === 'weekly' && (
        <FormField label="Day of week" htmlFor="schedule-day-of-week">
          <select
            id="schedule-day-of-week"
            name="schedule-day-of-week"
            value={formData.day_of_week}
            onChange={(e) => updateFormField('day_of_week', e.target.value)}
            className={INPUT_CLASS}
          >
            {DAYS_OF_WEEK.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </select>
        </FormField>
      )}
      {formData.frequency === 'monthly' && (
        <FormField label={`Day of month (1-${MAX_DAY_OF_MONTH})`} htmlFor="schedule-day-of-month">
          <input
            id="schedule-day-of-month"
            name="schedule-day-of-month"
            type="number"
            min="1"
            max={MAX_DAY_OF_MONTH}
            value={formData.day_of_month}
            onChange={(e) => updateFormField('day_of_month', e.target.value)}
            className={INPUT_CLASS}
          />
        </FormField>
      )}
      <div className="sm:col-span-2">
        <label
          htmlFor="schedule-enabled"
          className="flex items-center gap-2 text-sm text-gray-700"
        >
          <input
            id="schedule-enabled"
            name="schedule-enabled"
            type="checkbox"
            checked={formData.enabled}
            onChange={(e) => updateFormField('enabled', e.target.checked)}
          />
          Enabled (a disabled schedule keeps its settings but never runs)
        </label>
      </div>
      <ScheduleScopeField
        scope={formData.scope}
        onChange={(scope) => updateFormField('scope', scope)}
        keywords={keywords}
        groups={groups}
      />
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitLabel(mode, saving)}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 bg-white text-gray-700 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
      >
        Cancel
      </button>
    </div>
  </form>
);

function submitLabel(mode: ScheduleFormMode, saving: boolean): string {
  if (saving) return 'Saving…';
  return mode === 'create' ? 'Create Schedule' : 'Save Changes';
}

const FormField = ({
  label, htmlFor, children
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode
}) => (
  <div>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
);

type ScopeMode = AnalysisScope['mode'];

interface ScheduleScopeFieldProps {
  scope: AnalysisScope;
  onChange: (scope: AnalysisScope) => void;
  keywords: Keyword[];
  groups: KeywordGroup[];
}

function scopeForMode(mode: ScopeMode, previous: AnalysisScope): AnalysisScope {
  if (mode === 'groups') return {
    mode,
    group_ids: previous.mode === 'groups' ? previous.group_ids : []
  };
  if (mode === 'keywords') return {
    mode,
    keyword_ids: previous.mode === 'keywords' ? previous.keyword_ids : []
  };
  return { mode: 'all' };
}

/**
 * What the schedule runs: every active keyword, whole keyword groups, or a
 * hand-picked set. Groups are resolved when the schedule fires, so keywords
 * added to a group later are included automatically.
 */
const ScheduleScopeField = ({
  scope, onChange, keywords, groups
}: ScheduleScopeFieldProps) => {
  const options: {
    mode: ScopeMode;
    label: string;
    hint: string
  }[] = [
    {
      mode: 'all',
      label: 'All keywords',
      hint: 'every active keyword at run time'
    },
    {
      mode: 'groups',
      label: 'Keyword groups',
      hint: 'whatever is in the selected groups when it runs'
    },
    {
      mode: 'keywords',
      label: 'Specific keywords',
      hint: 'a fixed selection'
    },
  ];

  return (
    <fieldset className="sm:col-span-2">
      <legend className="block text-sm font-medium text-gray-700 mb-1">Keywords to analyse</legend>
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const optionId = `schedule-scope-mode-${option.mode}`;
          return (
            <label
              key={option.mode}
              htmlFor={optionId}
              className="flex items-center gap-2 text-sm text-gray-700"
            >
              <input
                id={optionId}
                type="radio"
                name="schedule-scope-mode"
                value={option.mode}
                checked={scope.mode === option.mode}
                onChange={() => onChange(scopeForMode(option.mode, scope))}
              />
              {option.label}
              <span className="text-xs text-gray-500">({option.hint})</span>
            </label>
          );
        })}
      </div>
      {scope.mode === 'groups' && (
        <GroupPicker
          groups={groups}
          selectedIds={scope.group_ids}
          onChange={(groupIds) => onChange({
            mode: 'groups',
            group_ids: groupIds
          })}
        />
      )}
      {scope.mode === 'keywords' && (
        <div className="mt-2">
          <KeywordScopePicker
            idPrefix="schedule-keyword-scope"
            name="schedule-keyword-ids"
            keywords={keywords}
            groups={groups}
            selectedIds={scope.keyword_ids}
            onChange={(keywordIds) => onChange({
              mode: 'keywords',
              keyword_ids: keywordIds
            })}
          />
        </div>
      )}
    </fieldset>
  );
};

interface GroupPickerProps {
  groups: KeywordGroup[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const GroupPicker = ({
  groups, selectedIds, onChange
}: GroupPickerProps) => {
  if (groups.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-600">
        No keyword groups yet. Create them in Settings → Keywords first.
      </p>
    );
  }

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
  };

  return (
    <div className="mt-2">
      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {groups.map((group) => {
          const groupId = `schedule-group-${group.id}`;
          return (
            <label
              key={group.id}
              htmlFor={groupId}
              className="flex items-center gap-2 text-sm text-gray-700 py-0.5"
            >
              <input
                id={groupId}
                name="schedule-group-ids"
                value={group.id}
                type="checkbox"
                checked={selectedIds.includes(group.id)}
                onChange={() => toggle(group.id)}
                aria-label={`Include group ${group.name}`}
              />
              <span className="truncate">{group.name}</span>
              <span className="text-xs text-gray-400">({group.keyword_count})</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-500">{selectedIds.length} group(s) selected</p>
    </div>
  );
};
