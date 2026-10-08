import { useState } from 'react';
import type { ReportScope } from '../../../types';
import type {
  GroupKpiHistoryResponse, GroupRun
} from '../../../types/domain/groupKpiHistory';
import { fetchBrandMentionsAtRun } from '../../../api/brandMentions';
import { getErrorMessage } from '../../../infrastructure';
import { exportGroupKpiReport } from './groupKpiExport';
import { useExportAction } from '../../ui/useExportAction';
import { useSelectedMarketId } from '../../Markets/marketSelectionContext';

interface Props {
  readonly scope: ReportScope;
  readonly scopeLabel: string;
  readonly history: GroupKpiHistoryResponse;
  /** The run the headline shows; its brand mentions become the raw-data sheet. */
  readonly run: GroupRun;
}

type Notice =
  | {
    tone: 'warning';
    text: string 
  }
  | {
    tone: 'error';
    text: string 
  };

/**
 * Downloads the whole per-hotel report as one workbook. The brand mentions of
 * the selected run are fetched on click; if they cannot be read the workbook
 * is still produced without that sheet, and the reader is told so.
 */
export function GroupKpiExportButton({
  scope, scopeLabel, history, run
}: Props) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const marketId = useSelectedMarketId();

  const {
    exporting, handleExport
  } = useExportAction(async () => {
    setNotice(null);
    const mentions = await fetchBrandMentionsAtRun(scope, run.timestamp, marketId).catch((error: unknown) => {
      setNotice({
        tone: 'warning',
        text: `Exported without the brand mentions sheet: ${getErrorMessage(error, 'brands')}`,
      });
      return null;
    });
    await exportGroupKpiReport(history, scopeLabel, run, mentions);
  }, (error) => {
    setNotice({
      tone: 'error',
      text: `Excel export failed: ${getErrorMessage(error)}`,
    });
  });

  return (
    <span className="inline-flex flex-col items-end gap-1 print-hidden">
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        {exporting ? 'Exporting…' : 'Export to Excel'}
      </button>
      {notice?.tone === 'error' && <span role="alert" className="text-xs text-red-700">{notice.text}</span>}
      {notice?.tone === 'warning' && <output className="text-xs text-amber-700">{notice.text}</output>}
    </span>
  );
}
