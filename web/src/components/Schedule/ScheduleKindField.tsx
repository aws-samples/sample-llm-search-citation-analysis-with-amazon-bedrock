import { isSeoApiConfigured } from '../../api/seo';
import type {
  ScheduleFormData, ScheduleKind
} from '../../types';
import type { UpdateScheduleField } from './scheduleFormModel';
import {
  SCHEDULE_KINDS, paidRunNotice, scheduleKindInfo, type ScheduleKindInfo
} from './scheduleKinds';

interface ScheduleKindFieldProps {
  /** A schedule keeps its kind, so editing shows it without a choice. */
  editable: boolean;
  formData: ScheduleFormData;
  updateFormField: UpdateScheduleField;
}

const CARD_BASE = 'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors';
const CARD_SELECTED = 'border-gray-900 ring-1 ring-gray-900 dark:border-gray-100 dark:ring-gray-100';
const CARD_IDLE = 'border-gray-200 hover:bg-gray-50';

/** The paid note of a snapshot kind: its calls per run and where its domains come from. */
function paidNote(kind: ScheduleKind): string | null {
  const notice = paidRunNotice(kind);
  return notice === null ? null : `${notice} The domains come from Settings › Brand tracking.`;
}

const KindCard = ({
  info, checked, onChoose
}: {
  readonly info: ScheduleKindInfo;
  readonly checked: boolean;
  readonly onChoose: (kind: ScheduleKind) => void;
}) => {
  const optionId = `schedule-kind-${info.kind}`;
  return (
    <label htmlFor={optionId} className={`${CARD_BASE} ${checked ? CARD_SELECTED : CARD_IDLE}`}>
      <input
        id={optionId}
        type="radio"
        name="schedule-kind"
        value={info.kind}
        checked={checked}
        onChange={() => onChoose(info.kind)}
        aria-describedby={`${optionId}-description`}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-gray-900">
          {info.label}
          {info.paidCalls !== null && <span className="text-xs font-medium text-amber-700">Paid</span>}
        </span>
        <span id={`${optionId}-description`} className="block text-xs text-gray-500 mt-0.5">{info.description}</span>
      </span>
    </label>
  );
};

/**
 * What the schedule starts, asked first. The snapshot kinds are offered only
 * where the SEO stack is deployed (the API also refuses them otherwise), so
 * without it there is nothing to choose and nothing is shown. Picking a
 * snapshot kind moves a daily schedule to weekly: every run is paid.
 */
export const ScheduleKindField = ({
  editable, formData, updateFormField
}: ScheduleKindFieldProps) => {
  if (!editable) {
    const note = paidNote(formData.kind);
    return (
      <div>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-gray-900">Runs: </span>
          <span id="schedule-kind">{scheduleKindInfo(formData.kind).label}</span>
        </p>
        {note !== null && <p className="mt-1 text-xs text-amber-700">{note}</p>}
      </div>
    );
  }
  const offered = SCHEDULE_KINDS.filter((info) => info.paidCalls === null || isSeoApiConfigured());
  if (offered.length === 1) return null;
  const note = paidNote(formData.kind);
  const choose = (kind: ScheduleKind) => {
    if (kind !== 'analysis' && formData.frequency === 'daily') updateFormField('frequency', 'weekly');
    updateFormField('kind', kind);
  };
  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="block text-sm font-medium text-gray-900 mb-2">What to run</legend>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {offered.map((info) => (
          <KindCard key={info.kind} info={info} checked={formData.kind === info.kind} onChoose={choose} />
        ))}
      </div>
      {note !== null && <p className="mt-2 text-xs text-amber-700" aria-live="polite">{note}</p>}
    </fieldset>
  );
};
