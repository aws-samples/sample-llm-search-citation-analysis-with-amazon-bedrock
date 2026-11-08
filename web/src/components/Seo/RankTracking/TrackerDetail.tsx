/**
 * One tracker: its latest results compared with a period ago, the position distribution per check, a
 * keyword's history, and (for Admins) the paid "Check rankings" action behind a confirmation of its paid calls.
 * Every read here is free; the only paid call is the confirmed manual run.
 */
import { useState } from 'react';
import {
  estimateRankTracker, removeRankKeywords
} from '../../../api/seoRankTracking';
import { seoErrorMessage } from '../../../api/seo';
import {
  useRankKeywordHistory, useRankTrackerData
} from '../../../hooks/useRankTrackingData';
import {
  isRunActive, useRankTrackingRun
} from '../../../hooks/useRankTrackingRun';
import type {
  RankDevice, RankEstimate, RankPeriod, RankResultRow, RankRun, RankTracker, RankTrendPoint
} from '../../../types/api/seoRankTracking';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ExportExcelButton } from '../../ui/ExportExcelButton';
import {
  ConfirmModal, Modal
} from '../../ui/Modal';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import {
  RankHistoryChart, RankTrendChart 
} from './RankCharts';
import { RankResultsTable } from './RankResultsTable';
import { CheckSummary } from './TrackerFormModal';
import {
  SCHEDULE_LABELS, keywordCapNote
} from './rankTrackingFormat';
import { exportRankResultsExcel } from './rankTrackingExcel';

const PERIODS: readonly {
  value: RankPeriod;
  label: string 
}[] = [
  {
    value: '1d',
    label: 'vs yesterday' 
  },
  {
    value: '7d',
    label: 'vs last week' 
  },
  {
    value: '30d',
    label: 'vs last month' 
  },
  {
    value: '90d',
    label: 'vs 90 days ago' 
  },
];

function runLine(run: RankRun | null): string | null {
  if (run === null) return null;
  if (isRunActive(run)) return `Checking rankings: ${run.keywords_checked} of ${run.keywords_total || '…'} keywords`;
  if (run.status === 'failed') return `Last check failed: ${run.error_message ?? run.error_code ?? 'unknown error'}`;
  if (run.status === 'partial') return `Last check was partial: ${run.error_message ?? ''}`;
  return `Last checked ${run.completed_at?.slice(0, 16).replace('T', ' ') ?? ''} UTC`;
}

function RunConfirm({
  estimate, onCancel, onConfirm
}: {
  readonly estimate: RankEstimate;
  readonly onCancel: () => void;
  readonly onConfirm: () => void 
}) {
  return (
    <Modal isOpen onClose={onCancel} title="Check rankings now?">
      <div className="space-y-4">
        <CheckSummary estimate={estimate} scheduled={false} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Check rankings</Button>
        </div>
      </div>
    </Modal>
  );
}

function KeywordHistory({
  trackerId, keywordId, keyword
}: {
  readonly trackerId: string;
  readonly keywordId: string;
  readonly keyword: string 
}) {
  const history = useRankKeywordHistory(trackerId, keywordId);
  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <h4 className="text-sm font-semibold">History: {keyword}</h4>
      {history.loading && <SkeletonRegion label="Loading keyword history"><div className="h-64" /></SkeletonRegion>}
      {history.error !== null && <ErrorAlert message={history.error} />}
      {history.data !== null && <RankHistoryChart history={history.data} />}
    </section>
  );
}

interface HeaderProps {
  readonly tracker: RankTracker;
  readonly isAdmin: boolean;
  readonly period: RankPeriod;
  readonly runBusy: boolean;
  readonly canExport: boolean;
  readonly onPeriod: (period: RankPeriod) => void;
  readonly onExport: () => Promise<void>;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onRun: () => void;
}

function nextCheckText(tracker: RankTracker): string {
  return tracker.next_check_at === null ? '' : ` · next check ${tracker.next_check_at.slice(0, 10)}`;
}

function DetailHeader(props: HeaderProps) {
  const { tracker } = props;
  const capNote = keywordCapNote(tracker);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold">{tracker.domain}</h3>
        <p className="text-sm text-gray-500">{SCHEDULE_LABELS[tracker.schedule]} · top {tracker.depth}{nextCheckText(tracker)}</p>
        {capNote !== null && <p className="text-xs text-amber-700 dark:text-amber-400">{capNote}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Compare with" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={props.period}
          onChange={(event) => props.onPeriod(PERIODS.find((option) => option.value === event.target.value)?.value ?? '7d')}>
          {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ExportExcelButton onExport={props.onExport} failureLabel="[seo] Rank tracking Excel export failed:"
          disabled={!props.canExport} title="The keywords of this tracker with their latest positions" />
        {props.isAdmin && (
          <>
            <Button variant="secondary" size="sm" onClick={props.onEdit}>Edit</Button>
            <Button variant="secondary" size="sm" onClick={props.onArchive}>Archive</Button>
            <Button size="sm" disabled={props.runBusy} onClick={props.onRun}>Check rankings</Button>
          </>
        )}
      </div>
    </header>
  );
}

function TrendSection({
  devices, points
}: {
  readonly devices: readonly RankDevice[];
  readonly points: readonly RankTrendPoint[] 
}) {
  const [device, setDevice] = useState<RankDevice>(devices[0]);
  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Position distribution</h4>
        {devices.length > 1 && (
          <select aria-label="Trend device" className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={device}
            onChange={(event) => setDevice(event.target.value === 'mobile' ? 'mobile' : 'desktop')}>
            {devices.map((option) => <option key={option} value={option}>{option === 'desktop' ? 'Desktop' : 'Mobile'}</option>)}
          </select>
        )}
      </div>
      <RankTrendChart points={points} device={device} />
    </section>
  );
}

