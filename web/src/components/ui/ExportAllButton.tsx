import { useState } from 'react';
import {
  exportParams, startExport, type ViewParams
} from '../../api/exports';
import { useExports } from '../../hooks/useExports';
import { getErrorMessage } from '../../infrastructure';
import type {
  ExportFormat, ExportView
} from '../../types/domain/exports';
import { Button } from './Button';

interface ExportAllButtonProps {
  /** The view's export row source (`EXPORT_VIEWS`). */
  readonly view: ExportView;
  /**
   * The view's current query parameters (scope, market, filters, sort). Paging parameters and
   * unset filters are dropped, so the export holds every row the view's filters select.
   * `null` while the view has not loaded what it would export (the button is disabled).
   */
  readonly params: ViewParams | null;
  /** The button text (default "Export all"). */
  readonly label?: string;
}

const FORMATS: ReadonlyArray<{
  readonly format: ExportFormat;
  readonly label: string;
}> = [
  {
    format: 'xlsx',
    label: 'Excel (.xlsx)',
  },
  {
    format: 'csv',
    label: 'CSV (.csv)',
  },
];

/**
 * The one "Export all" of every data view (2.45.0): asks the export service for the view's full
 * data with its current filters, as Excel or CSV. The job runs in the background until the whole
 * file is written; a toast says it started and another when it is ready on the Exports page.
 * Screen only.
 */
export function ExportAllButton({
  view, params, label = 'Export all'
}: ExportAllButtonProps) {
  const center = useExports();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{
    readonly error: boolean;
    readonly text: string 
  } | null>(null);

  const choose = async (format: ExportFormat) => {
    if (params === null) return;
    setOpen(false);
    setStarting(true);
    setMessage(null);
    const request = {
      view,
      params: exportParams(params),
      format,
    };
    try {
      await (center === null ? startExport(request) : center.start(request));
      if (center === null) setMessage({
        error: false,
        text: 'Export started — find it on the Exports page.',
      });
    } catch (error) {
      console.error('[exports] Starting an export failed:', error);
      setMessage({
        error: true,
        text: getErrorMessage(error),
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="print-hidden relative inline-flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={open} disabled={params === null || starting} onClick={() => setOpen(!open)}>
        {starting ? 'Starting export…' : label}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-sm">
          {FORMATS.map((option) => (
            <button key={option.format} type="button" role="menuitem" onClick={() => { void choose(option.format); }} className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100">
              {option.label}
            </button>
          ))}
        </div>
      )}
      {message !== null && <p role={message.error ? 'alert' : 'status'} className={`text-xs ${message.error ? 'text-red-700' : 'text-gray-500'}`}>{message.text}</p>}
    </div>
  );
}
