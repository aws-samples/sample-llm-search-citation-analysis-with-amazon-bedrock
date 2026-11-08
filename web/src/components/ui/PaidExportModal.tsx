/**
 * "Export {table}" for a table paged from DataForSEO (2.45.0): the user picks how many rows (from the first row of
 * the table as sorted and filtered now) and the file format, sees the price ceiling of the requests live, and
 * queues a server export of exactly those rows at that price, or of the page on screen for free. Nothing is asked
 * from DataForSEO in the browser: the export service runs the requests and the file arrives on the Exports page.
 */
import {
  useEffect, useId, useRef, useState, type SubmitEvent
} from 'react';
import {
  exportParams, startExport, type ViewParams
} from '../../api/exports';
import {
  clampRows, exportPlan, priceText
} from '../../exporters/paidExport';
import { useExports } from '../../hooks/useExports';
import { getErrorMessage } from '../../infrastructure';
import type { SeoExportPricing } from '../../types/api/seo';
import type {
  ExportFormat, ExportView
} from '../../types/domain/exports';
import { Button } from './Button';
import { ErrorAlert } from './ErrorAlert';
import { Modal } from './Modal';
import { integerText } from './numberFormat';

/** The rows asked by default, when the list holds that many. */
const DEFAULT_ROWS = 1000;

/** The export views of the DataForSEO-paged tables (`shared.export_source_seo_paid`). */
export type PaidExportView = Extract<ExportView, 'seo-domain' | 'seo-backlinks'>;

/** The page on screen, exported for free from the answer the SEO API cached when it was shown. */
export interface ScreenPage {
  readonly page: number;
  readonly page_size: number;
}

export interface PaidExportProps {
  /** The table name, as in "Export {title}". */
  readonly title: string;
  readonly pricing: SeoExportPricing;
  /** The rows of the whole list, when DataForSEO counts them. */
  readonly totalCount: number | null;
  readonly onScreenRows: number;
  readonly view: PaidExportView;
  /** The list as the view asks it (table, target, sort, filters as JSON), without its page. */
  readonly params: ViewParams;
  readonly screenPage: ScreenPage;
}

interface Props extends PaidExportProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'started' }
  | {
    readonly kind: 'error';
    readonly message: string;
  };

const IDLE = { kind: 'idle' } satisfies Status;
const STARTED_MESSAGE = 'Export started — find it on the Exports page.';

/** The most rows the field accepts: the list's count when known, never above the export cap, at least one. */
function exportRowCap(totalCount: number | null, pricing: SeoExportPricing): number {
  return Math.max(1, Math.min(totalCount ?? pricing.max_rows, pricing.max_rows));
}

function rowsHint(maxRows: number, totalCount: number | null): string {
  const cap = `Up to ${integerText(maxRows)}`;
  return totalCount === null ? cap : `${cap} (${integerText(totalCount)} in this list)`;
}

/** The export params of `rows` rows confirmed at their price (the server checks both before it queues them). */
export function confirmedParams(params: ViewParams, rows: number, pricing: SeoExportPricing): ViewParams {
  return {
    ...params,
    rows,
    price_usd: String(exportPlan(rows, pricing).priceUsd),
  };
}

function PriceLine({
  id, rows, maxRows, pricing
}: {
  readonly id: string;
  readonly rows: number | null;
  readonly maxRows: number;
  readonly pricing: SeoExportPricing;
}) {
  if (rows === null) {
    return <p id={id} className="text-xs text-red-600 mt-1">Enter a number of rows from 1 to {integerText(maxRows)}.</p>;
  }
  const plan = exportPlan(rows, pricing);
  const requests = `${plan.requests} DataForSEO ${plan.requests === 1 ? 'request' : 'requests'}`;
  return <p id={id} className="mt-2 text-sm font-medium text-gray-900">Price: {priceText(plan.priceUsd)} · {requests}</p>;
}

