import { BRAND_MENTIONS_BRANDS_PAGING } from '../../api/brandMentions';
import { isAggregatedBrand } from '../../api/brandMentionsDecoders';
import type { ListRequest } from '../../api/scopedListPages';
import { useScopedList } from '../../hooks/useScopedList';
import type {
  AggregatedBrand, BrandMentionsResponse
} from '../../types';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { BrandMentionsTable } from './BrandMentionsTable';

interface PagedBrandMentionsTableProps {
  readonly data: BrandMentionsResponse;
  /** The GET `data` answered; the next brand pages repeat it with `view=brands` and the cursor. */
  readonly request: ListRequest | null;
  readonly keyword: string;
  readonly onBrandClick: (brand: AggregatedBrand) => void;
}

/**
 * The Brands view's brand table over every brand of the scope (2.45.0 wave 5): the summary's
 * first 100, then the next page over `view=brands` as the reader scrolls to the end (the
 * "Load more brands" button stays for keyboards), until the last.
 */
export function PagedBrandMentionsTable({
  data, request, keyword, onBrandClick
}: PagedBrandMentionsTableProps) {
  const list = useScopedList(data, request, BRAND_MENTIONS_BRANDS_PAGING, isAggregatedBrand);
  const brands = list.items.length === 0 ? data.aggregated.brands : list.items;
  return (
    <BrandMentionsTable
      brands={brands}
      totalBrands={list.total ?? undefined}
      moreToLoad={list.loadMore !== undefined}
      keyword={keyword}
      singleKeyword={data.keyword !== null}
      onBrandClick={onBrandClick}
      footer={<ScopedListFooter list={list} noun="brands" autoLoad />}
    />
  );
}
