import type {
  KeywordGroup, Schedule
} from '../../types';
import {
  describeScheduleScope, describeScheduleTiming
} from './scheduleFormModel';
import { describeNextRun } from './scheduleNextRun';
import {
  ClockIcon, PlusIcon
} from '../ui';
import { Button } from '../ui/Button';
import { ActionMenu } from '../ui/ActionMenu';
import { Skeleton } from '../ui/Skeleton';
import { ConfigListExport } from '../ui/ConfigListExport';
import { ScheduleListSkeleton } from './ScheduleListSkeleton';
import { ScheduleSwitch } from './ScheduleSwitch';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import {
  kindOf, scheduleKindInfo
} from './scheduleKinds';

interface ScheduleHeaderProps {
  onNew: () => void;
  /** POST /api/schedules is Admin-only, so non-admins get no create affordance. */
  isAdmin: boolean;
  /** Membership is still being read; the button's place is held so the header does not grow. */
  adminLoading?: boolean;
  /** The empty state carries the only New schedule button, so the header leaves it out. */
  showNewButton?: boolean;
}

const NewScheduleButton = ({ onNew }: Pick<ScheduleHeaderProps, 'onNew'>) => (
  <Button onClick={onNew} leadingIcon={<PlusIcon className="w-4 h-4" />}>New schedule</Button>
);

export const ScheduleHeader = ({
  onNew, isAdmin, adminLoading = false, showNewButton = true
}: ScheduleHeaderProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Schedules</h2>
        <p className="text-sm text-gray-500 mt-0.5">Run an analysis or SEO snapshots automatically, every day, week or month.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ConfigListExport list="schedules" />
        {adminLoading && <Skeleton className="h-9 w-full sm:w-36 rounded-lg" />}
        {isAdmin && showNewButton && <NewScheduleButton onNew={onNew} />}
      </div>
    </div>
  </div>
);

interface ScheduleListProps {
  schedules: Schedule[];
  groups: KeywordGroup[];
  onNew: () => void;
  onEdit: (schedule: Schedule) => void;
  onRun: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  onToggle: (schedule: Schedule, enabled: boolean) => void;
  runningId: string | null;
  /** Reads stay open; edit, run, toggle and delete are Admin-only. */
  isAdmin: boolean;
  /** The first `GET /schedules` has not answered yet. */
  loading?: boolean;
}

export const ScheduleList = ({
  schedules, groups, onNew, onEdit, onRun, onDelete, onToggle, runningId, isAdmin, loading = false
}: ScheduleListProps) => {
  if (schedules.length === 0) {
    return <div className="p-4 sm:p-6">{loading ? <ScheduleListSkeleton /> : <EmptyState isAdmin={isAdmin} onNew={onNew} />}</div>;
  }
  return (
    <ul className="p-4 sm:p-6 space-y-3">
      {schedules.map((schedule) => (
        <ScheduleItem key={schedule.id} schedule={schedule} groups={groups} onEdit={onEdit} onRun={onRun}
          onDelete={onDelete} onToggle={onToggle} running={runningId === schedule.id} isAdmin={isAdmin} />
      ))}
    </ul>
  );
};

const EmptyState = ({
  isAdmin, onNew
}: Pick<ScheduleListProps, 'isAdmin' | 'onNew'>) => (
  <div className="text-center py-12">
    <ClockIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
    <p className="text-sm font-medium text-gray-900">No schedules yet</p>
    {/* "Create a schedule" would point a non-admin at a hidden button and a route that refuses them. */}
    <p className="text-sm text-gray-500 mt-1 mb-4">
      {isAdmin
        ? 'Create a schedule to run analysis automatically, for example every Monday at 09:00.'
        : 'An administrator can add a schedule to run analysis automatically.'}
    </p>
    {isAdmin && <NewScheduleButton onNew={onNew} />}
  </div>
);

interface ScheduleItemProps extends Pick<ScheduleListProps, 'groups' | 'onEdit' | 'onRun' | 'onDelete' | 'onToggle' | 'isAdmin'> {
  schedule: Schedule;
  running: boolean;
}

