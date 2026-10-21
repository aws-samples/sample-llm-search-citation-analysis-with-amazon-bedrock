import { formatDate } from '../../../formatting/dateFormatter';

/** "after <date>": the runs a report covers when its read stopped at the run stamped `timestamp`. */
export function runsAfter(timestamp: string): string {
  return `after ${formatDate(timestamp)}`;
}

/** Why a report starts later than its period: the period holds more data than one report reads; `covers` names the runs it covers. */
export function ReportCutNote({ covers }: { readonly covers: string }) {
  return (
    <p role="note" className="mb-4 text-xs text-amber-700 dark:text-amber-400">
      {`This period holds more analysis data than one report reads; the report covers the runs ${covers}. Choose a shorter period for the rest.`}
    </p>
  );
}

/** The cut note of a payload whose window read stopped at `truncatedBefore`; nothing for a window read whole. */
export function TruncatedHistoryNote({ truncatedBefore }: { readonly truncatedBefore?: string | null }) {
  if (truncatedBefore === undefined || truncatedBefore === null) return null;
  return <ReportCutNote covers={runsAfter(truncatedBefore)} />;
}
