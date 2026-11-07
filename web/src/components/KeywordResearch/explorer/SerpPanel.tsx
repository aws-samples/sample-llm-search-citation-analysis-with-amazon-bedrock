import { safeHref } from '../../../infrastructure';
import type { SeoRequestState } from '../../../hooks/useKeywordExplorerRequest';
import type {
  OrganicItem, SerpResponse
} from '../../../types/api/seo';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import {
  SkeletonLines, SkeletonRegion
} from '../../ui/Skeleton';

export const DEEP_SERP_DEPTH = 50;

interface SerpPanelProps {
  readonly keyword: string;
  readonly state: SeoRequestState<SerpResponse>;
  /** Requests the results page again at `depth` (a paid call; only on click). */
  readonly onLoad: (depth: 20 | 50) => void;
}

function OrganicResult({ item }: { readonly item: OrganicItem }) {
  const href = safeHref(item.url);
  return (
    <li className="flex gap-3 py-2">
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500">{item.position}</span>
      <div className="min-w-0">
        {href === undefined
          ? <p className="text-sm text-gray-900 truncate">{item.title || item.url}</p>
          : (
            <a href={href} target="_blank" rel="noopener noreferrer" className="block text-sm text-gray-900 hover:underline truncate">
              {item.title || item.url}
            </a>
          )}
        <p className="text-xs text-gray-500 truncate">{item.domain}</p>
      </div>
    </li>
  );
}

function SerpResults({
  response, onLoad
}: {
  readonly response: SerpResponse;
  readonly onLoad: SerpPanelProps['onLoad'] 
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{response.items.length} organic results</span>
        {response.has_ai_overview && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">AI Overview shown</span>
        )}
        {response.cached && <span>From cache (refreshes twice a day)</span>}
      </div>
      {response.items.length === 0
        ? <p className="text-sm text-gray-500">No organic results for this keyword.</p>
        : <ol className="divide-y divide-gray-200">{response.items.map((item) => <OrganicResult key={`${item.position}-${item.url}`} item={item} />)}</ol>}
      {response.depth < DEEP_SERP_DEPTH && (
        <Button variant="secondary" size="sm" onClick={() => onLoad(DEEP_SERP_DEPTH)}>Load top 50</Button>
      )}
    </div>
  );
}

/** Google's organic results for the keyword clicked in the table. */
export function SerpPanel({
  keyword, state, onLoad
}: SerpPanelProps) {
  return (
    <section aria-label={`Search results for ${keyword}`} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Google results: {keyword}</h3>
      {state.status === 'loading' && (
        <SkeletonRegion label="Loading search results"><SkeletonLines lines={8} /></SkeletonRegion>
      )}
      {state.status === 'error' && (
        <div className="space-y-2">
          <ErrorAlert message={state.message} />
          <Button variant="secondary" size="sm" onClick={() => onLoad(20)}>Try again</Button>
        </div>
      )}
      {state.status === 'success' && <SerpResults response={state.response} onLoad={onLoad} />}
    </section>
  );
}
