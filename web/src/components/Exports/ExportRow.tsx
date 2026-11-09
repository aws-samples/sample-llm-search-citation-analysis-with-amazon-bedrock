import { useState } from 'react';
import { isExportActive } from '../../api/exports';
import { formatDate } from '../../formatting/dateFormatter';
import { describeExportSize } from '../../formatting/exportSize';
import { getErrorMessage } from '../../infrastructure';
import type {
  ExportStatus, ExportSummary
} from '../../types/domain/exports';
import { Button } from '../ui/Button';
import { EXPORT_VIEW_LABELS } from './exportViewLabels';

const STATUS_LABELS: Record<ExportStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_CLASSES: Record<ExportStatus, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-50 text-blue-700',
  ready: 'bg-gray-100 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

/** "2 cells cut to Excel's 32,767-character limit; …", or `null` when the file holds every cell whole. */
function describeCutCells(count: number): string | null {
  if (count === 0) return null;
  return `${count.toLocaleString()} ${count === 1 ? 'cell' : 'cells'} cut to Excel's 32,767-character limit; the CSV export has the full text`;
}

/** "group_id: g1 · market_id: es-es", or "All data" without filters. */
export function describeExportParams(params: Readonly<Record<string, string>>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return 'All data';
  return entries.map(([name, value]) => `${name}: ${value}`).join(' · ');
}

interface ExportRowProps {
  readonly summary: ExportSummary;
  readonly onDownload: (exportId: string) => Promise<void>;
  readonly onRemove: (exportId: string) => Promise<void>;
}

/** One export of the Exports page: what, status, size, created, and its actions. */
export function ExportRow({
  summary, onDownload, onRemove
}: ExportRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = isExportActive(summary);
  const cutCells = describeCutCells(summary.truncated_cells);

  const run = async (action: (exportId: string) => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action(summary.export_id);
    } catch (actionError) {
      console.error('[exports] Export action failed:', actionError);
      setError(getErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="px-6 py-4 text-sm">
        <p className="font-medium text-gray-900">{EXPORT_VIEW_LABELS[summary.view]}</p>
        <p className="text-xs text-gray-500 break-all">{describeExportParams(summary.params)}</p>
        {summary.status === 'failed' && summary.error !== undefined && <p className="text-xs text-red-700">{summary.error}</p>}
        {error !== null && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </td>
      <td className="px-6 py-4 text-sm text-gray-700">{summary.format.toUpperCase()}</td>
      <td className="px-6 py-4 text-sm">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[summary.status]}`}>{STATUS_LABELS[summary.status]}</span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-700">
        {describeExportSize(summary.rows, summary.bytes)}
        {cutCells !== null && <p className="text-xs text-amber-700">{cutCells}</p>}
      </td>
      <td className="px-6 py-4 text-sm text-gray-700">{formatDate(summary.created_at)}</td>
      <td className="px-6 py-4 text-sm">
        <div className="flex justify-end gap-2">
          {summary.status === 'ready' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void run(onDownload); }}>Download</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void run(onRemove); }}>{active ? 'Cancel' : 'Delete'}</Button>
        </div>
      </td>
    </tr>
  );
}
