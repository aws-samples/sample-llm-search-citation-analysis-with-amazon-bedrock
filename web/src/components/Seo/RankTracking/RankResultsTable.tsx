import type {
  RankCell, RankDevice, RankResultRow
} from '../../../types/api/seoRankTracking';
import { Button } from '../../ui/Button';
import {
  featureLabels, positionDisplay, type PositionTone
} from './rankTrackingFormat';

const TONE_CLASSES: Readonly<Record<PositionTone, string>> = {
  up: 'text-emerald-700 dark:text-emerald-400',
  down: 'text-amber-700 dark:text-amber-400',
  same: 'text-gray-900 dark:text-gray-100',
  lost: 'text-red-700 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
};
const ARROWS: Readonly<Partial<Record<PositionTone, string>>> = {
  up: '▲ ',
  down: '▼ ' 
};
const DEVICE_NAMES: Readonly<Record<RankDevice, string>> = {
  desktop: 'Desktop',
  mobile: 'Mobile' 
};
const HEAD = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
const CELL = 'px-3 py-2 text-sm align-top';

function PositionCell({ cell }: { readonly cell: RankCell | null }) {
  const display = positionDisplay(cell);
  return (
    <td className={`${CELL} whitespace-nowrap ${TONE_CLASSES[display.tone]}`}>
      {ARROWS[display.tone] ?? ''}{display.text}
    </td>
  );
}

/** The newest cell of a row (the device checked last). */
function newestCell(row: RankResultRow, devices: readonly RankDevice[]): RankCell | null {
  const cells = devices.map((device) => row[device]).filter((cell): cell is RankCell => cell?.checked_at != null);
  return cells.reduce<RankCell | null>(
    (best, cell) => (best === null || (cell.checked_at ?? '') > (best.checked_at ?? '') ? cell : best), null,
  );
}

function UrlCell({ cell }: { readonly cell: RankCell | null }) {
  if (cell?.url == null) return <td className={`${CELL} text-gray-500`}>–</td>;
  return (
    <td className={`${CELL} max-w-xs truncate`}>
      <a href={cell.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline dark:text-blue-300">
        {cell.url}
      </a>
    </td>
  );
}

/** A Remove button for an extra keyword; the Settings keywords (of the market or group) are managed in Settings. */
function RemoveCell({
  row, onRemove
}: {
  readonly row: RankResultRow;
  readonly onRemove: (row: RankResultRow) => void;
}) {
  return (
    <td className={`${CELL} text-right`}>
      {row.source === 'list' ? (
        <Button variant="ghost" size="sm" aria-label={`Remove ${row.keyword}`} onClick={() => onRemove(row)}>Remove</Button>
      ) : (
        <span className="text-xs text-gray-500">{row.source === 'group' ? 'From group' : 'From Settings'}</span>
      )}
    </td>
  );
}

interface Props {
  readonly rows: readonly RankResultRow[];
  readonly devices: readonly RankDevice[];
  readonly selectedKeywordId: string | null;
  readonly onSelectKeyword: (keywordId: string) => void;
  /** Adds a Remove column (Admins only). */
  readonly onRemoveKeyword?: (row: RankResultRow) => void;
}

/** Latest position per device with its change since the comparison check, in the route's order (misses last). */
export function RankResultsTable({
  rows, devices, selectedKeywordId, onSelectKeyword, onRemoveKeyword
}: Props) {
  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th className={HEAD}>Keyword</th>
            {devices.map((device) => <th key={device} className={HEAD}>{DEVICE_NAMES[device]}</th>)}
            <th className={HEAD}>Ranking URL</th>
            <th className={HEAD}>SERP features</th>
            <th className={HEAD}>Last checked</th>
            {onRemoveKeyword !== undefined && <th className={HEAD}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((row) => {
            const newest = newestCell(row, devices);
            return (
              <tr key={row.keyword_id} className={row.keyword_id === selectedKeywordId ? 'bg-gray-50 dark:bg-gray-700/40' : ''}>
                <td className={CELL}>
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onSelectKeyword(row.keyword_id)}>
                    {row.keyword}
                  </button>
                </td>
                {devices.map((device) => <PositionCell key={device} cell={row[device]} />)}
                <UrlCell cell={newest} />
                <td className={`${CELL} text-gray-600 dark:text-gray-300`}>{featureLabels(newest?.serp_features ?? []).join(' · ') || '–'}</td>
                <td className={`${CELL} whitespace-nowrap text-gray-500`}>{newest?.checked_at?.slice(0, 10) ?? 'Not checked'}</td>
                {onRemoveKeyword !== undefined && <RemoveCell row={row} onRemove={onRemoveKeyword} />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
