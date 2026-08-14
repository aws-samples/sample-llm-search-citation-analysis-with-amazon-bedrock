import type {
  Keyword, Schedule, ScheduleFormData 
} from '../../types';

export type KeywordScope = 'all' | 'selected';

interface ScheduleHeaderProps {
  showForm: boolean;
  setShowForm: (value: boolean) => void;
}

export const ScheduleHeader = ({
  showForm, setShowForm 
}: ScheduleHeaderProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
      <h2 className="text-lg font-semibold text-gray-900">Automated Schedules</h2>
      <button
        onClick={() => setShowForm(!showForm)}
        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
          showForm
            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            : 'bg-gray-900 text-white hover:bg-gray-800'
        }`}
      >
        {showForm ? 'Cancel' : <><PlusIcon /><span className="hidden sm:inline">New Schedule</span><span className="sm:hidden">New</span></>}
      </button>
    </div>
  </div>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
  </svg>
);

interface KeywordScopeFieldProps {
  availableKeywords: Keyword[];
  keywordScope: KeywordScope;
  selectedKeywords: string[];
  onScopeChange: (scope: KeywordScope) => void;
  onToggleKeyword: (keyword: string) => void;
}

const KeywordScopeField = ({
  availableKeywords, keywordScope, selectedKeywords, onScopeChange, onToggleKeyword 
}: KeywordScopeFieldProps) => (
  <div className="sm:col-span-2">
    <FormField label="Keywords">
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="keyword-scope"
            checked={keywordScope === 'all'}
            onChange={() => onScopeChange('all')}
          />
          All keywords (uses the active keyword list at run time)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="keyword-scope"
            checked={keywordScope === 'selected'}
            onChange={() => onScopeChange('selected')}
          />
          Specific keywords
        </label>
      </div>
    </FormField>
    {keywordScope === 'selected' && (
      <KeywordPicker
        availableKeywords={availableKeywords}
        selectedKeywords={selectedKeywords}
        onToggleKeyword={onToggleKeyword}
      />
    )}
  </div>
);

interface KeywordPickerProps {
  availableKeywords: Keyword[];
  selectedKeywords: string[];
  onToggleKeyword: (keyword: string) => void;
}

const KeywordPicker = ({
  availableKeywords, selectedKeywords, onToggleKeyword 
}: KeywordPickerProps) => {
  if (availableKeywords.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-600">
        No keywords available yet. Add keywords in Settings first.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {availableKeywords.map((keyword) => (
          <label key={keyword.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5">
            <input
              type="checkbox"
              checked={selectedKeywords.includes(keyword.keyword)}
              onChange={() => onToggleKeyword(keyword.keyword)}
            />
            <span className="truncate">{keyword.keyword}</span>
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">{selectedKeywords.length} keyword(s) selected</p>
    </div>
  );
};

interface ScheduleFormProps {
  formData: ScheduleFormData;
  updateFormField: <K extends keyof ScheduleFormData>(field: K, value: ScheduleFormData[K]) => void;
  onSubmit: () => void;
  availableKeywords: Keyword[];
  keywordScope: KeywordScope;
  onScopeChange: (scope: KeywordScope) => void;
  onToggleKeyword: (keyword: string) => void;
}

export const ScheduleForm = ({
  formData, updateFormField, onSubmit, availableKeywords, keywordScope, onScopeChange, onToggleKeyword 
}: ScheduleFormProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200 bg-gray-50">
    <h3 className="font-medium text-gray-900 mb-4">Create New Schedule</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormField label="Schedule Name">
        <input
          type="text"
          value={formData.name}
          onChange={(e) => updateFormField('name', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </FormField>
      <FormField label="Frequency">
        <select
          value={formData.frequency}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'daily' || value === 'weekly' || value === 'monthly') {
              updateFormField('frequency', value);
            }
          }}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </FormField>
      <FormField label="Time">
        <input
          type="time"
          value={formData.time}
          onChange={(e) => updateFormField('time', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </FormField>
      <FormField label="Timezone">
        <select
          value={formData.timezone}
          onChange={(e) => updateFormField('timezone', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="UTC">UTC</option>
          <option value="America/New_York">Eastern Time</option>
          <option value="America/Chicago">Central Time</option>
          <option value="America/Denver">Mountain Time</option>
          <option value="America/Los_Angeles">Pacific Time</option>
          <option value="Europe/London">London</option>
          <option value="Europe/Paris">Paris</option>
        </select>
      </FormField>
      {formData.frequency === 'weekly' && (
        <FormField label="Day of Week">
          <select
            value={formData.day_of_week}
            onChange={(e) => updateFormField('day_of_week', e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="MON">Monday</option>
            <option value="TUE">Tuesday</option>
            <option value="WED">Wednesday</option>
            <option value="THU">Thursday</option>
            <option value="FRI">Friday</option>
            <option value="SAT">Saturday</option>
            <option value="SUN">Sunday</option>
          </select>
        </FormField>
      )}
      {formData.frequency === 'monthly' && (
        <FormField label="Day of Month">
          <input
            type="number"
            min="1"
            max="31"
            value={formData.day_of_month}
            onChange={(e) => updateFormField('day_of_month', e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </FormField>
      )}
      <KeywordScopeField
        availableKeywords={availableKeywords}
        keywordScope={keywordScope}
        selectedKeywords={formData.keywords}
        onScopeChange={onScopeChange}
        onToggleKeyword={onToggleKeyword}
      />
    </div>
    <button
      onClick={onSubmit}
      className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
    >
      Create Schedule
    </button>
  </div>
);

const FormField = ({
  label, children 
}: {
  label: string;
  children: React.ReactNode 
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
);

interface ScheduleListProps {
  schedules: Schedule[];
  onDelete: (name: string) => void;
}

export const ScheduleList = ({
  schedules, onDelete 
}: ScheduleListProps) => (
  <div className="p-4 sm:p-6">
    {schedules.length === 0 ? (
      <EmptyState />
    ) : (
      <div className="space-y-3">
        {schedules.map((schedule) => (
          <ScheduleItem key={schedule.name} schedule={schedule} onDelete={onDelete} />
        ))}
      </div>
    )}
  </div>
);

const EmptyState = () => (
  <div className="text-center py-12 text-gray-400">
    <ClockIcon />
    <p className="text-sm">No schedules configured</p>
    <p className="text-xs mt-1">Create a schedule to run analysis automatically</p>
  </div>
);

const ClockIcon = () => (
  <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

interface ScheduleItemProps {
  schedule: Schedule;
  onDelete: (name: string) => void;
}

const ScheduleScope = ({ keywords }: { keywords?: string[] }) => {
  if (!keywords || keywords.length === 0) {
    return <p className="text-xs text-gray-500 mt-1">Runs all active keywords</p>;
  }
  return (
    <p className="text-xs text-gray-500 mt-1 truncate" title={keywords.join(', ')}>
      Runs {keywords.length} keyword(s): {keywords.join(', ')}
    </p>
  );
};

const ScheduleItem = ({
  schedule, onDelete 
}: ScheduleItemProps) => (
  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-3">
        <h3 className="font-medium text-gray-900 text-sm">{schedule.name}</h3>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            schedule.state === 'ENABLED'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {schedule.state}
        </span>
      </div>
      <p className="text-sm text-gray-500 mt-1">{schedule.schedule}</p>
      <ScheduleScope keywords={schedule.keywords} />
      <p className="text-xs text-gray-400 mt-0.5">{schedule.timezone}</p>
    </div>
    <button
      onClick={() => onDelete(schedule.name)}
      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
    >
      <TrashIcon />
    </button>
  </div>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
