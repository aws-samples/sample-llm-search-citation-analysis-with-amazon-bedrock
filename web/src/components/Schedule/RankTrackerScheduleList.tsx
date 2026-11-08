import {
  useEffect, useState
} from 'react';
import { Link } from 'react-router-dom';
import {
  fetchRankTrackerSchedules, type RankTrackerScheduleList as Listed
} from '../../api/executions';
import {
  getErrorMessage, isAbortError
} from '../../infrastructure';
import type { RankTrackerSchedule } from '../../types';

/** The rank tracking page, opened on one tracker. */
export function trackerLink(trackerId: string): string {
  return `/seo/rank-tracking?tracker=${encodeURIComponent(trackerId)}`;
}

/** "Mon, 9 Nov 2026, 04:30" in the browser's zone, or "unknown" when the API could not read the time. */
export function describeNextCheck(nextRunAt: string | null): string {
  if (nextRunAt === null) return 'unknown';
  const when = new Date(nextRunAt);
  if (Number.isNaN(when.getTime())) return 'unknown';
  return when.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RankTrackerRow = ({ schedule }: { readonly schedule: RankTrackerSchedule }) => (
  <li className="flex flex-wrap items-center justify-between gap-2 p-3 border border-gray-200 rounded-lg">
    <div className="min-w-0">
      <p className="text-sm font-medium text-gray-900 truncate">{schedule.display_name}</p>
      <p className="text-xs text-gray-500">
        {schedule.enabled ? `Next check ${describeNextCheck(schedule.next_run_at)}` : 'Paused'}
      </p>
    </div>
    {schedule.tracker_id !== null && (
      <Link to={trackerLink(schedule.tracker_id)} className="text-xs font-medium text-blue-700 hover:underline">
        Edit on the tracker
      </Link>
    )}
  </li>
);

/**
 * The rank trackers' next checks, read once on mount. Each tracker keeps its
 * own frequency in the tracker form, so this list has no controls; it is
 * hidden while no tracker is scheduled.
 */
export const RankTrackerScheduleList = () => {
  const [listed, setListed] = useState<Listed>({
    schedules: [],
    truncated: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRankTrackerSchedules(controller.signal)
      .then(setListed)
      .catch((err: unknown) => {
        if (!isAbortError(err)) setError(getErrorMessage(err, 'schedules'));
      });
    return () => controller.abort();
  }, []);

  const {
    schedules, truncated 
  } = listed;
  if (schedules.length === 0 && error === null) return null;
  return (
    <section aria-labelledby="rank-tracker-schedules" className="p-4 sm:p-6 border-t border-gray-200">
      <h3 id="rank-tracker-schedules" className="text-sm font-semibold text-gray-900">Rank tracker checks</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">Each tracker sets its own frequency; change it on the tracker.</p>
      {error === null ? (
        <ul className="space-y-2">
          {schedules.map((schedule) => <RankTrackerRow key={schedule.id} schedule={schedule} />)}
          {truncated && <li className="text-xs text-gray-500">More trackers are scheduled than are listed here (the first 100).</li>}
        </ul>
      ) : <p className="text-sm text-red-700">{error}</p>}
    </section>
  );
};
