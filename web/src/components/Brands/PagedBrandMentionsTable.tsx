import { BRAND_MENTIONS_BRANDS_PAGING } from '../../api/brandMentions';
import { isAggregatedBrand } from '../../api/brandMentionsDecoders';
import type { ListRequest } from '../../api/scopedListPages';
import { useScopedList } from '../../hooks/useScopedList';
import type {
  AggregatedBrand, BrandConfig, BrandMentionsResponse
} from '../../types';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { BrandMentionsTable } from './BrandMentionsTable';

interface PagedBrandMentionsTableProps {
  readonly data: BrandMentionsResponse;
  /** The GET `data` answered; the next brand pages repeat it with `view=brands` and the cursor. */
  readonly request: ListRequest | null;
  readonly keyword: string;
  readonly onBrandClick: (brand: AggregatedBrand) => void;
  readonly config: BrandConfig | null;
}

/**
 * The Brands view's brand table over every brand of the scope (2.45.0 wave 5): the summary's
 * first 100, then "Load more brands" over `view=brands` until the last.
 */
export function PagedBrandMentionsTable({
  data, request, keyword, onBrandClick, config
}: PagedBrandMentionsTableProps) {
  const list = useScopedList(data, request, BRAND_MENTIONS_BRANDS_PAGING, isAggregatedBrand);
  const brands = list.items.length === 0 ? data.aggregated.brands : [...list.items];
  return (
    <div>
      <BrandMentionsTable brands={brands} keyword={keyword} onBrandClick={onBrandClick} config={config} />
      <ScopedListFooter list={list} noun="brands" />
    </div>
  );
}
