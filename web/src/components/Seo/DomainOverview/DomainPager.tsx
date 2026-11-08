import type { DomainPageSize } from '../../../types/api/seoDomains';
import { TablePager } from '../../ui/TablePager';
import { CACHED_NOTE } from './domainFormat';

const PAGE_SIZES: readonly DomainPageSize[] = [50, 100];

interface Props {
  readonly page: number;
  readonly pageSize: DomainPageSize;
  readonly totalCount: number | null;
  readonly rowCount: number;
  readonly hasMore: boolean;
  /** Whether the page on screen came from the cache. */
  readonly cached: boolean;
  readonly busy: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: DomainPageSize) => void;
}

/** Previous / next and the page size; every move is one paid page (none when cached). */
export function DomainPager({
  cached, ...pager
}: Props) {
  return (
    <TablePager {...pager} sizes={PAGE_SIZES} label="Table pages"
      note={cached ? <span className="text-xs text-gray-500">{CACHED_NOTE}</span> : undefined} />
  );
}
