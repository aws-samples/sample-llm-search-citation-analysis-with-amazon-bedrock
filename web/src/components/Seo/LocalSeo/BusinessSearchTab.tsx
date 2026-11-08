/**
 * Business search: Google business listings by name and/or category near a point (one paid call per Search). The
 * name starts from the brand's Settings name and the point from the header market's city.
 */
import { useState } from 'react';
import { integerText } from '../../ui/numberFormat';
import {
  fetchBusinessCategories, searchBusinesses
} from '../../../api/seoLocal';
import { useSeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import { useLocalSeoMarket } from '../../../hooks/useLocalSeoMarket';
import { usePrefilledText } from '../../../hooks/usePrefilledText';
import type {
  BusinessListing, BusinessSearchRequest, ListingsSort
} from '../../../types/api/seoLocal';
import { Button } from '../../ui/Button';
import { ExportAllButton } from '../../ui/ExportAllButton';
import {
  PointFields, SelectField, TextField
} from './LocalSeoFields';
import {
  LocalCard, LocalForm, LocalTable, RequestOutcome
} from './LocalSeoLayout';
import {
  EMPTY_POINT, hasSearchPoint, localExportParams, pointFields, type PointInput
} from './localSeoRequest';
import {
  BrandNameHint, MarketPointHint, marketHasPoint, type LocalSeoSettings
} from './localSeoSettings';

const SORTS: {
  value: ListingsSort;
  label: string 
}[] = [
  {
    value: 'relevance',
    label: 'Relevance' 
  },
  {
    value: 'rating',
    label: 'Rating' 
  },
  {
    value: 'reviews',
    label: 'Reviews' 
  },
];
const LIMITS = ['20', '50'].map((limit) => ({
  value: limit,
  label: `${limit} businesses` 
}));
const LISTING_HEADERS = ['Business', 'Rating', 'Reviews', 'Category', 'Claimed', 'Phone', 'Website', 'Profile'];

function claimedLabel(claimed: boolean | null): string {
  if (claimed === null) return '–';
  return claimed ? 'Yes' : 'No';
}

interface ListingsProps {
  readonly rows: readonly BusinessListing[];
  readonly onOpen: (row: BusinessListing) => void;
}

/** The middle columns of a listing row, keyed by their header. */
function listingCells(row: BusinessListing): [string, string | number | null][] {
  return [
    ['Rating', row.rating],
    ['Reviews', row.reviews_count === null ? null : integerText(row.reviews_count)],
    ['Category', row.category],
    ['Claimed', claimedLabel(row.is_claimed)],
    ['Phone', row.phone],
    ['Website', row.domain],
  ];
}

function ListingsTable({
  rows, onOpen
}: ListingsProps) {
  if (rows.length === 0) return <p className="text-sm text-gray-600">No business matched this search.</p>;
  return (
    <LocalTable headers={LISTING_HEADERS}>
      {rows.map((row) => (
        <tr key={row.cid ?? row.place_id ?? row.title}>
          <td className="px-3 py-2 font-medium text-gray-900">{row.title}</td>
          {listingCells(row).map(([header, cell]) => <td key={header} className="px-3 py-2">{cell ?? '–'}</td>)}
          <td className="px-3 py-2">
            <Button variant="secondary" size="sm" onClick={() => { onOpen(row); }}>Open</Button>
          </td>
        </tr>
      ))}
    </LocalTable>
  );
}

/** The free category list, fetched once when the category field is first focused. */
function useCategoryOptions(): {
  readonly options: readonly string[];
  readonly load: () => void 
} {
  const [options, setOptions] = useState<readonly string[] | null>(null);
  const load = () => {
    if (options !== null) return;
    setOptions([]);
    fetchBusinessCategories('')
      .then((response) => { setOptions(response.categories.map((row) => row.category)); })
      .catch((failure: unknown) => { console.error('[seo] Categories failed:', failure); });
  };
  return {
    options: options ?? [],
    load 
  };
}

function searchBody(fields: {
  query: string;
  category: string;
  point: PointInput;
  radius: string;
  sort: ListingsSort;
  limit: string;
}): BusinessSearchRequest {
  return {
    ...pointFields(fields.point),
    ...(fields.query.trim() ? { query: fields.query.trim() } : {}),
    ...(fields.category.trim() ? { categories: [fields.category.trim()] } : {}),
    radius_km: Math.max(1, Math.round(Number(fields.radius) || 10)),
    sort_by: fields.sort,
    limit: Number(fields.limit),
  };
}

function CategoryNote({ options }: { readonly options: readonly string[] }) {
  if (options.length === 0) return null;
  return <p className="text-xs text-gray-500">Categories: {options.slice(0, 12).join(', ')}…</p>;
}

export function BusinessSearchTab({
  settings, onOpenBusiness
}: {
  readonly settings: LocalSeoSettings;
  readonly onOpenBusiness: (business: BusinessListing) => void;
}) {
  const market = useLocalSeoMarket();
  const request = useSeoRequest(searchBusinesses);
  const categories = useCategoryOptions();
  const [query, setQuery] = usePrefilledText(settings.brandName);
  const [category, setCategory] = useState('');
  const [point, setPoint] = useState(EMPTY_POINT);
  const [radius, setRadius] = useState('10');
  const [sort, setSort] = useState<ListingsSort>('relevance');
  const [limit, setLimit] = useState('20');
  const [searched, setSearched] = useState<BusinessSearchRequest | null>(null);
  const named = query.trim() !== '' || category.trim() !== '';
  const canSearch = named && hasSearchPoint(point, marketHasPoint(market)) && request.state.status !== 'loading';
  const footer = (
    <>
      <CategoryNote options={categories.options} />
      <BrandNameHint settings={settings} />
      <MarketPointHint market={market} />
    </>
  );

  return (
    <div className="space-y-4">
      <LocalForm
        title="Find businesses"
        submitLabel="Search"
        canSubmit={canSearch}
        onSubmit={() => {
          const body: BusinessSearchRequest = {
            ...market.marketField,
            ...searchBody({
              query,
              category,
              point,
              radius,
              sort,
              limit
            })
          };
          setSearched(body);
          void request.run(body);
        }}
        footer={footer}
      >
        <TextField label="Name contains" value={query} onChange={setQuery} />
        <div onFocus={categories.load}>
          <TextField label="Category" value={category} onChange={setCategory} placeholder="e.g. coffee_shop" />
        </div>
        <PointFields point={point} onChange={setPoint} market={market} />
        <TextField label="Radius (km)" inputMode="numeric" value={radius} onChange={setRadius} />
        <SelectField label="Sort by" value={sort} options={SORTS} onChange={setSort} />
        <SelectField label="Results" value={limit} options={LIMITS} onChange={setLimit} />
      </LocalForm>
      <RequestOutcome state={request.state} loadingLabel="Loading businesses" columns={8}>
        {(response) => {
          // The API lists the businesses in the searched sort, as the export does.
          const rows = response.businesses;
          return (
            <LocalCard
              title={`${integerText(rows.length)} ${rows.length === 1 ? 'business' : 'businesses'}`}
              cached={response.cached}
              actions={<ExportAllButton view="seo-local" params={rows.length > 0 && searched !== null ? localExportParams('Businesses', searched) : null} />}
            >
              <ListingsTable rows={rows} onOpen={onOpenBusiness} />
            </LocalCard>
          );
        }}
      </RequestOutcome>
    </div>
  );
}
