/**
 * Local results: Google Maps or Local Finder for a keyword around a point, and where a business sits in it. The
 * keyword field suggests the header market's Settings keywords; "your business" left empty is the brand's own domain.
 */
import { useState } from 'react';
import { integerText } from '../../ui/numberFormat';
import { fetchLocalSerp } from '../../../api/seoLocal';
import { useSeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import type {
  LocalDevice, LocalResultItem, LocalSearchType, LocalSerpResponse
} from '../../../types/api/seoLocal';
import {
  IdentityFields, PointFields, SelectField, TextField
} from './LocalSeoFields';
import {
  LocalForm, LocalCard, LocalExcelButton, LocalTable, RequestOutcome
} from './LocalSeoLayout';
import {
  localResultsExport, localScopeLabel
} from './localSeoExcel';
import {
  EMPTY_POINT, hasSearchPoint, pointFields, targetFields, type IdentityInput
} from './localSeoRequest';
import {
  TARGET_LABEL, TargetTabHints, marketHasPoint, targetPlaceholder, type LocalTabProps
} from './localSeoSettings';

const SEARCH_TYPES: {
  value: LocalSearchType;
  label: string 
}[] = [
  {
    value: 'maps',
    label: 'Google Maps' 
  },
  {
    value: 'local_finder',
    label: 'Local Finder' 
  },
];
const DEVICES: {
  value: LocalDevice;
  label: string 
}[] = [
  {
    value: 'mobile',
    label: 'Mobile' 
  },
  {
    value: 'desktop',
    label: 'Desktop' 
  },
];
const DEPTH = 20;
const RESULT_HEADERS = ['#', 'Business', 'Rating', 'Reviews', 'Category', 'Website'];

function MatchLine({ response }: { readonly response: LocalSerpResponse }) {
  const { match } = response;
  if (match === null) {
    return <p className="text-sm text-gray-700">Your business is not in the top {response.items.length} results.</p>;
  }
  return (
    <p className="text-sm text-gray-900">
      <strong>{match.title ?? 'Your business'}</strong> ranks <strong>#{match.rank ?? match.index + 1}</strong>.
    </p>
  );
}

function resultCells(item: LocalResultItem): [string, string | number | null][] {
  return [
    ['#', item.rank_absolute ?? item.rank_group],
    ['Business', item.title],
    ['Rating', item.rating],
    ['Reviews', item.reviews_count === null ? null : integerText(item.reviews_count)],
    ['Category', item.category],
    ['Website', item.domain],
  ];
}

function ResultsTable({ response }: { readonly response: LocalSerpResponse }) {
  return (
    <LocalTable headers={RESULT_HEADERS}>
      {response.items.map((item, position) => {
        const isMatch = response.match?.index === position;
        return (
          <tr
            key={item.cid ?? `${item.title}-${String(position)}`}
            className={isMatch ? 'bg-gray-50 font-semibold' : ''}
            aria-current={isMatch ? 'true' : undefined}
          >
            {resultCells(item).map(([header, cell]) => <td key={header} className="px-3 py-2">{cell ?? '–'}</td>)}
          </tr>
        );
      })}
    </LocalTable>
  );
}

export function LocalResultsTab({
  market, settings
}: LocalTabProps) {
  const request = useSeoRequest(fetchLocalSerp);
  const [keyword, setKeyword] = useState('');
  const [searchType, setSearchType] = useState<LocalSearchType>('maps');
  const [device, setDevice] = useState<LocalDevice>('mobile');
  const [point, setPoint] = useState(EMPTY_POINT);
  const [target, setTarget] = useState<IdentityInput>({
    kind: 'name',
    value: '' 
  });
  const [searched, setSearched] = useState('');
  const ready = keyword.trim() !== '' && hasSearchPoint(point, marketHasPoint(market));

  const search = () => {
    setSearched(localScopeLabel([keyword], point, market.city));
    void request.run({
      keyword: keyword.trim(),
      search_type: searchType,
      device,
      depth: DEPTH,
      ...market.marketField,
      ...pointFields(point),
      ...targetFields(target),
    });
  };

  return (
    <div className="space-y-4">
      <LocalForm
        title="Local results"
        submitLabel="Search"
        canSubmit={ready && request.state.status !== 'loading'}
        onSubmit={search}
        footer={<TargetTabHints market={market} settings={settings} />}
      >
        <TextField label="Keyword" value={keyword} onChange={setKeyword} placeholder="e.g. coffee near me" suggestions={settings.keywords} />
        <SelectField label="Results from" value={searchType} options={SEARCH_TYPES} onChange={setSearchType} />
        <IdentityFields identity={target} onChange={setTarget} label={TARGET_LABEL} placeholder={targetPlaceholder(settings)} />
        <PointFields point={point} onChange={setPoint} market={market} />
        <SelectField label="Device" value={device} options={DEVICES} onChange={setDevice} />
      </LocalForm>
      <RequestOutcome state={request.state} loadingLabel="Loading local results" columns={6}>
        {(response) => (
          <LocalCard
            title={`Results for “${response.keyword}”`}
            cached={response.cached}
            actions={<LocalExcelButton table={localResultsExport(response, searched)} />}
          >
            <MatchLine response={response} />
            <ResultsTable response={response} />
          </LocalCard>
        )}
      </RequestOutcome>
    </div>
  );
}
