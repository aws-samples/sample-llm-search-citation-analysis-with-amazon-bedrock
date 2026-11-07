/**
 * Excel exports of the local SEO tables: the business listings, the Maps / Local Finder results and the rank grid
 * points. Every business row carries its raw fields (full website URL, coordinates, cid, place id); an unknown value
 * is an empty cell.
 */
import {
  type ExcelTableColumn, type TableExport, yesNo
} from '../../../exporters/tableExcel';
import type {
  BusinessListing, GridPoint, LocalBusiness, LocalResultItem, LocalSerpResponse
} from '../../../types/api/seoLocal';
import {
  pointFields, type PointInput
} from './localSeoRequest';

/**
 * What a local table is about: the searched terms, then the market city when the search used it (no coordinate
 * typed).
 */
export function localScopeLabel(terms: readonly string[], point: PointInput, city: string | null): string {
  const searchedCity = 'latitude' in pointFields(point) ? '' : city ?? '';
  return [...terms, searchedCity].map((part) => part.trim()).filter((part) => part !== '').join(' ');
}

/** The columns every business row has, after its name and before its ids. */
function businessColumns<TRow extends LocalBusiness>(): ExcelTableColumn<TRow>[] {
  return [
    {
      header: 'Rating',
      value: (row) => row.rating,
    },
    {
      header: 'Reviews',
      value: (row) => row.reviews_count,
    },
    {
      header: 'Category',
      value: (row) => row.category,
    },
    {
      header: 'Claimed',
      value: (row) => yesNo(row.is_claimed),
    },
    {
      header: 'Phone',
      value: (row) => row.phone,
    },
    {
      header: 'Website',
      value: (row) => row.url ?? row.domain,
    },
    {
      header: 'Address',
      value: (row) => row.address,
    },
  ];
}

function placeColumns<TRow extends LocalBusiness>(): ExcelTableColumn<TRow>[] {
  return [
    {
      header: 'Latitude',
      value: (row) => row.latitude,
    },
    {
      header: 'Longitude',
      value: (row) => row.longitude,
    },
    {
      header: 'cid',
      value: (row) => row.cid,
    },
    {
      header: 'Place ID',
      value: (row) => row.place_id,
    },
  ];
}

const BUSINESS_NAME = {
  header: 'Business',
  value: (row: LocalBusiness) => row.title,
};

export const LISTING_COLUMNS: ReadonlyArray<ExcelTableColumn<BusinessListing>> = [
  BUSINESS_NAME,
  ...businessColumns<BusinessListing>(),
  ...placeColumns<BusinessListing>(),
];

export function listingsExport(rows: readonly BusinessListing[], scopeLabel: string): TableExport<BusinessListing> {
  return {
    columns: LISTING_COLUMNS,
    rows,
    sheetName: 'Businesses',
    filePrefix: 'local-businesses',
    scopeLabel,
  };
}

/** A local result with whether it is the business looked for. */
export interface LocalResultRow {
  readonly item: LocalResultItem;
  readonly yours: boolean;
}

export function localResultRows(response: LocalSerpResponse): LocalResultRow[] {
  return response.items.map((item, position) => ({
    item,
    yours: response.match?.index === position,
  }));
}

/** A business column read from the result's item. */
function onItem(column: ExcelTableColumn<LocalBusiness>): ExcelTableColumn<LocalResultRow> {
  return {
    header: column.header,
    value: (row) => column.value(row.item),
  };
}

export const RESULT_COLUMNS: ReadonlyArray<ExcelTableColumn<LocalResultRow>> = [
  {
    header: 'Rank',
    value: (row) => row.item.rank_absolute ?? row.item.rank_group,
  },
  ...[BUSINESS_NAME, ...businessColumns(), ...placeColumns()].map(onItem),
  {
    header: 'Your business',
    value: (row) => yesNo(row.yours),
  },
];

export function localResultsExport(response: LocalSerpResponse, scopeLabel: string): TableExport<LocalResultRow> {
  return {
    columns: RESULT_COLUMNS,
    rows: localResultRows(response),
    sheetName: 'Local results',
    filePrefix: 'local-results',
    scopeLabel,
  };
}

/** Whether the business was found at a searched point; unknown while the point is pending or failed. */
function foundAt(point: GridPoint): boolean | null {
  return point.status === 'ready' ? point.rank !== null : null;
}

export const GRID_COLUMNS: ReadonlyArray<ExcelTableColumn<GridPoint>> = [
  {
    header: 'Row',
    value: (point) => point.row + 1,
  },
  {
    header: 'Column',
    value: (point) => point.col + 1,
  },
  {
    header: 'Latitude',
    value: (point) => point.latitude,
  },
  {
    header: 'Longitude',
    value: (point) => point.longitude,
  },
  {
    header: 'Status',
    value: (point) => point.status,
  },
  {
    header: 'Found',
    value: (point) => yesNo(foundAt(point)),
  },
  {
    header: 'Rank',
    value: (point) => point.rank,
  },
  {
    header: 'Results',
    value: (point) => point.results_count,
  },
  {
    header: 'Top result',
    value: (point) => point.top_result?.title,
  },
];

export function rankGridExport(points: readonly GridPoint[], scopeLabel: string): TableExport<GridPoint> {
  return {
    columns: GRID_COLUMNS,
    rows: points,
    sheetName: 'Rank grid',
    filePrefix: 'local-rank-grid',
    scopeLabel,
  };
}
