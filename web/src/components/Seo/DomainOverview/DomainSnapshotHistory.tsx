import { fetchDomainSnapshots } from '../../../api/seoDomains';
import { useSeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import type { DomainSnapshotSummary } from '../../../types/api/seoDomains';
import { Button } from '../../ui/Button';
import {
  DataTable, type DataColumn
} from '../../ui/DataTable';
import { DomainTableStatus } from './DomainTableStatus';
import { DomainExportButton } from './DomainExportButton';
import { SNAPSHOT_EXCEL_COLUMNS } from './domainExcel';
import {
  integerText, usdText
} from './domainFormat';

interface Props {
  readonly domain: string;
  readonly marketId: string;
}

const COLUMNS: ReadonlyArray<DataColumn<DomainSnapshotSummary>> = [
  {
    id: 'snapshot',
    header: 'Snapshot',
    render: (snapshot) => snapshot.snapshot_at.slice(0, 10),
  },
  {
    id: 'keywords',
    header: 'Organic keywords',
    numeric: true,
    render: (snapshot) => integerText(snapshot.organic_keywords),
  },
  {
    id: 'traffic',
    header: 'Est. traffic / month',
    numeric: true,
    render: (snapshot) => integerText(snapshot.estimated_traffic),
  },
  {
    id: 'value',
    header: 'Traffic value / month',
    numeric: true,
    render: (snapshot) => usdText(snapshot.traffic_cost),
  },
];

/** The stored weekly snapshots of the domain in the market (a free read), newest first, on request. */
export function DomainSnapshotHistory({
  domain, marketId
}: Props) {
  const snapshots = useSeoRequest(fetchDomainSnapshots);
  const show = () => {
    void snapshots.run({
      domain,
      market_id: marketId,
    });
  };
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={show} disabled={snapshots.state.status === 'loading'}>
        Show stored traffic snapshots
      </Button>
      <DomainTableStatus state={snapshots.state} loadingLabel="Loading stored snapshots" columns={COLUMNS.length} rows={4}>
        {(response) => (response.snapshots.length === 0
          ? <p className="text-sm text-gray-600">{`No snapshot of ${response.domain} in this market yet.`}</p>
          : (
            <div className="space-y-1">
              <DomainExportButton columns={SNAPSHOT_EXCEL_COLUMNS} rows={response.snapshots} sheetName="Traffic snapshots"
                filePrefix="domain-snapshots" scopeLabel={response.domain}
                title={`The ${response.snapshots.length} stored snapshots of ${response.domain}`} />
              <DataTable rows={response.snapshots} columns={COLUMNS} rowKey={(snapshot) => snapshot.snapshot_at}
                caption="Stored traffic snapshots" />
              <p className="text-xs text-gray-500">Estimated by DataForSEO, not measured clicks.</p>
            </div>
          ))}
      </DomainTableStatus>
    </div>
  );
}
