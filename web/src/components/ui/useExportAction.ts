import { useState } from 'react';

/**
 * Busy flag plus click handler for an export button: `exporting` is true
 * while `run` is in flight; a failure is logged with `failureLog` and the
 * button is released either way. A `null` run (nothing to export yet) makes
 * the handler a no-op.
 */
export function useExportAction(run: (() => Promise<void>) | null, failureLog: string) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!run) return;
    setExporting(true);
    try {
      await run();
    } catch (error) {
      console.error(failureLog, error);
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    handleExport,
  };
}
