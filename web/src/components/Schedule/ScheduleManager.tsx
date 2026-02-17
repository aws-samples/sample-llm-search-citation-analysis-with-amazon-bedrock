import { useState } from 'react';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import type {
  Schedule, ScheduleFormData 
} from '../../types';
import {
  ConfirmModal, AlertModal 
} from '../ui/Modal';

interface ScheduleManagerProps {
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
}

interface ScheduleResponse {
  schedules?: Schedule[];
  error?: string;
}

function isScheduleResponse(value: unknown): value is ScheduleResponse {
  return value !== null && typeof value === 'object';
}

interface AlertState {
  isOpen: boolean;
  title: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

export const ScheduleManager = ({
  schedules, setSchedules 
}: ScheduleManagerProps) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<ScheduleFormData>({
    name: 'daily-analysis',
    frequency: 'daily',
    time: '09:00',
    timezone: 'UTC',
    day_of_week: 'MON',
    day_of_month: '1',
    enabled: true,
  });

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    scheduleName: string 
  }>({
    isOpen: false,
    scheduleName: '',
  });
  const [alertModal, setAlertModal] = useState<AlertState>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const showAlert = (title: string, message: string, variant: AlertState['variant']) => {
    setAlertModal({
      isOpen: true,
      title,
      message,
      variant 
    });
  };

  const createSchedule = async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const json: unknown = await response.json();
      const data: ScheduleResponse = isScheduleResponse(json) ? json : {};

      if (response.ok) {
        showAlert('Success', 'Schedule created successfully', 'success');
        setShowForm(false);
        const refreshResponse = await authenticatedFetch(`${API_BASE_URL}/schedules`);
        const refreshJson: unknown = await refreshResponse.json();
        const refreshData: ScheduleResponse = isScheduleResponse(refreshJson) ? refreshJson : {};
        setSchedules(refreshData.schedules ?? []);
      } else {
        showAlert('Error', data.error ?? 'Failed to create schedule', 'error');
      }
    } catch (err) {
      console.error('Error creating schedule:', err);
      showAlert('Error', 'Failed to create schedule', 'error');
    }
  };

  const confirmDeleteSchedule = async () => {
    const name = deleteModal.scheduleName;
    try {
      await authenticatedFetch(`${API_BASE_URL}/schedules/${name}`, { method: 'DELETE' });
      setSchedules(schedules.filter((s) => s.name !== name));
      showAlert('Success', 'Schedule deleted', 'success');
    } catch (err) {
      console.error('Error deleting schedule:', err);
      showAlert('Error', 'Failed to delete schedule', 'error');
    }
  };

  const updateFormField = <K extends keyof ScheduleFormData>(
    field: K,
    value: ScheduleFormData[K]
  ) => {
    setFormData({
      ...formData,
      [field]: value 
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ScheduleHeader showForm={showForm} setShowForm={setShowForm} />

      {showForm && (
        <ScheduleForm
          formData={formData}
          updateFormField={updateFormField}
          onSubmit={createSchedule}
        />
      )}

      <ScheduleList
        schedules={schedules}
        onDelete={(name) => setDeleteModal({
          isOpen: true,
          scheduleName: name 
        })}
      />

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({
          isOpen: false,
          scheduleName: '' 
        })}
        onConfirm={confirmDeleteSchedule}
        title="Delete Schedule"
        message={`Delete schedule "${deleteModal.scheduleName}"?`}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal({
          ...alertModal,
          isOpen: false 
        })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  );
};

interface ScheduleHeaderProps {
  showForm: boolean;
  setShowForm: (value: boolean) => void;
}

const ScheduleHeader = ({
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

interface ScheduleFormProps {
  formData: ScheduleFormData;
  updateFormField: <K extends keyof ScheduleFormData>(field: K, value: ScheduleFormData[K]) => void;
  onSubmit: () => void;
}

const ScheduleForm = ({
  formData, updateFormField, onSubmit 
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

const ScheduleList = ({
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

const ScheduleItem = ({
  schedule, onDelete 
}: ScheduleItemProps) => (
  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
    <div className="flex-1">
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
