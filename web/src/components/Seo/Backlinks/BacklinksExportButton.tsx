import type { ViewParams } from '../../../api/exports';
import type {
  BacklinksTab, BacklinksTableRequest, BacklinksTableResponse
} from '../../../types/api/seoBacklinks';
import { PaidExportButton } from '../../ui/PaidExportButton';
import { TAB_LABELS } from './backlinksFormat';

interface Props<TTab extends BacklinksTab> {
  readonly tab: TTab;
  /** The table as the screen asks it (target, scope, sort, filters, spam and link mode), without the page. */
  readonly list: BacklinksTableRequest;
  /** The page on screen; `null` while none is (the button is then disabled). */
  readonly loaded: BacklinksTableResponse<TTab> | null;
  readonly disabled: boolean;
}

/** The `seo-backlinks` export params of a table: the request's fields, its filters as JSON. */
export function backlinksExportParams(tab: BacklinksTab, list: BacklinksTableRequest): ViewParams {
  return {
    tab,
    target: list.target,
    scope: list.scope,
    sort_field: list.sort_field,
    sort_order: list.sort_order,
    filters: JSON.stringify(list.filters),
    include_spam: list.include_spam,
    mode: list.mode,
  };
}

/**
 * "Export" of a backlinks table: a server export of the page on screen for free, or of up to 10,000 rows of the
 * same sorted, filtered table asked again from DataForSEO, after the user saw and confirmed the price.
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
      view: 'seo-backlinks',
      params: backlinksExportParams(tab, list),
      screenPage: {
        page: loaded.page,
        page_size: loaded.page_size,
      },
    }} />
  );
}