/** What a schedule runs, with the markets it is narrowed to; snapshot kinds cover every tracked domain. */
function useScopeDescription(schedule: Schedule, groups: KeywordGroup[]): string {
  const { catalog } = useMarketSelection();
  return kindOf(schedule) === 'analysis'
    ? describeScheduleScope(schedule.scope, groups, schedule.keywords, catalog.markets)
    : `${scheduleKindInfo(schedule.kind).label}: ${schedule.scope_summary ?? 'every owned and competitor domain'}`;
}

/**
 * The row switch saves the schedule with only `enabled` flipped, so it needs a
 * stored form (a hand-written cron has none) and a scope (a legacy keyword-text
 * schedule has to be re-scoped in the editor first).
 */
function canToggleInList(schedule: Schedule): boolean {
  return schedule.form !== null && (kindOf(schedule) !== 'analysis' || schedule.scope !== null);
}

const Tag = ({
  children, title
}: {
  readonly children: string;
  readonly title: string 
}) => (
  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-amber-700" title={title}>{children}</span>
);

const ScheduleTitle = ({
  schedule, isAdmin, onEdit
}: Pick<ScheduleItemProps, 'schedule' | 'isAdmin' | 'onEdit'>) => (
  <div className="flex flex-wrap items-center gap-2">
    <h3 className="font-medium text-gray-900 text-sm break-words min-w-0">
      {isAdmin ? (
        <button type="button" onClick={() => onEdit(schedule)} aria-label={`Edit schedule ${schedule.display_name}`}
          className="text-left hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">
          {schedule.display_name}
        </button>
      ) : schedule.display_name}
    </h3>
    {kindOf(schedule) !== 'analysis' && <Tag title="Each run calls DataForSEO">Paid</Tag>}
    {schedule.legacy && <Tag title="Created with the previous version; save it once to upgrade">Legacy</Tag>}
  </div>
);

/** On/off for admins where the row can save it; a plain state word otherwise. */
const EnabledControl = ({
  schedule, isAdmin, onToggle
}: Pick<ScheduleItemProps, 'schedule' | 'isAdmin' | 'onToggle'>) => {
  const word = schedule.enabled ? 'On' : 'Off';
  if (!isAdmin || !canToggleInList(schedule)) {
    return <span className="text-xs font-medium text-gray-500">{schedule.enabled ? 'Enabled' : 'Disabled'}</span>;
  }
  return (
    <ScheduleSwitch checked={schedule.enabled} onChange={(enabled) => onToggle(schedule, enabled)}
      ariaLabel={`${schedule.display_name} enabled`}>
      <span className="w-6 text-xs text-gray-500" aria-hidden="true">{word}</span>
    </ScheduleSwitch>
  );
};

/** One schedule: name, timing and scope in words, the next run, the on/off switch and a ⋯ menu. */
const ScheduleItem = ({
  schedule, groups, onEdit, onRun, onDelete, onToggle, running, isAdmin
}: ScheduleItemProps) => {
  const scope = useScopeDescription(schedule, groups);
  const next = schedule.enabled && schedule.form !== null ? describeNextRun(schedule.form) : null;
  return (
    <li className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-lg">
      <div className="flex-1 min-w-0">
        <ScheduleTitle schedule={schedule} isAdmin={isAdmin} onEdit={onEdit} />
        <p className="text-sm text-gray-700 mt-1">{describeScheduleTiming(schedule)}</p>
        <p className="text-xs text-gray-500 mt-1 truncate" title={scope}>{scope}</p>
        {next !== null && <p className="text-xs text-gray-500 mt-1">{next}</p>}
        {running && <p className="text-xs text-gray-500 mt-1" aria-live="polite">Starting…</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <EnabledControl schedule={schedule} isAdmin={isAdmin} onToggle={onToggle} />
        {isAdmin && (
          <ActionMenu
            label={`Actions for ${schedule.display_name}`}
            items={[
              {
                label: 'Edit',
                onSelect: () => onEdit(schedule),
              },
              {
                label: running ? 'Starting…' : 'Run now',
                onSelect: () => onRun(schedule),
                disabled: running,
              },
              {
                label: 'Delete',
                onSelect: () => onDelete(schedule),
                tone: 'danger',
              },
            ]}
          />
        )}
      </div>
    </li>
  );
};
