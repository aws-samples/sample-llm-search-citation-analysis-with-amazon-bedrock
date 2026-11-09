import {
  useState, useEffect 
} from 'react';
import {
  getErrorMessage, isAbortError 
} from '../../infrastructure';
import {
  createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule, type SchedulePayload
} from '../../api/executions';
import type {
  Keyword, Schedule, ScheduleFormData 
} from '../../types';
import { useAlertModal } from '../../hooks/useAlertModal';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import {
  ConfirmModal, AlertModal, Modal
} from '../ui/Modal';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';
import {
  ScheduleHeader, ScheduleList 
} from './ScheduleManagerComponents';
import {
  SCHEDULE_FORM_TITLE_ID, ScheduleForm, type ScheduleFormMode
} from './ScheduleForm';
import {
  defaultScheduleFormData, formDataFromSchedule, toSchedulePayload, validateScheduleFormData, withResolvedName
} from './scheduleFormModel';
import {
  kindOf, paidRunNotice
} from './scheduleKinds';
import { RankTrackerScheduleList } from './RankTrackerScheduleList';
import {
  PaidScheduleConfirm, type PaidConfirmation
} from './PaidScheduleConfirm';

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
  const [formError, setFormError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [paidConfirmation, setPaidConfirmation] = useState<PaidConfirmation | null>(null);
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();
  // Mutations are Admin-only server-side. The list is a read, so non-admins
  // keep visibility of what is scheduled.
  const {
    isAdmin, loading: adminLoading
  } = useIsAdmin();
  // Until the first answer the list is unknown, not empty: hold placeholder
  // rows rather than flashing "No schedules configured".
  const [listLoaded, setListLoaded] = useState(schedules.length > 0);
  const {
    activeKeywords, groups 
  } = useKeywordScopeOptions(keywords);

  // Load existing schedules on mount; previously the list was only refreshed
  // after creating a schedule, so it appeared empty on every fresh visit.
  useEffect(() => {
    const controller = new AbortController();
    fetchSchedules(controller.signal)
      .then((loaded) => {
        setSchedules(loaded);
        setListLoaded(true);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          console.error('Error loading schedules:', err);
          setListLoaded(true);
        }
      });
    return () => controller.abort();
  }, [setSchedules]);

  const openCreate = () => {
    setFormData(defaultScheduleFormData());
    setFormError(null);
    setEditor({ mode: 'create' });
  };

  const openEdit = (schedule: Schedule) => {
    setFormData(formDataFromSchedule(schedule));
    setFormError(null);
    setEditor({
      mode: 'edit',
      schedule 
    });
  };

  const closeEditor = () => setEditor(null);
  // Escape reaches every open dialog: while the paid confirmation is on top, it closes only that one.
  const dismissEditor = () => {
    if (paidConfirmation === null) closeEditor();
  };

  const refreshSchedules = async () => {
    setSchedules(await fetchSchedules());
  };

  /**
   * Saves `data` for `target`. `confirmed`: the Admin said yes to the paid
   * confirmation, which the API requires for a paid schedule. `quiet` skips
   * the success dialog (the row switch, whose new state is the feedback).
   */
  const persistSchedule = async (target: Editor, data: ScheduleFormData, confirmed = false, quiet = false) => {
    setSaving(true);
    try {
      const payload: SchedulePayload = confirmed
        ? {
          ...toSchedulePayload(data),
          confirm_paid: true,
        }
        : toSchedulePayload(data);
      if (target.mode === 'create') {
        await createSchedule(payload);
        showAlert('Success', 'Schedule created successfully', 'success');
      } else {
        await updateSchedule(target.schedule.id, payload);
        if (!quiet) showAlert('Success', 'Schedule updated successfully', 'success');
      }
      if (!quiet) closeEditor();
      await refreshSchedules();
    } catch (err) {
      console.error('Error saving schedule:', err);
      showAlert('Error', getErrorMessage(err, 'schedules'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Saves now, or first asks when an enabled paid schedule would start spending. */
  const saveWithConfirmation = (target: Editor, data: ScheduleFormData, quiet = false) => {
    const notice = paidRunNotice(data.kind);
    if (notice === null || !data.enabled) {
      void persistSchedule(target, data, false, quiet);
      return;
    }
    setPaidConfirmation({
      title: 'Save a paid schedule?',
      message: `"${data.display_name.trim()}" runs on its own until it is disabled or deleted. ${notice} Continue?`,
      confirmText: 'Save',
      action: () => persistSchedule(target, data, true, quiet),
    });
  };

  const saveSchedule = () => {
    if (editor === null) return;
    // A blank name takes the generated one the field shows as its placeholder.
    const data = withResolvedName(formData, groups);
    const problem = validateScheduleFormData(data);
    setFormError(problem);
    if (problem === null) saveWithConfirmation(editor, data);
  };

  /** The row switch: the stored schedule saved with only `enabled` changed. */
  const toggleEnabled = (schedule: Schedule, enabled: boolean) => {
    saveWithConfirmation({
      mode: 'edit',
      schedule,
    }, {
      ...formDataFromSchedule(schedule),
      enabled,
    }, true);
  };

  const startRun = async (schedule: Schedule, confirmed = false) => {
    setRunningId(schedule.id);
    try {
      const result = await runSchedule(schedule.id, confirmed);
      showAlert(kindOf(schedule) === 'analysis' ? 'Analysis started' : 'Snapshots started', result.message, 'success');
    } catch (err) {
      console.error('Error running schedule:', err);
      showAlert('Error', getErrorMessage(err, 'schedules'), 'error');
    } finally {
      setRunningId(null);
    }
  };

  const runNow = (schedule: Schedule) => {
    const notice = paidRunNotice(kindOf(schedule));
    if (notice === null) {
      void startRun(schedule);
      return;
    }
    setPaidConfirmation({
      title: 'Run now?',
      message: `${notice} Continue?`,
      confirmText: 'Run',
      action: () => startRun(schedule, true),
    });
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
    setFormError(null);
  };

  const formMode: ScheduleFormMode = editor?.mode === 'edit' ? 'edit' : 'create';
  const legacyNotice = editor?.mode === 'edit' && editor.schedule.legacy && editor.schedule.scope === null
    ? LEGACY_KEYWORDS_NOTICE
    : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ScheduleHeader onNew={openCreate} isAdmin={isAdmin} adminLoading={adminLoading}
        showNewButton={listLoaded && schedules.length > 0} />

      <Modal isOpen={isAdmin && editor !== null} onClose={dismissEditor} size="4xl" layout="flush"
        labelledBy={SCHEDULE_FORM_TITLE_ID}>
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
          error={formError}
        />
      </Modal>

      <ScheduleList
        loading={!listLoaded}
        schedules={schedules}
        groups={groups}
        onNew={openCreate}
        onEdit={openEdit}
        onToggle={toggleEnabled}
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

      <PaidScheduleConfirm pending={paidConfirmation} onClose={() => setPaidConfirmation(null)} />

      <RankTrackerScheduleList />

      <AlertModal {...alertModal} onClose={closeAlert} />
    </div>
  );
};