function FormatField({
  format, disabled, onChange
}: {
  readonly format: ExportFormat;
  readonly disabled: boolean;
  readonly onChange: (format: ExportFormat) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">File format</label>
      <select id={id} value={format} disabled={disabled} onChange={(event) => onChange(event.target.value === 'csv' ? 'csv' : 'xlsx')}
        className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900">
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV (.csv)</option>
      </select>
    </div>
  );
}

/** Start export (the form's submit) and Cancel. */
function DialogActions({
  canStart, onCancel
}: {
  readonly canStart: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="submit" disabled={!canStart}>Start export</Button>
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** Queues an export through the Exports center (its toast says it started) or, without one, the API directly. */
function useQueueExport(onQueued: () => void, onStarted: () => void) {
  const center = useExports();
  return async (view: PaidExportView, params: ViewParams, format: ExportFormat) => {
    const request = {
      view,
      params: exportParams(params),
      format,
    };
    if (center === null) {
      await startExport(request);
      onStarted();
      return;
    }
    await center.start(request);
    onQueued();
  };
}

/** The open dialog: its state starts afresh each time the dialog opens. */
function PaidExportDialog({
  onClose, title, pricing, totalCount, onScreenRows, view, params, screenPage
}: Omit<Props, 'open'>) {
  const maxRows = exportRowCap(totalCount, pricing);
  const [text, setText] = useState(() => String(Math.min(DEFAULT_ROWS, maxRows)));
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [status, setStatus] = useState<Status>(IDLE);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const busy = status.kind === 'starting' || status.kind === 'started';
  const rows = clampRows(text.trim() === '' ? Number.NaN : Number(text), maxRows);
  const queue = useQueueExport(onClose, () => setStatus({ kind: 'started' }));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const start = async (exported: ViewParams) => {
    setStatus({ kind: 'starting' });
    try {
      await queue(view, exported, format);
    } catch (failure) {
      console.error(`[seo] Starting the ${title} export failed:`, failure);
      setStatus({
        kind: 'error',
        message: getErrorMessage(failure),
      });
    }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (rows === null || busy) return;
    void start(confirmedParams(params, rows, pricing));
  };

  const changeRows = (value: string) => {
    const typed = Number(value);
    setText(value.trim() !== '' && typed > maxRows ? String(maxRows) : value);
  };

  return (
    <Modal isOpen onClose={onClose} title={`Export ${title}`}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-gray-600">
          These rows come straight from DataForSEO: the export makes new requests, and DataForSEO charges for the rows it
          returns. The export starts at the first row of the table, as it is sorted and filtered now, and runs in the
          background: the file appears on the Exports page.
        </p>
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">Rows to export</label>
          <input ref={inputRef} id={inputId} type="number" inputMode="numeric" min={1} max={maxRows} step={1} value={text}
            disabled={busy} aria-describedby={`${inputId}-hint ${inputId}-price`}
            onChange={(event) => changeRows(event.target.value)}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900" />
          <p id={`${inputId}-hint`} className="text-xs text-gray-400 mt-1">{rowsHint(maxRows, totalCount)}</p>
          <PriceLine id={`${inputId}-price`} rows={rows} maxRows={maxRows} pricing={pricing} />
          <p className="text-xs text-gray-500 mt-1">{`Exporting the same rows again within ${pricing.cache_hours} hours is free.`}</p>
        </div>
        <FormatField format={format} disabled={busy} onChange={setFormat} />
        <button type="button" disabled={busy} onClick={() => void start({
          ...params,
          ...screenPage,
        })}
        className="text-sm font-medium text-gray-700 underline hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed">
          Export the {integerText(onScreenRows)} rows on screen (free)
        </button>
        {status.kind === 'started' && <output className="block text-sm text-gray-700">{STARTED_MESSAGE}</output>}
        <ErrorAlert message={status.kind === 'error' ? status.message : null} />
        <DialogActions canStart={!busy && rows !== null} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function PaidExportModal({
  open, ...dialog
}: Props) {
  return open ? <PaidExportDialog {...dialog} /> : null;
}
