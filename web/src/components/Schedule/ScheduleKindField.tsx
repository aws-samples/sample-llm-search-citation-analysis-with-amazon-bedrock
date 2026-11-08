import type { ScheduleFormData } from '../../types';
import type { UpdateScheduleField } from './scheduleFormModel';
import {
  SCHEDULE_KINDS, isScheduleKind, paidRunNotice, scheduleKindInfo
} from './scheduleKinds';

interface ScheduleKindFieldProps {
  /** A schedule keeps its kind, so editing shows it without a picker. */
  editable: boolean;
  formData: ScheduleFormData;
  updateFormField: UpdateScheduleField;
  inputClassName: string;
}

/**
 * What the schedule starts. Picking a snapshot kind names it after the kind
 * while the name is still empty or another kind's default, and shows the
 * paid calls of one run.
 */
export const ScheduleKindField = ({
  editable, formData, updateFormField, inputClassName
}: ScheduleKindFieldProps) => {
  const notice = paidRunNotice(formData.kind);
  const choose = (value: string) => {
    if (!isScheduleKind(value)) return;
    const name = formData.display_name.trim();
    if (name === '' || name === scheduleKindInfo(formData.kind).defaultName) {
      updateFormField('display_name', scheduleKindInfo(value).defaultName);
    }
    updateFormField('kind', value);
  };
  return (
    <div className="sm:col-span-2">
      <label htmlFor="schedule-kind" className="block text-sm font-medium text-gray-700 mb-1">Runs</label>
      {editable ? (
        <select id="schedule-kind" name="schedule-kind" value={formData.kind}
          onChange={(e) => choose(e.target.value)} className={inputClassName}>
          {SCHEDULE_KINDS.map((info) => (
            <option key={info.kind} value={info.kind}>{info.paidCalls === null ? info.label : `${info.label} (paid)`}</option>
          ))}
        </select>
      ) : (
        <p id="schedule-kind" className="text-sm text-gray-900">{scheduleKindInfo(formData.kind).label}</p>
      )}
      {notice !== null && (
        <p className="mt-1 text-xs text-amber-700">
          {`${notice} Snapshots cover every owned and competitor domain of Settings > Brand Tracking.`}
        </p>
      )}
    </div>
  );
};