interface KeywordRemoval {
  /** The keyword waiting for the Admin's confirmation. */
  readonly pending: RankResultRow | null;
  readonly error: string | null;
  readonly ask: (row: RankResultRow) => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

/** Removing one hand-added keyword after a confirmation; the results are re-read once it is gone. */
function useKeywordRemoval(trackerId: string, onRemoved: () => void): KeywordRemoval {
  const [pending, setPending] = useState<RankResultRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    if (pending === null) return;
    setError(null);
    removeRankKeywords(trackerId, [pending.keyword_id]).then(onRemoved, (failure: unknown) => setError(seoErrorMessage(failure)));
  };
  return {
    pending,
    error,
    ask: setPending,
    cancel: () => setPending(null),
    confirm,
  };
}

function RemoveConfirm({ removal }: { readonly removal: KeywordRemoval }) {
  return (
    <ConfirmModal
      isOpen={removal.pending !== null} onClose={removal.cancel} onConfirm={removal.confirm} title="Remove keyword?"
      message={`Stop tracking "${removal.pending?.keyword ?? ''}"? Its ranking history is kept.`} confirmText="Remove" confirmVariant="danger"
    />
  );
}

interface Props {
  readonly tracker: RankTracker;
  readonly isAdmin: boolean;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
}

function trackerDevices(tracker: RankTracker): RankDevice[] {
  return tracker.devices === 'both' ? ['desktop', 'mobile'] : [tracker.devices];
}

export function TrackerDetail({
  tracker, isAdmin, onEdit, onArchive
}: Props) {
  const [period, setPeriod] = useState<RankPeriod>('7d');
  const [keywordId, setKeywordId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<RankEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const data = useRankTrackerData(tracker.tracker_id, period);
  const control = useRankTrackingRun(tracker.tracker_id, tracker.latest_run, data.reload);
  const devices = trackerDevices(tracker);
  const rows = data.results.data?.rows ?? [];
  const selected = rows.find((row) => row.keyword_id === keywordId);
  const status = runLine(control.run);
  const removal = useKeywordRemoval(tracker.tracker_id, data.reload);

  const askToRun = () => {
    setEstimateError(null);
    estimateRankTracker({ tracker_id: tracker.tracker_id }).then(setEstimate, (failure: unknown) => setEstimateError(seoErrorMessage(failure)));
  };
  const confirmRun = () => {
    setEstimate(null);
    void control.start();
  };

  return (
    <div className="space-y-4">
      <DetailHeader
        tracker={tracker} isAdmin={isAdmin} period={period} runBusy={control.starting || isRunActive(control.run)}
        canExport={rows.length > 0} onPeriod={setPeriod} onExport={() => exportRankResultsExcel(rows, devices, tracker.domain)}
        onEdit={onEdit} onArchive={onArchive} onRun={askToRun}
      />
      {status !== null && <output className="block text-sm text-gray-600 dark:text-gray-300">{status}</output>}
      {[control.error, estimateError, removal.error, data.results.error].map((message) => message !== null && <ErrorAlert key={message} message={message} />)}
      {estimate !== null && <RunConfirm estimate={estimate} onCancel={() => setEstimate(null)} onConfirm={confirmRun} />}
      <RemoveConfirm removal={removal} />
      <TrendSection devices={devices} points={data.trend.data?.points ?? []} />
      {data.results.loading ? (
        <SkeletonRegion label="Loading rank results" className="bg-white rounded-lg border border-gray-200">
          <SkeletonTable rows={6} columns={devices.length + 4} rowClassName="h-10" />
        </SkeletonRegion>
      ) : (
        <RankResultsTable rows={rows} devices={devices} selectedKeywordId={keywordId} onSelectKeyword={setKeywordId}
          onRemoveKeyword={isAdmin ? removal.ask : undefined} />
      )}
      {selected !== undefined && <KeywordHistory trackerId={tracker.tracker_id} keywordId={selected.keyword_id} keyword={selected.keyword} />}
    </div>
  );
}
