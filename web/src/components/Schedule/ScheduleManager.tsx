import {
  useState, useEffect 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, isAbortError 
} from '../../infrastructure';
import { fetchSchedules } from '../../api/executions';
import type {
  Keyword, Schedule, ScheduleFormData 
} from '../../types';
import { useAlertModal } from '../../hooks/useAlertModal';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import {
  ConfirmModal, AlertModal 
} from '../ui/Modal';
import {
  ScheduleHeader, ScheduleForm, ScheduleList, type KeywordScope 
} from './ScheduleManagerComponents';

interface ScheduleManagerProps {
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
  keywords: Keyword[];
}

interface ScheduleResponse {
  schedules?: Schedule[];
  error?: string;
}

function isScheduleResponse(value: unknown): value is ScheduleResponse {
  return value !== null && typeof value === 'object';
}

export const ScheduleManager = ({
  schedules, setSchedules, keywords 
}: ScheduleManagerProps) => {
  const [showForm, setShowForm] = useState(false);
  const [keywordScope, setKeywordScope] = useState<KeywordScope>('all');
  const [formData, setFormData] = useState<ScheduleFormData>({
    name: 'daily-analysis',
    frequency: 'daily',
    time: '09:00',
    timezone: 'UTC',
    day_of_week: 'MON',
    day_of_month: '1',
    enabled: true,
    keywords: [],
  });

  // Load existing schedules on mount; previously the list was only refreshed
  // after creating a schedule, so it appeared empty on every fresh visit.
  useEffect(() => {
    const controller = new AbortController();
    fetchSchedules(controller.signal)
      .then(setSchedules)
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          console.error('Error loading schedules:', err);
        }
      });
    return () => controller.abort();
  }, [setSchedules]);

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    scheduleName: string 
  }>({
    isOpen: false,
    scheduleName: '',
  });
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();
  // POST and DELETE /api/schedules are Admin-only server-side. The list is a
  // read, so non-admins keep visibility of what is scheduled.
  const { isAdmin } = useIsAdmin();

  const createSchedule = async () => {
    const selectedKeywords = keywordScope === 'selected' ? formData.keywords : [];
    if (keywordScope === 'selected' && selectedKeywords.length === 0) {
      showAlert('Error', 'Select at least one keyword for this schedule', 'error');
      return;
    }

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          keywords: selectedKeywords,
        }),
      });

      const json: unknown = await response.json();
      const data: ScheduleResponse = isScheduleResponse(json) ? json : {};

      if (response.ok) {
        showAlert('Success', 'Schedule created successfully', 'success');
        setShowForm(false);
        setKeywordScope('all');
        setFormData((prev) => ({
          ...prev,
          keywords: [],
        }));
        setSchedules(await fetchSchedules());
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
      const response = await authenticatedFetch(
        `${API_BASE_URL}/schedules/${name}`, { method: 'DELETE' }
      );

      // The response was previously ignored entirely, so any failure — most
      // reachably a 403 from the Admin gate — reported "Schedule deleted" and
      // dropped the row from local state, only for it to return on reload.
      if (!response.ok) {
        const json: unknown = await response.json().catch(() => ({}));
        const data: ScheduleResponse = isScheduleResponse(json) ? json : {};
        showAlert('Error', data.error ?? 'Failed to delete schedule', 'error');
        return;
      }

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

  const toggleKeyword = (keyword: string) => {
    const nextKeywords = formData.keywords.includes(keyword)
      ? formData.keywords.filter((selected) => selected !== keyword)
      : [...formData.keywords, keyword];
    updateFormField('keywords', nextKeywords);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ScheduleHeader showForm={showForm} setShowForm={setShowForm} isAdmin={isAdmin} />

      {isAdmin && showForm && (
        <ScheduleForm
          formData={formData}
          updateFormField={updateFormField}
          onSubmit={createSchedule}
          availableKeywords={keywords}
          keywordScope={keywordScope}
          onScopeChange={setKeywordScope}
          onToggleKeyword={toggleKeyword}
        />
      )}

      <ScheduleList
        schedules={schedules}
        onDelete={(name) => setDeleteModal({
          isOpen: true,
          scheduleName: name 
        })}
        isAdmin={isAdmin}
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
        onClose={closeAlert}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  );
};
