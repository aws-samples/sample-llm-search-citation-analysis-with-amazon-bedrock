import type {
  KeywordGroup, Schedule 
} from '../../types';
import {
  describeScheduleScope, describeScheduleTiming 
} from './scheduleFormModel';
import {
  ClockIcon, PlusIcon, TrashIcon 
} from '../ui';

interface ScheduleHeaderProps {
  showForm: boolean;
  onNew: () => void;
  onCancel: () => void;
  /** POST /api/schedules is Admin-only, so non-admins get no create affordance. */
  isAdmin: boolean;
}

export const ScheduleHeader = ({
  showForm, onNew, onCancel, isAdmin 
}: ScheduleHeaderProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Automated Schedules</h2>
        <p className="text-sm text-gray-500 mt-0.5">Click a schedule to edit it. Group scopes are resolved when the schedule runs.</p>
      </div>
      {isAdmin && (
        <button
          onClick={showForm ? onCancel : onNew}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
            showForm
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-gray-900 text-white hover:bg-gray-800'
          }`}
        >
          {showForm ? 'Cancel' : <><PlusIcon className="w-4 h-4" /><span className="hidden sm:inline">New Schedule</span><span className="sm:hidden">New</span></>}
        </button>
      )}
    </div>
  </div>
);

interface ScheduleListProps {
  schedules: Schedule[];
  groups: KeywordGroup[];
  onEdit: (schedule: Schedule) => void;
  onRun: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  runningId: string | null;
  /** Reads stay open; edit, run and delete are Admin-only. */
  isAdmin: boolean;
}

export const ScheduleList = ({
  schedules, groups, onEdit, onRun, onDelete, runningId, isAdmin 
}: ScheduleListProps) => (
  <div className="p-4 sm:p-6">
    {schedules.length === 0 ? (
      <EmptyState isAdmin={isAdmin} />
    ) : (
      <div className="space-y-3">
        {schedules.map((schedule) => (
          <ScheduleItem
            key={schedule.id}
            schedule={schedule}
            groups={groups}
            onEdit={onEdit}
            onRun={onRun}
            onDelete={onDelete}
            running={runningId === schedule.id}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    )}
  </div>
);

const EmptyState = ({ isAdmin }: { isAdmin: boolean }) => (
  <div className="text-center py-12 text-gray-400">
    <ClockIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
    <p className="text-sm">No schedules configured</p>
    {/* "Create a schedule" would point a non-admin at a hidden button and a
        route that refuses them. */}
    <p className="text-xs mt-1">
      {isAdmin
        ? 'Create a schedule to run analysis automatically'
        : 'An administrator can add a schedule to run analysis automatically'}
    </p>
  </div>
);

interface ScheduleItemProps {
  schedule: Schedule;
  groups: KeywordGroup[];
  onEdit: (schedule: Schedule) => void;
  onRun: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  running: boolean;
  isAdmin: boolean;
}

/**
 * One schedule card. For admins the title is a button that opens the editor
 * (click-to-edit); run and delete sit beside it.
 */
const ScheduleItem = ({
  schedule, groups, onEdit, onRun, onDelete, running, isAdmin 
}: ScheduleItemProps) => (
  <div className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-gray-900 text-sm">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => onEdit(schedule)}
              className="text-left hover:underline focus:outline-none focus:ring-2 focus:ring-gray-900 rounded"
              aria-label={`Edit schedule ${schedule.display_name}`}
            >
              {schedule.display_name}
            </button>
          ) : schedule.display_name}
        </h3>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            schedule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {schedule.enabled ? 'Enabled' : 'Disabled'}
        </span>
        {schedule.legacy && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700" title="Created with the previous version; save it once to upgrade">
            Legacy
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-1">{describeScheduleTiming(schedule)}</p>
      <p className="text-xs text-gray-500 mt-1 truncate" title={describeScheduleScope(schedule.scope, groups, schedule.keywords)}>
        {describeScheduleScope(schedule.scope, groups, schedule.keywords)}
      </p>
    </div>
    {isAdmin && (
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onEdit(schedule)}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onRun(schedule)}
          disabled={running}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Run schedule ${schedule.display_name} now`}
        >
          {running ? 'Starting…' : 'Run now'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(schedule)}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          aria-label={`Delete schedule ${schedule.display_name}`}
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>
    )}
  </div>
);
