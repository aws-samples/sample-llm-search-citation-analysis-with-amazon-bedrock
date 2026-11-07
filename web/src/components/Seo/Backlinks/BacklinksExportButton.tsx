import { fetchBacklinksTable } from '../../../api/seoBacklinks';
import type {
  BacklinksTab, BacklinksTableRequest, BacklinksTableResponse
} from '../../../types/api/seoBacklinks';
import { PaidExportButton } from '../../ui/PaidExportButton';
import { exportBacklinksExcel } from './backlinksExcel';
import { TAB_LABELS } from './backlinksFormat';

interface Props<TTab extends BacklinksTab> {
  readonly tab: TTab;
  /** The table as the screen asks it (target, scope, sort, filters, spam and link mode), without the page. */
  readonly list: BacklinksTableRequest;
  /** The page on screen; `null` while none is (the button is then disabled). */
  readonly loaded: BacklinksTableResponse<TTab> | null;
  readonly disabled: boolean;
}

/**
 * "Export to Excel" of a backlinks table: the rows on screen for free, or up to 10,000 rows of the same sorted,
 * filtered table asked again from DataForSEO, after the user saw the price.
 */
export function BacklinksExportButton<TTab extends BacklinksTab>({
  tab, list, loaded, disabled
}: Props<TTab>) {
  return (
    <PaidExportButton disabled={disabled} modal={loaded === null ? null : {
      title: TAB_LABELS[tab].toLowerCase(),
      pricing: loaded.export,
      totalCount: loaded.total_count,
      onScreenRows: loaded.rows.length,
      fetchChunk: async (offset, limit, signal) => {
        const chunk = await fetchBacklinksTable(tab, {
          ...list,
          offset,
          limit,
        }, { signal });
        return chunk.rows;
      },
      onDownload: (rows) => exportBacklinksExcel(tab, rows, loaded.target),
      onDownloadScreen: () => exportBacklinksExcel(tab, loaded.rows, loaded.target),
    }} />
  );
}
