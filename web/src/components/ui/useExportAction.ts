import { useState } from 'react';

/**
 * Busy flag plus click handler for an export button: `exporting` is true
 * while `run` is in flight; a failure is logged with `onFailure` (a console
 * prefix) or handed to it (a callback), and the button is released either
 * way. A `null` run (nothing to export yet) makes the handler a no-op.
 */
export function useExportAction(
  run: (() => Promise<void>) | null,
  onFailure: string | ((error: unknown) => void),
) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!run) return;
    setExporting(true);
    try {
      await run();
    } catch (error) {
      if (typeof onFailure === 'string') console.error(onFailure, error);
      else onFailure(error);
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    handleExport,
  };
}
