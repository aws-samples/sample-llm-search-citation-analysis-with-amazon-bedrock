import {
  useState, useEffect 
} from 'react';
import {
  getErrorMessage, isAbortError 
} from '../../infrastructure';
import {
  createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule 
} from '../../api/executions';
import type {
  Keyword, Schedule, ScheduleFormData 
} from '../../types';
import { useAlertModal } from '../../hooks/useAlertModal';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import {
  ConfirmModal, AlertModal 
} from '../ui/Modal';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';
import {
  ScheduleHeader, ScheduleList 
} from './ScheduleManagerComponents';
import {
  ScheduleForm, type ScheduleFormMode 
} from './ScheduleForm';
import {
  defaultScheduleFormData, formDataFromSchedule, toSchedulePayload, validateScheduleFormData 
} from './scheduleFormModel';

interface ScheduleManagerProps {
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
  keywords: Keyword[];
}

type Editor =
  | { mode: 'create' }
  | {
    mode: 'edit';
    schedule: Schedule 
  };

const LEGACY_KEYWORDS_NOTICE =
  'This schedule was created with the previous version and listed its keywords by text. Choose its keywords again below; saving upgrades it in place.';

export const ScheduleManager = ({
  schedules, setSchedules, keywords 
}: ScheduleManagerProps) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formData, setFormData] = useState<ScheduleFormData>(defaultScheduleFormData);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();
  // Mutations are Admin-only server-side. The list is a read, so non-admins
  // keep visibility of what is scheduled.
  const { isAdmin } = useIsAdmin();
  const {
    activeKeywords, groups 
  } = useKeywordScopeOptions(keywords);

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

  const openCreate = () => {
    setFormData(defaultScheduleFormData());
    setEditor({ mode: 'create' });
  };

  const openEdit = (schedule: Schedule) => {
    setFormData(formDataFromSchedule(schedule));
    setEditor({
      mode: 'edit',
      schedule 
    });
  };

  const closeEditor = () => setEditor(null);

  const refreshSchedules = async () => {
    setSchedules(await fetchSchedules());
  };

  const saveSchedule = async () => {
    if (editor === null) return;
    const problem = validateScheduleFormData(formData);
    if (problem !== null) {
      showAlert('Check the form', problem, 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = toSchedulePayload(formData);
      if (editor.mode === 'create') {
        await createSchedule(payload);
        showAlert('Success', 'Schedule created successfully', 'success');
      } else {
        await updateSchedule(editor.schedule.id, payload);
        showAlert('Success', 'Schedule updated successfully', 'success');
      }
      closeEditor();
      await refreshSchedules();
    } catch (err) {
      console.error('Error saving schedule:', err);
      showAlert('Error', getErrorMessage(err, 'schedules'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (schedule: Schedule) => {
    setRunningId(schedule.id);
    try {
      const result = await runSchedule(schedule.id);
      showAlert('Analysis started', result.message, 'success');
    } catch (err) {
      console.error('Error running schedule:', err);
      showAlert('Error', getErrorMessage(err, 'schedules'), 'error');
    } finally {
      setRunningId(null);
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    try {
      // The response used to be ignored entirely, so any failure — most
      // reachably a 403 from the Admin gate — reported "Schedule deleted" and
      // dropped the row from local state, only for it to return on reload.
      await deleteSchedule(target.id);
      setSchedules(schedules.filter((schedule) => schedule.id !== target.id));
      if (editor?.mode === 'edit' && editor.schedule.id === target.id) closeEditor();
      showAlert('Success', 'Schedule deleted', 'success');
    } catch (err) {
      console.error('Error deleting schedule:', err);
      showAlert('Error', getErrorMessage(err, 'schedules'), 'error');
    }
  };

  const updateFormField = <K extends keyof ScheduleFormData>(
    field: K,
    value: ScheduleFormData[K]
  ) => {
    setFormData((previous) => ({
      ...previous,
      [field]: value 
    }));
  };

  const formMode: ScheduleFormMode = editor?.mode === 'edit' ? 'edit' : 'create';
  const legacyNotice = editor?.mode === 'edit' && editor.schedule.legacy && editor.schedule.scope === null
    ? LEGACY_KEYWORDS_NOTICE
    : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ScheduleHeader showForm={editor !== null} onNew={openCreate} onCancel={closeEditor} isAdmin={isAdmin} />

      {isAdmin && editor !== null && (
        <ScheduleForm
          mode={formMode}
          formData={formData}
          updateFormField={updateFormField}
          onSubmit={saveSchedule}
          onCancel={closeEditor}
          saving={saving}
          keywords={activeKeywords}
          groups={groups}
          legacyNotice={legacyNotice}
        />
      )}

      <ScheduleList
        schedules={schedules}
        groups={groups}
        onEdit={openEdit}
        onRun={runNow}
        onDelete={setDeleteTarget}
        runningId={runningId}
        isAdmin={isAdmin}
      />

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Schedule"
        message={`Delete schedule "${deleteTarget?.display_name ?? ''}"?`}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <AlertModal {...alertModal} onClose={closeAlert} />
    </div>
  );
};
