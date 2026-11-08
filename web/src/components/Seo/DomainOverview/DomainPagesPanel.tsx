import type {
  DomainPageFilters,
  DomainPageSort,
  DomainPagesRequest,
  DomainPagesResponse,
  TopPageRow,
} from '../../../types/api/seoDomains';
import { fetchDomainPages } from '../../../api/seoDomains';
import { Button } from '../../ui/Button';
import {
  DomainPagedPanel, etvColumn, type DomainListProps, type ListColumn, type PagedListSpec
} from './DomainPagedPanel';
import {
  PAGE_BOUNDS, pageConditionCount, pageFilters
} from './domainFilters';
import { firstQuery } from './domainPagedQuery';
import { PAGE_EXCEL_COLUMNS } from './domainExcel';
import {
  CompactNumber, pageColumn
} from '../../ui/tableCells';

const SPEC: PagedListSpec<DomainPageFilters> = {
  bounds: PAGE_BOUNDS,
  countConditions: pageConditionCount,
  toFilters: pageFilters,
  loadingLabel: 'Loading top pages',
  skeletonColumns: 3,
  caption: 'Top pages',
};

const COLUMNS: ReadonlyArray<ListColumn<TopPageRow, DomainPageSort>> = [
  pageColumn((row) => row.url, (row) => row.relative_url),
  etvColumn('traffic'),
  {
    id: 'keywords',
    header: 'Keywords',
    sortKey: 'keywords',
    numeric: true,
    render: (row) => <CompactNumber value={row.keywords} />,
  },
];

/** The target's top pages: nothing is fetched until "Load top pages". */
export function DomainPagesPanel(props: DomainListProps<DomainPagesRequest, DomainPagesResponse>) {
  return (
    <DomainPagedPanel {...props} spec={SPEC} initialQuery={firstQuery<DomainPageSort>('traffic')} columns={COLUMNS}
      rowKey={(row) => row.url}
      excel={{
        columns: PAGE_EXCEL_COLUMNS,
        sheetName: 'Top pages',
        filePrefix: 'domain-pages',
        tableName: 'top pages',
        fetchRows: fetchDomainPages,
      }}
      start={(load) => (
        <div className="flex flex-col items-start gap-2 py-6 sm:items-center">
          <p className="text-sm text-gray-500">The pages that bring the domain the most estimated organic traffic.</p>
          <Button variant="secondary" onClick={load}>Load top pages</Button>
        </div>
      )} />
  );
}
