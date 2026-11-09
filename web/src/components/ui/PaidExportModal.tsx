/**
 * "Export {table} to Excel" for a table paged from DataForSEO: the user picks how many rows (from the first row of
 * the table as sorted and filtered now), sees the price ceiling of the new requests live, and downloads them, or
 * downloads the rows on screen for free. Nothing is asked from DataForSEO until Download; Cancel stops the
 * requests still to come.
 */
import {
  useEffect, useId, useRef, useState, type FormEvent
} from 'react';
import { seoErrorMessage } from '../../api/seo';
import {
  clampRows, exportPlan, fetchAllChunks, priceText, type ExportChunk, type FetchChunk
} from '../../exporters/paidExport';
import type { SeoExportPricing } from '../../types/api/seo';
import { Button } from './Button';
import { ErrorAlert } from './ErrorAlert';
import { Modal } from './Modal';
import { integerText } from './numberFormat';

/** The rows asked by default, when the list holds that many. */
const DEFAULT_ROWS = 1000;

export interface PaidExportProps<TRow> {
  /** The table name, as in "Export {title} to Excel". */
  readonly title: string;
  readonly pricing: SeoExportPricing;
  /** The rows of the whole list, when DataForSEO counts them. */
  readonly totalCount: number | null;
  readonly onScreenRows: number;
  readonly fetchChunk: FetchChunk<TRow>;
  /** Writes the fetched rows to the xlsx file. */
  readonly onDownload: (rows: readonly TRow[]) => Promise<void>;
  /** Writes the rows on screen to the xlsx file (no request). */
  readonly onDownloadScreen: () => Promise<void>;
}

interface Props<TRow> extends PaidExportProps<TRow> {
  readonly open: boolean;
  readonly onClose: () => void;
}

type Status =
  | { readonly kind: 'idle' }
  | {
    readonly kind: 'fetching';
    readonly chunk: ExportChunk;
    readonly rows: number;
  }
  | { readonly kind: 'saving' }
  | {
    readonly kind: 'error';
    readonly message: string;
  };

const IDLE = { kind: 'idle' } satisfies Status;

/** The most rows the field accepts: the list's count when known, never above the export cap, at least one. */
function exportRowCap(totalCount: number | null, pricing: SeoExportPricing): number {
  return Math.max(1, Math.min(totalCount ?? pricing.max_rows, pricing.max_rows));
}

function rowsHint(maxRows: number, totalCount: number | null): string {
  const cap = `Up to ${integerText(maxRows)}`;
  return totalCount === null ? cap : `${cap} (${integerText(totalCount)} in this list)`;
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
    return <p id={id} className="text-xs text-red-600 dark:text-red-400 mt-1">Enter a number of rows from 1 to {integerText(maxRows)}.</p>;
  }
  const plan = exportPlan(rows, pricing);
  const requests = `${plan.requests} DataForSEO ${plan.requests === 1 ? 'request' : 'requests'}`;
  return <p id={id} className="mt-2 text-sm font-medium text-gray-900">Price: {priceText(plan.priceUsd)} · {requests}</p>;
}

/** The live progress line (one persistent region, so screen readers announce each new chunk). */
function FetchProgress({ status }: { readonly status: Status }) {
  const fetching = status.kind === 'fetching' ? status : null;
  return (
    <div aria-live="polite" className="space-y-1">
      {fetching !== null && (
        <>
          <p className="text-sm text-gray-700">
            Fetching rows {integerText(fetching.chunk.offset + 1)}–{integerText(fetching.chunk.offset + fetching.chunk.limit)} of {integerText(fetching.rows)}…
          </p>
          <progress aria-label="Rows fetched" max={fetching.rows} value={fetching.chunk.offset} className="h-2 w-full accent-gray-900 dark:accent-gray-300" />
        </>
      )}
    </div>
  );
}

/** Download (the form's submit) and Cancel, which stays enabled to stop an export under way. */
function DialogActions({
  canDownload, onCancel
}: {
  readonly canDownload: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="submit" disabled={!canDownload}>Download</Button>
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** The open dialog: its state starts afresh each time the dialog opens. */
function PaidExportDialog<TRow>({
  onClose, title, pricing, totalCount, onScreenRows, fetchChunk, onDownload, onDownloadScreen
}: Omit<Props<TRow>, 'open'>) {
  const maxRows = exportRowCap(totalCount, pricing);
  const [text, setText] = useState(() => String(Math.min(DEFAULT_ROWS, maxRows)));
  const [status, setStatus] = useState<Status>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const busy = status.kind === 'fetching' || status.kind === 'saving';
  const rows = clampRows(text.trim() === '' ? Number.NaN : Number(text), maxRows);

  useEffect(() => {
    inputRef.current?.focus();
    return () => controllerRef.current?.abort();
  }, []);

  const cancel = () => {
    controllerRef.current?.abort();
    onClose();
  };

  const fail = (failure: unknown) => {
    console.error(`[seo] ${title} Excel export failed:`, failure);
    setStatus({
      kind: 'error',
      message: seoErrorMessage(failure),
    });
  };

  const download = async (event: FormEvent) => {
    event.preventDefault();
    if (rows === null || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const plan = exportPlan(rows, pricing);
    try {
      const fetched = await fetchAllChunks(plan.chunks, fetchChunk, {
        signal: controller.signal,
        onProgress: (chunk) => setStatus({
          kind: 'fetching',
          chunk,
          rows,
        }),
      });
      setStatus({ kind: 'saving' });
      await onDownload(fetched);
      onClose();
    } catch (failure) {
      if (!controller.signal.aborted) fail(failure);
    }
  };

  const downloadScreen = async () => {
    setStatus({ kind: 'saving' });
    try {
      await onDownloadScreen();
      onClose();
    } catch (failure) {
      fail(failure);
    }
  };

  const changeRows = (value: string) => {
    const typed = Number(value);
    setText(value.trim() !== '' && typed > maxRows ? String(maxRows) : value);
  };

  return (
    <Modal isOpen onClose={cancel} title={`Export ${title} to Excel`}>
      <form className="space-y-4" onSubmit={(event) => void download(event)}>
        <p className="text-sm text-gray-600">
          These rows come straight from DataForSEO: the export is a new request, and DataForSEO charges for the rows it
          returns. The export starts at the first row of the table, as it is sorted and filtered now.
        </p>
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">Rows to export</label>
          <input ref={inputRef} id={inputId} type="number" inputMode="numeric" min={1} max={maxRows} step={1} value={text}
            disabled={busy} aria-describedby={`${inputId}-hint ${inputId}-price`}
            onChange={(event) => changeRows(event.target.value)}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900" />
          <p id={`${inputId}-hint`} className="text-xs text-gray-500 mt-1">{rowsHint(maxRows, totalCount)}</p>
          <PriceLine id={`${inputId}-price`} rows={rows} maxRows={maxRows} pricing={pricing} />
          <p className="text-xs text-gray-500 mt-1">Exporting the same rows again within 6 hours is free.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void downloadScreen()}
          className="text-sm font-medium text-gray-700 underline hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
          Download the {integerText(onScreenRows)} rows on screen (free)
        </button>
        <FetchProgress status={status} />
        <ErrorAlert message={status.kind === 'error' ? status.message : null} />
        <DialogActions canDownload={!busy && rows !== null} onCancel={cancel} />
      </form>
    </Modal>
  );
}

export function PaidExportModal<TRow>({
  open, ...dialog
}: Props<TRow>) {
  return open ? <PaidExportDialog {...dialog} /> : null;
}
