/**
 * Excel export of a tracker's results table: the keyword, then per tracked device its position (empty when not
 * found or not checked), change (previous − current as a number; "new" without a previous position, "lost"
 * without a current one), ranking URL and SERP features.
 */
import type {
  RankCell, RankDevice, RankResultRow
} from '../../../types/api/seoRankTracking';
import {
  type ExcelTableColumn, exportTableToExcel, spaced
} from '../../../exporters/tableExcel';

/**
 * A keyword's move on one device.
 *
 * @returns previous − current as a number, "new" without a previous position, "lost" without a current one, or
 * `null` (an empty cell) when the keyword was not checked or never ranked.
 */
function rankChange(cell: RankCell | null): number | string | null {
  if (cell === null || cell.status === 'not_checked') return null;
  if (cell.position === null) return cell.previous_position === null ? null : 'lost';
  return cell.previous_position === null ? 'new' : cell.previous_position - cell.position;
}

function deviceColumns(device: RankDevice): ExcelTableColumn<RankResultRow>[] {
  const name = device === 'desktop' ? 'Desktop' : 'Mobile';
  return [
    {
      header: `${name} position`,
      value: (row) => row[device]?.position,
    },
    {
      header: `${name} change`,
      value: (row) => rankChange(row[device]),
    },
    {
      header: `${name} URL`,
      value: (row) => row[device]?.url,
    },
    {
      header: `${name} SERP features`,
      value: (row) => spaced(row[device]?.serp_features),
    },
  ];
}

export function rankResultsColumns(devices: readonly RankDevice[]): ExcelTableColumn<RankResultRow>[] {
  return [
    {
      header: 'Keyword',
      value: (row) => row.keyword,
    },
    ...devices.flatMap(deviceColumns),
  ];
}

export function exportRankResultsExcel(rows: readonly RankResultRow[], devices: readonly RankDevice[], domain: string): Promise<void> {
  return exportTableToExcel({
    columns: rankResultsColumns(devices),
    rows,
    sheetName: 'Rank tracking',
    filePrefix: 'rank-tracking',
    scopeLabel: domain,
  });
}
