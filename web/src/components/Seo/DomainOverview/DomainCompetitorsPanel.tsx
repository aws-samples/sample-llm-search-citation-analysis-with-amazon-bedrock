import type { SeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import type {
  SerpCompetitorRow, SerpCompetitorsRequest, SerpCompetitorsResponse
} from '../../../types/api/seoDomains';
import { Button } from '../../ui/Button';
import {
  DataTable, type DataColumn
} from '../../ui/DataTable';
import {
  CompactNumber, UrlCell
} from '../../ui/tableCells';
import { DomainTableStatus } from './DomainTableStatus';
import { DomainExportButton } from './DomainExportButton';
import {
  CACHED_NOTE, decimalText
} from './domainFormat';

interface Props {
  /** The keywords of the ranked-keywords page on screen. */
  readonly keywords: readonly string[];
  readonly marketId: string | undefined;
  readonly request: SeoRequest<SerpCompetitorsRequest, SerpCompetitorsResponse>;
}

const COLUMNS: ReadonlyArray<DataColumn<SerpCompetitorRow>> = [
  {
    id: 'domain',
    header: 'Domain',
    render: (row) => <UrlCell url={`https://${row.domain}`} text={row.domain} />,
  },
  {
    id: 'visibility',
    header: 'Visibility',
    help: "DataForSEO's share of the keywords' clicks the domain earns from its positions (0-1).",
    numeric: true,
    render: (row) => decimalText(row.visibility, 3),
  },
  {
    id: 'avg_position',
    header: 'Avg. position',
    numeric: true,
    render: (row) => decimalText(row.avg_position),
  },
  {
    id: 'etv',
    header: 'Est. traffic',
    numeric: true,
    render: (row) => <CompactNumber value={row.etv} />,
  },
  {
    id: 'keywords',
    header: 'Keywords',
    numeric: true,
    render: (row) => <CompactNumber value={row.keywords_count} />,
  },
];

/** The domains ranking on the keywords on screen; one paid call per click. */
export function DomainCompetitorsPanel({
  keywords, marketId, request
}: Props) {
  const find = () => {
    void request.run({
      keywords: [...keywords],
      ...(marketId === undefined ? {} : { market_id: marketId }),
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={keywords.length === 0 || request.state.status === 'loading'} onClick={find}>
          {`Find SERP competitors for these ${keywords.length} keywords`}
        </Button>
        <span className="text-xs text-gray-500">Cached for 12 hours.</span>
      </div>
      <DomainTableStatus state={request.state} loadingLabel="Loading SERP competitors" columns={COLUMNS.length}>
        {(response) => (
          <>
            <DomainExportButton table="SERP competitors" params={response.items.length === 0 ? null : {
              keywords: JSON.stringify([...keywords]),
              market_id: response.market_id,
            }} />
            <DataTable rows={response.items} columns={COLUMNS} rowKey={(row) => row.domain} caption="SERP competitors" />
            {response.cached && <p className="text-xs text-gray-500">{CACHED_NOTE}</p>}
          </>
        )}
      </DomainTableStatus>
    </div>
  );
}
